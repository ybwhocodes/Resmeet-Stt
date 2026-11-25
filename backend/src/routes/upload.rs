use axum::{
    extract::{Multipart, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::auth::Authenticated;
use crate::AppState;

type UploadError = (StatusCode, Json<serde_json::Value>);
fn upload_error(message: impl Into<String>) -> UploadError {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error": message.into()})),
    )
}
fn clean_filename(name: &str) -> Result<String, UploadError> {
    let name = name.rsplit(['/', '\\']).next().unwrap_or_default().trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.chars().any(char::is_control)
        || name.chars().count() > 255
    {
        return Err(upload_error(
            "Nama file tidak valid atau melebihi 255 karakter.",
        ));
    }
    Ok(name.to_string())
}
struct TemporaryUpload(Option<PathBuf>);
impl Drop for TemporaryUpload {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[derive(serde::Deserialize)]
pub struct UploadOptions {
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    background: bool,
}

pub async fn upload_and_transcribe_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
    Query(options): Query<UploadOptions>,
    mut multipart: Multipart,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let mut original_filename = String::new();
    let mut uploaded_path: Option<PathBuf> = None;
    let mut style = "detail_deskriptif".to_string();
    let mut custom_prompt: Option<String> = None;
    let mut model_id: Option<String> = None;
    let mut ai_correction = false;

    // Keep client filenames out of filesystem paths and clean partial uploads on errors.
    let mut temporary = TemporaryUpload(None);
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| upload_error(format!("Multipart tidak valid: {e}")))?
    {
        let name = field.name().unwrap_or_default().to_string();
        if name == "audio" || name == "file" || name == "audioFile" {
            if uploaded_path.is_some() {
                return Err(upload_error("Unggah satu file audio per permintaan."));
            }
            original_filename = clean_filename(field.file_name().unwrap_or("audio_recording.wav"))?;
            let dest = state.config.uploads_dir.join(Uuid::now_v7().to_string());
            let mut file = File::create(&dest).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": format!("File save error: {e}")})),
                )
            })?;
            temporary.0 = Some(dest.clone());
            let mut size = 0usize;
            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|e| upload_error(format!("Upload error: {e}")))?
            {
                size += chunk.len();
                file.write_all(&chunk).await.map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"error": format!("Write error: {e}")})),
                    )
                })?;
            }
            if size == 0 {
                return Err(upload_error("Berkas audio kosong."));
            }
            file.sync_all()
                .await
                .map_err(|e| upload_error(format!("Penyimpanan berkas belum selesai: {e}")))?;
            uploaded_path = Some(dest);
        } else if name == "style" || name == "paraphrase_style" {
            style = field
                .text()
                .await
                .map_err(|e| upload_error(e.to_string()))?;
        } else if name == "custom_prompt" || name == "prompt" {
            custom_prompt = field
                .text()
                .await
                .map_err(|e| upload_error(e.to_string()))?
                .trim()
                .to_owned()
                .into();
        } else if name == "model_id" {
            model_id = Some(
                field
                    .text()
                    .await
                    .map_err(|e| upload_error(e.to_string()))?,
            );
        } else if name == "ai_correction" {
            ai_correction = field
                .text()
                .await
                .map_err(|e| upload_error(e.to_string()))?
                == "true";
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

    let gpu_available = state.config.gpu_info().available;
    let device = super::processing::preferred_device(&state.db_pool(), user.id, gpu_available)
        .await
        .map_err(crate::jobs::api_error)?;
    let job_options = crate::jobs::JobOptions {
        device,
        ai_correction,
        style,
        custom_prompt,
        model_id,
        cleanup_transcript: true,
        document_revision: 0,
    };
    let input_name = input_audio
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| upload_error("Nama berkas antrean tidak valid"))?;
    let job_id = crate::jobs::enqueue(
        &state.db_pool(),
        user.id,
        &original_filename,
        input_name,
        job_options,
    )
    .await
    .map_err(crate::jobs::api_error)?;
    temporary.0 = None; // Ownership transfers to the durable queue only after INSERT commits.
    if options.background {
        return Ok((StatusCode::ACCEPTED, Json(json!({"jobId":job_id}))).into_response());
    }
    if options.stream {
        let context = (state, user.id, job_id, None::<i64>, false);
        let stream = futures_util::stream::unfold(
            context,
            |(state, owner, id, previous, terminal)| async move {
                if terminal {
                    return None;
                }
                let (event, revision, done) = if previous.is_none() {
                    (json!({"type":"job","jobId":id}), Some(-1), false)
                } else {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    match crate::jobs::snapshot(
                        &state.db_pool(),
                        id,
                        owner,
                        previous.filter(|v| *v >= 0),
                    )
                    .await
                    {
                        Ok(Some((snapshot, revision))) => {
                            if !snapshot["terminal"].is_null() {
                                (snapshot["terminal"].clone(), Some(revision), true)
                            } else if previous != Some(revision) {
                                (
                                    if !snapshot["preview"].is_null() {
                                        json!({"type":"transcript","data":snapshot["preview"]})
                                    } else {
                                        snapshot["progress"].clone()
                                    },
                                    Some(revision),
                                    false,
                                )
                            } else {
                                (json!({"type":"heartbeat"}), previous, false)
                            }
                        }
                        Ok(None) => (
                            json!({"type":"error","error":"Job tidak tersedia. Periksa Riwayat."}),
                            previous,
                            true,
                        ),
                        Err(_) => (json!({"type":"heartbeat"}), previous, false),
                    }
                };
                Some((
                    Ok::<_, std::convert::Infallible>(format!("{event}\n")),
                    (state, owner, id, revision, done),
                ))
            },
        );
        return Ok(Response::builder()
            .header("Content-Type", "application/x-ndjson")
            .header("Cache-Control", "no-cache")
            .header("X-Accel-Buffering", "no")
            .body(axum::body::Body::from_stream(stream))
            .unwrap());
    }
    let result = crate::jobs::wait_for_result(&state.db_pool(), job_id, user.id).await?;
    Ok(Json(result).into_response())
}

#[cfg(test)]
mod upload_tests {
    use super::*;
    #[test]
    fn filenames_cannot_control_storage_paths_or_overflow_the_database() {
        assert_eq!(clean_filename("../../rapat.m4a").unwrap(), "rapat.m4a");
        assert_eq!(
            clean_filename("C:\\fakepath\\rapat.wav").unwrap(),
            "rapat.wav"
        );
        for invalid in ["", "..", "bad\nname.wav", &"a".repeat(256)] {
            assert!(clean_filename(invalid).is_err());
        }
    }
}
