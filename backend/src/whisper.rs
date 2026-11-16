use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WordTimestamp {
    pub word: String,
    pub start: f32,
    pub end: f32,
    #[serde(default)]
    pub t_dtw: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WhisperSegment {
    pub start: f32,
    pub end: f32,
    pub text: String,
    #[serde(default)]
    pub words: Vec<WordTimestamp>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub full_text: String,
    pub raw_text: String,
    pub segments: Vec<WhisperSegment>,
    pub duration_s: f32,
    pub generation_time_s: f32,
}

pub fn find_whisper_cli() -> Option<PathBuf> {
    let candidates = [
        "/usr/local/bin/whisper-cli",
        "/usr/bin/whisper-cli",
        "./whisper-cli",
        "whisper-cli",
    ];

    for candidate in candidates {
        let p = PathBuf::from(candidate);
        if p.exists() || which::which(candidate).is_ok() {
            return Some(p);
        }
    }
    None
}

mod which {
    use std::path::PathBuf;
    pub fn which(name: &str) -> Result<PathBuf, ()> {
        if let Ok(paths) = std::env::var("PATH") {
            for path in std::env::split_paths(&paths) {
                let full = path.join(name);
                if full.is_file() {
                    return Ok(full);
                }
            }
        }
        Err(())
    }
}

pub async fn convert_with_ffmpeg(input_path: &Path, output_wav: &Path) -> Result<(), String> {
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-nostdin",
            "-v", "error",
            "-y",
            "-i",
            input_path.to_str().unwrap_or_default(),
            "-map", "0:a:0",
            "-vn",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            output_wav.to_str().unwrap_or_default(),
        ])
        .output()
        .await
        .map_err(|e| format!("Gagal menjalankan FFmpeg: {}", e))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        return Err(if detail.is_empty() {
            format!("Konversi FFmpeg gagal (status {}).", output.status)
        } else {
            format!("Konversi FFmpeg gagal: {}", detail.chars().take(500).collect::<String>())
        });
    }

    Ok(())
}

pub async fn transcribe_with_whisper(
    wav_path: &Path,
    model_path: &Path,
    threads: usize,
) -> Result<TranscriptionResult, String> {
    let start_time = std::time::Instant::now();
    let whisper_cli = find_whisper_cli().unwrap_or_else(|| PathBuf::from("whisper-cli"));

    let output_json_prefix = wav_path.with_extension("");
    let json_file = wav_path.with_extension("json");

    let num_threads = if threads > 0 {
        let max_threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(2);
        threads.min(max_threads).max(1)
    } else {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(2)
    };

    let output = Command::new(&whisper_cli)
        .args([
            "-m",
            model_path.to_str().unwrap_or_default(),
            "-f",
            wav_path.to_str().unwrap_or_default(),
            "-t",
            &num_threads.to_string(),
            "-l",
            "id",
            "-bs",
            "1",
            "-bo",
            "1",
            "-fa",
            "-nf",
            "-oj",
            "-of",
            output_json_prefix.to_str().unwrap_or_default(),
        ])
        .output()
        .await
        .map_err(|e| format!("Gagal mengeksekusi whisper-cli: {}", e))?;

    let generation_time_s = start_time.elapsed().as_secs_f32();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr
            .lines()
            .rev()
            .find(|line| line.contains("error:") || line.contains("failed") || line.contains("killed"))
            .unwrap_or_default();
        return Err(if detail.is_empty() {
            format!("Whisper-cli gagal (status {}).", output.status)
        } else {
            format!("Whisper-cli gagal: {}", detail.chars().take(500).collect::<String>())
        });
    }

    let mut full_text = String::new();
    let mut segments = Vec::new();
    let mut duration_s = 0.0f32;

    // 1. Try parsing generated JSON output
    if json_file.exists() {
        if let Ok(content) = tokio::fs::read_to_string(&json_file).await {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(transcription) = parsed.get("transcription").and_then(|t| t.as_array()) {
                    for seg in transcription {
                        let text = seg["text"].as_str().unwrap_or_default().trim();
                        let start = seg["timestamps"]["from"]
                            .as_str()
                            .and_then(parse_timestamp)
                            .unwrap_or(0.0);
                        let end = seg["timestamps"]["to"]
                            .as_str()
                            .and_then(parse_timestamp)
                            .unwrap_or(start);

                        if end > duration_s {
                            duration_s = end;
                        }

                        if !text.is_empty() {
                            if !full_text.is_empty() {
                                full_text.push(' ');
                            }
                            full_text.push_str(text);

                            segments.push(WhisperSegment {
                                start,
                                end,
                                text: text.to_string(),
                                words: vec![],
                            });
                        }
                    }
                }
            }
        }
        let _ = tokio::fs::remove_file(&json_file).await;
    }

    // 2. Fallback: Parse stdout if JSON was missing or empty
    if segments.is_empty() {
        let stdout_str = String::from_utf8_lossy(&output.stdout);
        for line in stdout_str.lines() {
            let line = line.trim();
            if line.starts_with('[') && line.contains("-->") {
                if let Some((time_part, text_part)) = line.split_once(']') {
                    let text = text_part.trim();
                    let raw_times = time_part.trim_start_matches('[');
                    if let Some((start_str, end_str)) = raw_times.split_once("-->") {
                        let start = parse_timestamp(start_str.trim()).unwrap_or(0.0);
                        let end = parse_timestamp(end_str.trim()).unwrap_or(start);

                        if !text.is_empty() {
                            if !full_text.is_empty() {
                                full_text.push(' ');
                            }
                            full_text.push_str(text);

                            segments.push(WhisperSegment {
                                start,
                                end,
                                text: text.to_string(),
                                words: vec![],
                            });

                            if end > duration_s {
                                duration_s = end;
                            }
                        }
                    }
                }
            }
        }
    }

    if !full_text.is_empty() || !segments.is_empty() {
        return Ok(TranscriptionResult {
            raw_text: full_text.clone(),
            full_text,
            segments,
            duration_s,
            generation_time_s,
        });
    }

    Err("Tidak dapat mengekstrak hasil transkripsi dari output whisper-cli.".to_string())
}

fn parse_timestamp(ts: &str) -> Option<f32> {
    // Format: 00:01:23,450 or 00:01:23.450
    let clean = ts.replace(',', ".");
    let parts: Vec<&str> = clean.split(':').collect();
    if parts.len() == 3 {
        let h: f32 = parts[0].parse().ok()?;
        let m: f32 = parts[1].parse().ok()?;
        let s: f32 = parts[2].parse().ok()?;
        return Some(h * 3600.0 + m * 60.0 + s);
    }
    None
}
