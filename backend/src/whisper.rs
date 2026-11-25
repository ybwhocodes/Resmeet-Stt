use serde::{Deserialize, Serialize};
use std::path::Path;
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
    pub engine: String,
    pub speech_duration_s: Option<f32>,
}

pub async fn convert_with_ffmpeg(input_path: &Path, output_wav: &Path) -> Result<(), String> {
    let output = Command::new("ffmpeg")
        .kill_on_drop(true)
        .args([
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-threads",
            "2",
            "-filter_threads",
            "2",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            input_path.to_str().unwrap_or_default(),
            "-map",
            "0:a:0",
            "-vn",
            "-af",
            "highpass=f=80,lowpass=f=7500,afftdn=nf=-25",
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
            format!(
                "Konversi FFmpeg gagal: {}",
                detail.chars().take(500).collect::<String>()
            )
        });
    }

    Ok(())
}
