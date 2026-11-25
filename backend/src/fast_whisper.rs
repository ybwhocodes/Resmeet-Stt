use crate::{progress::ProgressReporter, whisper::{TranscriptionResult, WhisperSegment}};
use serde::Deserialize;
use std::{path::Path, process::Stdio};
use tokio::{io::{AsyncBufReadExt, AsyncReadExt, BufReader}, process::Command};

#[derive(Debug)]
pub enum FastError { NoSpeech, Runtime(String) }

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Event {
    Info { duration_s: f32, speech_duration_s: f32 },
    Segment { start: f32, end: f32, text: String },
    Done { duration_s: f32, speech_duration_s: f32 },
    Error { error: String, #[serde(default)] kind: String },
}

fn valid_segment(start: f32, end: f32, duration: f32) -> bool {
    start.is_finite() && end.is_finite() && start >= 0.0 && end >= start && end <= duration + 0.5
}

pub async fn transcribe(
    audio: &Path, python: &Path, worker: &Path, model: &Path, threads: usize, batch_size: usize,
    progress: ProgressReporter,
) -> Result<TranscriptionResult, FastError> {
    let started = std::time::Instant::now();
    let fail = |error: String| FastError::Runtime(error);
    let mut child = Command::new(python).arg(worker)
        .arg("--audio").arg(audio).arg("--model").arg(model)
        .arg("--threads").arg(threads.max(1).to_string())
        .arg("--batch-size").arg(batch_size.clamp(1, 4).to_string())
        .env("HF_HUB_DISABLE_TELEMETRY", "1")
        .env("OPENBLAS_NUM_THREADS", "1").env("OMP_NUM_THREADS", "1").env("MKL_NUM_THREADS", "1")
        .stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true)
        .spawn().map_err(|e| fail(format!("Mesin INT8 tidak dapat dijalankan: {e}")))?;
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut stderr = child.stderr.take().unwrap();
    let errors = tokio::spawn(async move { let mut text = String::new(); let _ = stderr.read_to_string(&mut text).await; text });
    let mut segments = Vec::new();
    let mut duration = 0.0;
    let mut speech_duration = 0.0;
    let mut complete = false;
    while let Some(line) = lines.next_line().await.map_err(|e| fail(e.to_string()))? {
        let event: Event = serde_json::from_str(&line).map_err(|e| fail(format!("Protokol mesin INT8 tidak valid: {e}")))?;
        match event {
            Event::Info { duration_s, speech_duration_s } => {
                if !duration_s.is_finite() || duration_s <= 0.0 { return Err(fail("Durasi audio INT8 tidak valid".into())); }
                duration = duration_s;
                speech_duration = speech_duration_s;
                progress.whisper(0.0, 0.0, duration, "");
                tracing::info!(duration, speech_duration, "INT8: audio percakapan siap diproses");
            }
            Event::Segment { start, end, text } => {
                if !valid_segment(start, end, duration) { return Err(fail("Timestamp INT8 di luar rekaman asli".into())); }
                progress.whisper(end / duration, end, duration, &text);
                if !text.trim().is_empty() { segments.push(WhisperSegment { start, end: end.min(duration), text, words: vec![] }); }
            }
            Event::Done { duration_s, speech_duration_s } => {
                if !duration_s.is_finite() || duration_s <= 0.0 { return Err(fail("Durasi hasil INT8 tidak valid".into())); }
                duration = duration_s; speech_duration = speech_duration_s; complete = true;
            }
            Event::Error { error, kind } => {
                return Err(if kind == "no_speech" { FastError::NoSpeech } else { fail(error) });
            }
        }
    }
    let status = child.wait().await.map_err(|e| fail(e.to_string()))?;
    let stderr = errors.await.unwrap_or_default();
    if !status.success() || !complete || segments.is_empty() {
        return Err(fail(format!("Mesin INT8 tidak menyelesaikan transkripsi: {}", stderr.chars().take(500).collect::<String>())));
    }
    let text = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
    Ok(TranscriptionResult { full_text: text.clone(), raw_text: text, segments, duration_s: duration,
        generation_time_s: started.elapsed().as_secs_f32(), engine: "faster-whisper-int8".into(),
        speech_duration_s: Some(speech_duration.min(duration)) })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_original_timeline_but_rejects_invalid_worker_timestamps() {
        assert!(valid_segment(600.0, 605.0, 1340.0));
        assert!(!valid_segment(10.0, 9.0, 1340.0));
        assert!(!valid_segment(0.0, f32::NAN, 1340.0));
        assert!(!valid_segment(1340.0, 1400.0, 1340.0));
    }
}
