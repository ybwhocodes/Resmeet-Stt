use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use crate::{auth::Authenticated, config::AppConfig, AppState};

type ApiError = (StatusCode, Json<Value>);

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Device { #[default] Cpu, Gpu }
impl Device {
    pub fn as_str(self) -> &'static str { match self { Self::Cpu => "cpu", Self::Gpu => "gpu" } }
    pub fn use_gpu(self, available: bool) -> bool { self == Self::Gpu && available }
}
#[derive(Deserialize)]
pub struct ProcessingSettings { device: Device }

pub async fn preferred_device(pool: &sqlx::PgPool, user_id: Uuid, gpu_available: bool) -> Result<Device, sqlx::Error> {
    let device: Option<String> = sqlx::query_scalar("SELECT device FROM user_transcription_settings WHERE user_id = $1")
        .bind(user_id).fetch_optional(pool).await?;
    Ok(match device.as_deref() {
        Some("gpu") => Device::Gpu,
        Some("cpu") => Device::Cpu,
        _ => if gpu_available { Device::Gpu } else { Device::Cpu },
    })
}
fn payload(config: &AppConfig, device: Device) -> Value {
    let gpu = config.gpu_info();
    json!({
        "device": device, "effectiveDevice": if device.use_gpu(gpu.available) { "gpu" } else { "cpu" },
        "gpuDetected": gpu.detected, "gpuAvailable": gpu.available, "gpuName": gpu.name,
        "cpuThreads": config.cpu_threads, "batchSize": config.stt_batch_size,
        "model": config.whisper_model,
    })
}
pub async fn get_settings(Authenticated(user): Authenticated, State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let gpu_available = state.config.gpu_info().available;
    let device = preferred_device(&state.db_pool(), user.id, gpu_available).await.map_err(db_error)?;
    Ok(Json(payload(&state.config, device)))
}
pub async fn save_settings(Authenticated(user): Authenticated, State(state): State<AppState>, Json(settings): Json<ProcessingSettings>) -> Result<Json<Value>, ApiError> {
    if settings.device == Device::Gpu && !state.config.gpu_info().available {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error":"GPU belum dapat digunakan oleh backend. Pilih CPU atau periksa akses GPU dan model native."}))));
    }
    sqlx::query("INSERT INTO user_transcription_settings (user_id, device) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET device = EXCLUDED.device")
        .bind(user.id).bind(settings.device.as_str()).execute(&state.db_pool()).await.map_err(db_error)?;
    Ok(Json(payload(&state.config, settings.device)))
}
fn db_error(error: sqlx::Error) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error":format!("Pengaturan transkripsi gagal dibaca/disimpan: {error}")})))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cpu_is_default_and_gpu_requires_an_available_device() {
        assert_eq!(Device::default(), Device::Cpu);
        assert!(!Device::Cpu.use_gpu(true));
        assert!(!Device::Gpu.use_gpu(false));
        assert!(Device::Gpu.use_gpu(true));
        assert!(serde_json::from_value::<ProcessingSettings>(json!({"device":"auto"})).is_err());
    }
}
