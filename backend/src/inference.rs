//! One resident inference child, owned by the elected transcription worker only.
use crate::{
    config::AppConfig,
    progress::ProgressReporter,
    whisper::{TranscriptionResult, WhisperSegment},
};
use serde_json::{json, Value};
use std::{
    path::Path,
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    Fast,
    NativeCpu,
    NativeGpu,
}
struct Fast {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
struct Native {
    child: Child,
    url: String,
    gpu: bool,
    client: reqwest::Client,
}
enum Resident {
    Fast(Fast),
    Native(Native),
}
pub struct Engine {
    resident: Option<Resident>,
    kind: Option<Backend>,
    last_used: Instant,
}
impl Engine {
    pub fn new() -> Self {
        Self {
            resident: None,
            kind: None,
            last_used: Instant::now(),
        }
    }
    pub async fn reset(&mut self) {
        if let Some(resident) = self.resident.take() {
            let mut child = match resident {
                Resident::Fast(f) => f.child,
                Resident::Native(n) => n.child,
            };
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        self.kind = None;
    }
    pub async fn unload_if_idle(&mut self, seconds: u64) {
        if self.last_used.elapsed() > Duration::from_secs(seconds) {
            self.reset().await;
        }
    }
    pub async fn transcribe(
        &mut self,
        backend: Backend,
        audio: &Path,
        config: &AppConfig,
        progress: ProgressReporter,
    ) -> Result<TranscriptionResult, String> {
        let started = Instant::now();
        let dead = match self.resident.as_mut() {
            Some(Resident::Fast(f)) => f.child.try_wait().ok().flatten().is_some(),
            Some(Resident::Native(n)) => n.child.try_wait().ok().flatten().is_some(),
            None => false,
        };
        if dead {
            self.reset().await;
        }
        if self.kind != Some(backend) {
            self.reset().await;
            self.resident = Some(match backend {
                Backend::Fast => Resident::Fast(Fast::start(config).await?),
                _ => Resident::Native(Native::start(config, backend == Backend::NativeGpu).await?),
            });
            self.kind = Some(backend);
            tracing::info!(
                ?backend,
                "Model resident siap; bobot dipakai ulang tanpa konteks antarpermintaan"
            );
        }
        self.last_used = Instant::now();
        let mut result = match self.resident.as_mut().unwrap() {
            Resident::Fast(f) => f.transcribe(audio, progress).await,
            Resident::Native(n) => n.transcribe(audio).await,
        };
        if let Ok(result) = &mut result {
            result.generation_time_s = started.elapsed().as_secs_f32();
        }
        self.last_used = Instant::now();
        if result.is_err() {
            self.reset().await;
        }
        result
    }
}

pub struct EnginePool {
    engines: Vec<tokio::sync::Mutex<Engine>>,
    concurrency: usize,
}

impl EnginePool {
    pub fn new(concurrency: usize) -> Self {
        let concurrency = concurrency.clamp(1, 4);
        let mut engines = Vec::with_capacity(concurrency);
        for _ in 0..concurrency {
            engines.push(tokio::sync::Mutex::new(Engine::new()));
        }
        Self { engines, concurrency }
    }

    pub fn concurrency(&self) -> usize {
        self.concurrency
    }

    pub async fn reset(&self) {
        for engine in &self.engines {
            engine.lock().await.reset().await;
        }
    }

    pub async fn unload_if_idle(&self, seconds: u64) {
        for engine in &self.engines {
            engine.lock().await.unload_if_idle(seconds).await;
        }
    }

    pub async fn transcribe(
        &self,
        engine_idx: usize,
        backend: Backend,
        audio: &Path,
        config: &AppConfig,
        progress: ProgressReporter,
    ) -> Result<TranscriptionResult, String> {
        let mut engine = self.engines[engine_idx].lock().await;
        engine.transcribe(backend, audio, config, progress).await
    }
}

fn child_command(executable: &Path) -> Command {
    let mut cmd = Command::new(executable);
    cmd.env("OMP_NUM_THREADS", "1")
        .env("OPENBLAS_NUM_THREADS", "1")
        .env("MKL_NUM_THREADS", "1")
        .kill_on_drop(true);
    cmd
}
fn drain_logs<T: tokio::io::AsyncRead + Unpin + Send + 'static>(stream: T, errors: bool) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stream);
        let mut line = Vec::new();
        let mut reported = 0u8;
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line).await {
                Ok(0) | Err(_) => break,
                _ => {
                    if errors && reported < 10 {
                        let text = String::from_utf8_lossy(&line);
                        let lower = text.to_lowercase();
                        if lower.contains("error") || lower.contains("failed") {
                            tracing::warn!(detail=%text.chars().take(500).collect::<String>(),"Diagnostik worker inferensi");
                            reported += 1;
                        }
                    }
                }
            }
        }
    });
}
impl Fast {
    async fn start(config: &AppConfig) -> Result<Self, String> {
        let mut command = child_command(&config.faster_python);
        command
            .arg(&config.faster_worker)
            .args(["--resident", "--model"])
            .arg(&config.faster_model_dir)
            .args(["--threads", &config.cpu_threads.to_string()])
            .args(["--batch-size", &config.stt_batch_size.to_string()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|e| format!("Worker INT8 gagal dimulai: {e}"))?;
        let input = child.stdin.take().unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        drain_logs(child.stderr.take().unwrap(), true);
        let mut line = String::new();
        let ready =
            tokio::time::timeout(Duration::from_secs(120), output.read_line(&mut line)).await;
        if ready.is_err() || !line.contains(r#""ready""#) {
            let _ = child.kill().await;
            return Err("Worker INT8 gagal inisialisasi".into());
        }
        Ok(Self {
            child,
            input,
            output,
        })
    }
    async fn transcribe(
        &mut self,
        audio: &Path,
        progress: ProgressReporter,
    ) -> Result<TranscriptionResult, String> {
        let started = Instant::now();
        let request = json!({ "audio": audio.to_str().unwrap_or_default() }).to_string() + "\n";
        self.input
            .write_all(request.as_bytes())
            .await
            .map_err(|e| format!("Kirim audio ke worker gagal: {e}"))?;
        self.input
            .flush()
            .await
            .map_err(|e| format!("Flush ke worker gagal: {e}"))?;
        let mut line = String::new();
        let mut segments = Vec::new();
        let mut duration = 0.0;
        let mut speech = None;
        loop {
            line.clear();
            let read = tokio::time::timeout(
                Duration::from_secs(1800),
                self.output.read_line(&mut line),
            )
            .await;
            if read.is_err() || line.trim().is_empty() {
                return Err("Worker INT8 berhenti saat inferensi".into());
            }
            let event: Value = serde_json::from_str(&line)
                .map_err(|e| format!("Format respons INT8 tidak valid: {e}"))?;
            match event["type"].as_str() {
                Some("info") => {
                    duration = finite_number(&event, "duration_s")?;
                    speech = event["speech_duration_s"].as_f64().map(|v| v as f32);
                }
                Some("segment") => {
                    let start = finite_number(&event, "start")?;
                    let end = finite_number(&event, "end")?;
                    if start < 0.0 || end < start || end > duration + 0.5 {
                        return Err("Timestamp INT8 tidak valid".into());
                    }
                    let text = event["text"]
                        .as_str()
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    progress.whisper(end / duration, end, duration, &text);
                    segments.push(WhisperSegment {
                        start,
                        end: end.min(duration),
                        text,
                        words: Vec::new(),
                    });
                }
                Some("done") => {
                    return Ok(result(
                        segments,
                        duration,
                        started,
                        "faster-whisper-int8",
                        speech,
                    ))
                }
                Some("error") if event["kind"] == "no_speech" => {
                    return Ok(result(
                        Vec::new(),
                        duration,
                        started,
                        "faster-whisper-int8",
                        speech,
                    ))
                }
                Some("error") => return Err(format!("Mesin INT8 gagal: {}", event["error"])),
                _ => return Err("Urutan protokol INT8 tidak valid".into()),
            }
        }
    }
}
fn finite_number(event: &Value, key: &str) -> Result<f32, String> {
    event[key]
        .as_f64()
        .filter(|v| v.is_finite())
        .map(|v| v as f32)
        .ok_or_else(|| format!("Nilai {key} tidak valid"))
}
fn result(
    segments: Vec<WhisperSegment>,
    duration: f32,
    started: Instant,
    engine: &str,
    speech: Option<f32>,
) -> TranscriptionResult {
    let text = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    TranscriptionResult {
        full_text: text.clone(),
        raw_text: text,
        segments,
        duration_s: duration,
        generation_time_s: started.elapsed().as_secs_f32(),
        engine: engine.into(),
        speech_duration_s: speech,
    }
}
impl Native {
    async fn start(config: &AppConfig, gpu: bool) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        drop(listener);
        let binary = config
            .native_server()
            .ok_or("whisper-server belum tersedia; bangun runtime worker terbaru")?;
        let mut command = child_command(&binary);
        command
            .args(["--host", "127.0.0.1", "--port"])
            .arg(port.to_string())
            .arg("-m")
            .arg(config.model_path())
            .arg("-t")
            .arg(config.cpu_threads.to_string())
            .args(["-l", "id", "-bs", "1", "-bo", "1", "-fa", "-nlp", "-nf"]);
        if !gpu {
            command.arg("-ng");
        }
        if config.vad_enabled && config.vad_model.is_file() {
            command.args(["--vad", "-vm"]).arg(&config.vad_model).args([
                "-vt", "0.50", "-vspd", "250", "-vsd", "100", "-vp", "50", "-vo", "0.10",
            ]);
        }
        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("whisper-server gagal dimulai: {e}"))?;
        drain_logs(child.stdout.take().unwrap(), false);
        drain_logs(child.stderr.take().unwrap(), true);
        let url = format!("http://127.0.0.1:{port}");
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(1800))
            .build()
            .map_err(|e| e.to_string())?;
        let loading = Instant::now();
        while loading.elapsed() < Duration::from_secs(180) {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err("whisper-server berhenti saat memuat model".into());
            }
            if client
                .get(format!("{url}/health"))
                .timeout(Duration::from_secs(2))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                return Ok(Self { child, url, gpu, client });
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Err("Model Whisper terlalu lama dimuat".into())
    }
    async fn transcribe(&mut self, audio: &Path) -> Result<TranscriptionResult, String> {
        let started = Instant::now();
        let boundary = UuidBoundary::new();
        let mut body = Vec::new();
        for (key, value) in [
            ("response_format", "verbose_json"),
            ("language", "id"),
            ("no_context", "true"),
            ("beam_size", "1"),
            ("best_of", "1"),
            ("temperature", "0.0"),
            ("temperature_inc", "0.0"),
            ("token_timestamps", "false"),
        ] {
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n").as_bytes());
        }
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"chunk.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
        body.extend_from_slice(&tokio::fs::read(audio).await.map_err(|e| e.to_string())?);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let response = self.client
            .post(format!("{}/inference", self.url))
            .header(
                "Content-Type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Worker Whisper terputus: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Worker Whisper menolak bagian audio ({})",
                response.status()
            ));
        }
        let data: Value = response
            .json()
            .await
            .map_err(|e| format!("Respons Whisper tidak valid: {e}"))?;
        let duration = crate::audio_chunks::duration(audio).await?;
        let mut segments = Vec::new();
        for segment in data["segments"]
            .as_array()
            .ok_or("Timestamp Whisper tidak tersedia")?
        {
            let start = finite_number(segment, "start")?;
            let end = finite_number(segment, "end")?;
            if start < 0.0 || end < start || end > duration + 1.0 {
                return Err("Timestamp Whisper di luar bagian audio".into());
            }
            let text = segment["text"]
                .as_str()
                .unwrap_or_default()
                .trim()
                .to_string();
            if !text.is_empty() {
                segments.push(WhisperSegment {
                    start,
                    end: end.min(duration),
                    text,
                    words: Vec::new(),
                });
            }
        }
        Ok(result(
            segments,
            duration,
            started,
            if self.gpu {
                "whisper.cpp-vulkan"
            } else {
                "whisper.cpp-cpu"
            },
            None,
        ))
    }
}
struct UuidBoundary;
impl UuidBoundary {
    fn new() -> String {
        format!("resmeet-{}", uuid::Uuid::new_v4())
    }
}
