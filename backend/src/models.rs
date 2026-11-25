use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: Uuid,
    pub username: String,
    pub role: String,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub remember_me: bool,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub success: bool,
    pub token: String,
    pub user: AuthUser,
    pub expires_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserAiModelDto {
    pub id: Option<Uuid>,
    pub model_id: String,
    pub model_name: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    #[serde(default = "default_user_role")]
    pub role: String,
}

fn default_user_role() -> String {
    "user".to_string()
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub role: Option<String>,
    pub is_active: Option<bool>,
    pub password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct TranscriptRecord {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub filename: String,
    pub mom_title: Option<String>,
    pub final_text: String,
    pub created_at: NaiveDateTime,
    pub duration_s: Option<f32>,
    pub generation_time_s: Option<f32>,
    pub language: Option<String>,
    pub word_timestamps: Option<serde_json::Value>,
    pub raw_text: Option<String>,
    pub ai_corrected_text: Option<String>,
    pub ai_summary: Option<String>,
    pub md_path: Option<String>,
    pub ai_correction_status: Option<String>,
    pub directed_topics: Option<serde_json::Value>,
    pub ai_data: Option<serde_json::Value>,
    pub share_slug: Option<String>,
    pub is_public: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ParaphraseRequest {
    pub id: Uuid,
    pub style: Option<String>,
    pub model_id: Option<String>,
    pub custom_prompt: Option<String>,
    #[serde(default)]
    pub cleanup_transcript: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMomRequest {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub database: String,
    pub uptime: u64,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct PreflightResponse {
    pub ffmpeg: bool,
    pub whisper_cli: bool,
    pub database_connected: bool,
    pub default_model: String,
    pub available_models: Vec<String>,
    pub cpu_threads: usize,
}
