use crate::whisper::{TranscriptionResult, WhisperSegment};
use serde::{Deserialize, Serialize};
use std::{path::Path, process::Stdio};
use tokio::process::Command;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Chunk {
    pub index: i32,
    pub start: f32,
    pub end: f32,
    pub audio_start: f32,
    pub audio_end: f32,
}
pub async fn duration(path: &Path) -> Result<f32, String> {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(path)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let value = String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<f32>()
        .map_err(|_| "Durasi audio tidak valid")?;
    if !out.status.success() || !value.is_finite() || value <= 0.0 {
        return Err("Durasi audio tidak valid".into());
    }
    Ok(value)
}
pub async fn plan(path: &Path, total: f32, size: f32) -> Result<Vec<Chunk>, String> {
    let mut pauses = Vec::new();
    if total > size {
        let out = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-nostdin",
                "-nostats",
                "-threads",
                "1",
                "-filter_threads",
                "1",
                "-i",
            ])
            .arg(path)
            .args(["-af", "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-"])
            .stdout(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err("Pemeriksaan batas audio gagal".into());
        }
        let mut silence_start = None;
        for line in String::from_utf8_lossy(&out.stderr).lines() {
            if let Some((_, text)) = line.split_once("silence_start: ") {
                silence_start = text
                    .split_whitespace()
                    .next()
                    .and_then(|v| v.parse::<f32>().ok());
            }
            if let Some((_, text)) = line.split_once("silence_end: ") {
                if let (Some(start), Some(end)) = (
                    silence_start.take(),
                    text.split_whitespace()
                        .next()
                        .and_then(|v| v.parse::<f32>().ok()),
                ) {
                    pauses.push((start + end) / 2.0);
                }
            }
        }
    }
    Ok(boundaries(total, size, &pauses))
}
fn boundaries(total: f32, size: f32, pauses: &[f32]) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut start = 0.0;
    while start < total {
        let desired = (start + size).min(total);
        let end = if total - desired < 5.0 {
            total
        } else {
            pauses
                .iter()
                .copied()
                .filter(|p| {
                    p.is_finite()
                        && *p > start + size * 0.5
                        && (*p - desired).abs() <= size.min(10.0) * 0.5
                })
                .min_by(|a, b| (a - desired).abs().total_cmp(&(b - desired).abs()))
                .unwrap_or(desired)
                .min(total)
        };
        chunks.push(Chunk {
            index: chunks.len() as i32,
            start,
            end,
            audio_start: (start - 0.5).max(0.0),
            audio_end: (end + 0.5).min(total),
        });
        start = end;
    }
    chunks
}
pub async fn extract(source: &Path, dest: &Path, chunk: &Chunk) -> Result<(), String> {
    let out = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-threads",
            "1",
            "-ss",
        ])
        .arg(chunk.audio_start.to_string())
        .arg("-i")
        .arg(source)
        .arg("-t")
        .arg((chunk.audio_end - chunk.audio_start).to_string())
        .args([
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-threads",
            "1",
        ])
        .arg(dest)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("Ekstraksi bagian audio gagal".into());
    }
    Ok(())
}
pub fn align(mut result: TranscriptionResult, chunk: &Chunk, total: f32) -> TranscriptionResult {
    result.segments.retain(|s| {
        let midpoint = (s.start + s.end) / 2.0 + chunk.audio_start;
        midpoint >= chunk.start && (midpoint < chunk.end || chunk.end >= total)
    });
    for segment in &mut result.segments {
        segment.start = (segment.start + chunk.audio_start).clamp(0.0, total);
        segment.end = (segment.end + chunk.audio_start).clamp(segment.start, total);
        for word in &mut segment.words {
            word.start += chunk.audio_start;
            word.end += chunk.audio_start;
        }
    }
    result.full_text = result
        .segments
        .iter()
        .map(|s| s.text.trim())
        .collect::<Vec<_>>()
        .join(" ");
    result.raw_text = result.full_text.clone();
    result
}
fn normalized(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}
pub fn merge(results: Vec<TranscriptionResult>, total: f32) -> TranscriptionResult {
    let mut segments: Vec<WhisperSegment> = Vec::new();
    let mut time = 0.0;
    let mut engines = Vec::new();
    for result in results {
        time += result.generation_time_s;
        if !engines.contains(&result.engine) {
            engines.push(result.engine);
        }
        for (index, mut segment) in result.segments.into_iter().enumerate() {
            // Only reconcile matching words at overlapping chunk boundaries. Never
            // remove repetitions from unrelated timestamps or within a chunk.
            if let Some(previous) = segments.last() {
                if index == 0 && segment.start < previous.end {
                    let left = previous.text.split_whitespace().collect::<Vec<_>>();
                    let right = segment.text.split_whitespace().collect::<Vec<_>>();
                    let overlap = (3..=left.len().min(right.len()).min(40)).rev().find(|n| {
                        left[left.len() - n..]
                            .iter()
                            .map(|s| normalized(s))
                            .eq(right[..*n].iter().map(|s| normalized(s)))
                    });
                    if let Some(count) = overlap {
                        segment.text = right[count..].join(" ");
                        segment.start = segment.start.max(previous.end).min(segment.end);
                    }
                }
            }
            if !segment.text.trim().is_empty() {
                segments.push(segment);
            }
        }
    }
    let text = segments
        .iter()
        .map(|s| s.text.trim())
        .collect::<Vec<_>>()
        .join(" ");
    TranscriptionResult {
        full_text: text.clone(),
        raw_text: text,
        segments,
        duration_s: total,
        generation_time_s: time,
        engine: engines.join(" + "),
        speech_duration_s: None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chunks_cover_the_recording_once_and_prefer_nearby_silence() {
        let chunks = boundaries(250.0, 120.0, &[119.0, 241.0]);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].end, 119.0);
        assert_eq!(chunks.last().unwrap().end, 250.0);
        for pair in chunks.windows(2) {
            assert_eq!(pair[0].end, pair[1].start);
            assert!(pair[0].audio_end > pair[1].audio_start);
        }
    }
    #[test]
    fn empty_short_and_exact_boundary_plans_do_not_loop() {
        assert!(boundaries(0.0, 120.0, &[]).is_empty());
        assert_eq!(boundaries(8.0, 120.0, &[]).len(), 1);
        assert_eq!(boundaries(240.0, 120.0, &[]).len(), 2);
    }
}

#[cfg(test)]
mod merge_tests {
    use super::*;
    fn result(segments: Vec<WhisperSegment>) -> TranscriptionResult {
        TranscriptionResult {
            full_text: String::new(),
            raw_text: String::new(),
            segments,
            duration_s: 8.0,
            generation_time_s: 1.0,
            engine: "test".into(),
            speech_duration_s: None,
        }
    }
    fn segment(start: f32, end: f32, text: &str) -> WhisperSegment {
        WhisperSegment {
            start,
            end,
            text: text.into(),
            words: Vec::new(),
        }
    }
    #[test]
    fn overlap_words_are_reconciled_only_between_chunks() {
        let joined = merge(
            vec![
                result(vec![segment(0.0, 4.0, "Ada dua puluh unit")]),
                result(vec![segment(3.0, 6.0, "dua puluh unit belum dicek")]),
            ],
            8.0,
        );
        assert_eq!(joined.full_text, "Ada dua puluh unit belum dicek");
        let repeat = merge(
            vec![result(vec![
                segment(0.0, 4.0, "dua puluh unit"),
                segment(3.0, 6.0, "dua puluh unit"),
            ])],
            8.0,
        );
        assert_eq!(repeat.full_text, "dua puluh unit dua puluh unit");
    }
    #[test]
    fn chunk_offsets_preserve_the_original_timeline() {
        let chunk = Chunk {
            index: 1,
            start: 120.0,
            end: 240.0,
            audio_start: 119.0,
            audio_end: 241.0,
        };
        let aligned = align(
            result(vec![
                segment(0.0, 1.0, "konteks sebelumnya"),
                segment(1.0, 2.0, "25 unit"),
                segment(121.0, 122.0, "konteks sesudahnya"),
            ]),
            &chunk,
            600.0,
        );
        assert_eq!(aligned.full_text, "25 unit");
        assert_eq!(aligned.segments[0].start, 120.0);
        assert_eq!(aligned.segments[0].end, 121.0);
    }
}
