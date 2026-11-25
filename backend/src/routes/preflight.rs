use axum::{extract::State, response::IntoResponse, Json};
use serde_json::json;
use std::fs::OpenOptions;
use tokio::process::Command;

use crate::db::has_configured_ai_gateway;
use crate::models::HealthResponse;
use crate::AppState;

pub async fn health_handler(
    State(state): State<AppState>,
) -> Json<HealthResponse> {
    let pool = state.db_pool();
    let db_ok = sqlx::query("SELECT 1").execute(&pool).await.is_ok();
    Json(HealthResponse {
        status: if db_ok { "ok".to_string() } else { "degraded".to_string() },
        database: if db_ok { "connected".to_string() } else { "disconnected".to_string() },
        uptime: state.started.elapsed().as_secs(),
    })
}

pub async fn preflight_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let pool = state.db_pool();
    let config = &state.config;
    let ffmpeg_ok = Command::new("ffmpeg").arg("-version").output().await.is_ok_and(|output| output.status.success());
    let whisper_ok=config.faster_available() || config.native_server().is_some();
    let db_ok = sqlx::query("SELECT 1").execute(&pool).await.is_ok();
    let model_path = config.model_path();
    let model_ok = config.faster_available() || (model_path.is_file() && model_path.metadata().is_ok_and(|meta| meta.len() > 0));
    let write_probe = config.uploads_dir.join(format!(".preflight-{}", uuid::Uuid::new_v4()));
    let uploads_ok = config.uploads_dir.is_dir() && OpenOptions::new()
        .create(true)
        .write(true)
        .create_new(true)
        .open(&write_probe)
        .map(|_| {
            let _ = std::fs::remove_file(&write_probe);
        })
        .is_ok();

    // Check if AI Gateway is configured in user_ai_settings and decryptable
    let ai_gateway_ok = db_ok && has_configured_ai_gateway(&pool, &state.secret_cipher).await;

    // Check available models in model_dir
    let mut available_models = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&config.model_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".bin") && !name.contains("silero") {
                    available_models.push(name.to_string());
                }
            }
        }
    }

    let worker_ok=db_ok && crate::jobs::available(&pool,"transcription").await;
    let ai_worker_ok=db_ok && crate::jobs::available(&pool,"ai").await;
    let all_ready = db_ok && ffmpeg_ok && whisper_ok && model_ok && uploads_ok && worker_ok;

    Json(json!({
        "ready": all_ready,
        "checks": {
            "transcriptionWorker": worker_ok,
            "aiWorker": ai_worker_ok,
            "database": db_ok,
            "ffmpeg": ffmpeg_ok,
            "whisperCli": whisper_ok,
            "whisperModel": model_ok,
            "uploadsWritable": uploads_ok,
            "aiGateway": ai_gateway_ok
        },
        "ffmpeg": ffmpeg_ok,
        "whisperCli": whisper_ok,
        "databaseConnected": db_ok,
        "aiGatewayConfigured": ai_gateway_ok,
        "dbType": "postgres",
        "defaultModel": model_path.file_name().and_then(|name| name.to_str()).unwrap_or_default(),
        "availableModels": available_models,
        "gpuDetected": config.gpu_info().detected,
        "gpuAvailable": config.gpu_info().available,
        "cpuThreads": config.cpu_threads,
        "transcriptionEngine": if config.faster_available() { "faster-whisper-int8" } else { "whisper.cpp" },
        "vadAvailable": config.faster_available() || (config.vad_enabled && config.vad_model.is_file()),
        "batchSize": config.stt_batch_size
    }))
}
