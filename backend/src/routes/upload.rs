use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use serde_json::json;
use sqlx::Row;
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::ai::{call_ai_paraphrase, smooth_dialogue_flow};
use crate::auth::Authenticated;
use crate::db::get_ai_gateway;
use crate::whisper::{convert_with_ffmpeg, transcribe_with_whisper};
use crate::AppState;

pub async fn upload_and_transcribe_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let mut original_filename = String::new();
    let mut uploaded_path: Option<PathBuf> = None;
    let mut style = "poin_singkat".to_string();
    let mut custom_prompt: Option<String> = None;
    let mut model_id: Option<String> = None;
    let mut ai_correction = true;

    // 1. Process multipart fields
    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or_default().to_string();
        if name == "audio" || name == "file" || name == "audioFile" {
            let file_name = field
                .file_name()
                .unwrap_or("audio_recording.wav")
                .to_string();
            original_filename = file_name.clone();

            let safe_id = Uuid::now_v7().to_string();
            let dest = state.config.uploads_dir.join(format!("{}_{}", safe_id, file_name));

            let data = field.bytes().await.map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("Upload error: {}", e) })),
                )
            })?;

            let mut file = File::create(&dest).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": format!("File save error: {}", e) })),
                )
            })?;

            file.write_all(&data).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": format!("Write error: {}", e) })),
                )
            })?;

            uploaded_path = Some(dest);
        } else if name == "style" || name == "paraphrase_style" {
            if let Ok(val) = field.text().await {
                style = val;
            }
        } else if name == "custom_prompt" || name == "prompt" {
            custom_prompt = field.text().await.ok().filter(|p| !p.trim().is_empty());
        } else if name == "model_id" {
            model_id = field.text().await.ok();
        } else if name == "ai_correction" {
            ai_correction = field.text().await.map(|value| value != "false").unwrap_or(true);
        }
    }

    let input_audio = match uploaded_path {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Tidak ada file audio yang diunggah" })),
            ));
        }
    };

    // 2. Convert to 16kHz WAV using FFmpeg
    let wav_path = input_audio.with_extension("16k.wav");
    let convert_res = convert_with_ffmpeg(&input_audio, &wav_path).await;

    // Remove the initial uploaded raw file immediately after conversion to prevent disk accumulation
    let _ = tokio::fs::remove_file(&input_audio).await;

    if let Err(e) = convert_res {
        let _ = tokio::fs::remove_file(&wav_path).await;
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Konversi audio gagal: {}", e) })),
        ));
    }

    // 3. Run Whisper transcription
    let final_model = state.config.model_path();
    if !final_model.is_file() {
        let _ = tokio::fs::remove_file(&wav_path).await;
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": format!("Model Whisper tidak ditemukan: {}", final_model.display()) })),
        ));
    }

    let whisper_res = transcribe_with_whisper(&wav_path, &final_model, state.config.cpu_threads).await;

    // Always remove temporary 16k WAV file regardless of whisper success or failure
    let _ = tokio::fs::remove_file(&wav_path).await;

    let result = whisper_res.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Whisper transcription error: {}", e) })),
        )
    })?;

    // 4. Laya Decision Engine: Chronological dialogue smoothing & MoM summary
    let pool = state.db_pool();
    let gateway = get_ai_gateway(&pool, &state.secret_cipher, user.id, model_id.as_deref()).await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Konfigurasi AI tidak dapat dibaca: {error}")}))))?;

    let mut dialog_turns = Vec::new();
    let mut ai_summary = None;

    if ai_correction && !result.full_text.is_empty() {
        if let Some(ref gw) = gateway {
            // Context smoothing for dialogue flow
            let segments_raw: String = result.segments.iter().map(|s| {
                let m_start = (s.start / 60.0).floor() as u32;
                let s_start = (s.start % 60.0).round() as u32;
                let m_end = (s.end / 60.0).floor() as u32;
                let s_end = (s.end % 60.0).round() as u32;
                format!("[{:02}:{:02} - {:02}:{:02}] {}", m_start, s_start, m_end, s_end, s.text)
            }).collect::<Vec<_>>().join("\n");

            if let Ok(turns) = smooth_dialogue_flow(&segments_raw, &gw.base_url, &gw.api_key, &gw.model_id).await {
                if !turns.is_empty() {
                    dialog_turns = turns;
                }
            }

            // MoM generation
            ai_summary = call_ai_paraphrase(
                &result.full_text,
                &style,
                custom_prompt.as_deref(),
                &gw.base_url,
                &gw.api_key,
                &gw.model_id,
            ).await.ok();
        }
    }

    let new_transcript_id = Uuid::now_v7();
    let now = Utc::now();
    // Share slug format: tanggal-menit-UUID (e.g. 20261116-0330-0193...)
    let share_slug = format!("{}-{}", now.format("%Y%m%d-%H%M"), new_transcript_id);

    let ai_data_json = json!({
        "dialog_transcript": dialog_turns,
        "decision_engine": "Laya",
        "engine_repo": "https://github.com/NandhaKishorM/laya.git"
    });

    let word_ts_json = serde_json::to_value(&result.segments).ok();
    let saved_row = sqlx::query(
        r#"
        INSERT INTO transcripts (
            id, user_id, filename, final_text, raw_text,
            duration_s, generation_time_s, language,
            word_timestamps, ai_summary, ai_correction_status,
            ai_data, share_slug, is_public
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id, created_at
        "#,
    )
    .bind(new_transcript_id)
    .bind(user.id)
    .bind(&original_filename)
    .bind(&result.full_text)
    .bind(&result.raw_text)
    .bind(result.duration_s)
    .bind(result.generation_time_s)
    .bind("id")
    .bind(word_ts_json)
    .bind(&ai_summary)
    .bind("completed")
    .bind(ai_data_json)
    .bind(&share_slug)
    .bind(false)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("DB save error: {}", e) })),
        )
    })?;

    let saved_id: Uuid = saved_row.get("id");
    let created_at: chrono::NaiveDateTime = saved_row.get("created_at");

    Ok(Json(json!({
        "success": true,
        "id": saved_id,
        "filename": original_filename,
        "finalText": result.full_text,
        "rawText": result.raw_text,
        "segments": result.segments,
        "dialogTranscript": dialog_turns,
        "durationS": result.duration_s,
        "generationTimeS": result.generation_time_s,
        "aiSummary": ai_summary,
        "shareSlug": share_slug,
        "createdAt": created_at.to_string()
    })))
}
