use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc::UnboundedSender;

#[derive(Clone)]
pub struct ProgressReporter {
    sender: Option<UnboundedSender<Value>>,
    started: Instant,
    percent: Arc<Mutex<u8>>,
    sink: Option<tokio::sync::watch::Sender<Value>>,
    span: Option<(f32, f32)>,
}

impl ProgressReporter {
    pub fn new(sender: Option<UnboundedSender<Value>>) -> Self {
        Self {
            sender,
            started: Instant::now(),
            percent: Arc::new(Mutex::new(0)),
            sink: None,
            span: None,
        }
    }

    pub fn with_sink(
        mut self,
        sink: tokio::sync::watch::Sender<Value>,
        initial_percent: u8,
    ) -> Self {
        self.sink = Some(sink);
        *self.percent.lock().expect("progress lock poisoned") = initial_percent;
        self
    }
    pub fn for_chunk(&self, offset: f32, total: f32) -> Self {
        let mut reporter = self.clone();
        reporter.span = Some((offset, total));
        reporter
    }

    pub fn update(&self, percent: u8, stage: &str) {
        self.send(
            json!({"type": "progress", "percent": percent, "stage": stage,
            "elapsed_s": self.started.elapsed().as_secs()}),
        );
        tracing::info!(percent, stage, "Progres transkripsi");
    }

    pub fn whisper(&self, fraction: f32, processed_s: f32, duration_s: f32, text: &str) {
        let (fraction, processed_s, duration_s) = if let Some((offset, total)) = self.span {
            (
                ((offset + processed_s) / total).clamp(0.0, 1.0),
                offset + processed_s,
                total,
            )
        } else {
            (fraction, processed_s, duration_s)
        };
        let percent = 10 + (fraction.clamp(0.0, 1.0) * 75.0) as u8;
        self.send(json!({"type": "progress", "percent": percent,
            "stage": "Mentranskripsi audio dengan Whisper...", "audio_processed_s": processed_s,
            "audio_duration_s": duration_s, "current_text": text,
            "elapsed_s": self.started.elapsed().as_secs()}));
    }

    fn send(&self, mut event: Value) {
        // Serialize updates from stdout and stderr so callback order cannot lower progress.
        let mut percent = self.percent.lock().expect("progress lock poisoned");
        if let Some(next) = event["percent"].as_u64() {
            *percent = (*percent).max(next.min(100) as u8);
            event["percent"] = json!(*percent);
        }
        if let Some(sink) = &self.sink {
            sink.send_replace(event.clone());
        }
        if let Some(sender) = &self.sender {
            let _ = sender.send(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stdout_timestamps_and_stderr_callbacks_cannot_move_progress_backwards() {
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let progress = ProgressReporter::new(Some(sender));
        progress.whisper(1.0, 30.0, 30.0, "teks");
        progress.clone().whisper(0.99, 29.7, 30.0, "");
        progress.update(100, "Selesai");
        assert_eq!(receiver.recv().await.unwrap()["percent"], 85);
        assert_eq!(receiver.recv().await.unwrap()["percent"], 85);
        assert_eq!(receiver.recv().await.unwrap()["percent"], 100);
    }
}
