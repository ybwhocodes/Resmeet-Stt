use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{auth::{hash_password, verify_password}, db, settings::{self, DatabaseSettings}, AppState};

#[derive(Deserialize)]
pub struct InitialSetupRequest {
    #[serde(flatten)]
    pub database: DatabaseSettings,
    #[serde(rename = "adminUsername")]
    pub admin_username: String,
    #[serde(rename = "adminPassword")]
    pub admin_password: String,
}

pub async fn status_handler(State(state): State<AppState>) -> Json<Value> {
    let configured = state.db_settings.read().expect("settings lock poisoned").is_some();
    let connected = if configured {
        sqlx::query("SELECT 1").execute(&state.db_pool()).await.is_ok()
    } else { false };
    let initialized = if connected {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users").fetch_one(&state.db_pool()).await
            .is_ok_and(|count| count > 0)
    } else { configured };
    Json(json!({ "configured": configured && initialized, "connected": connected,
        "suggestedHost": std::env::var("DB_SETUP_HOST").unwrap_or_else(|_| "postgres".into()) }))
}

pub async fn configure_database_handler(
    State(state): State<AppState>,
    Json(payload): Json<InitialSetupRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _guard = state.setup_lock.lock().await;
    let current = state.db_settings.read().expect("settings lock poisoned").clone();
    // An environment-configured empty database may be initialized, but an anonymous
    // caller must never switch an existing installation to a different database.
    let database = current.clone().unwrap_or_else(|| payload.database.clone());
    database.validate().map_err(bad_request)?;
    if payload.admin_username.trim().is_empty() || payload.admin_username.trim().chars().count() > 100 {
        return Err(bad_request("Username admin wajib diisi, maksimal 100 karakter.".into()));
    }
    let pool = database.connect().await.map_err(|e| bad_request(format!("Koneksi PostgreSQL gagal: {e}")))?;
    if current.is_some() {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(&pool).await
            .map_err(|e| server_error(e.to_string()))?;
        if count > 0 { return Err((StatusCode::FORBIDDEN, Json(json!({"error":"Setup awal sudah selesai. Database dikonfigurasi melalui .env."})))); }
    }
    db::ensure_pg_schema(&pool).await.map_err(|e| server_error(format!("Migrasi skema gagal: {e}")))?;
    crate::secrets::migrate_ai_keys(&pool, &state.secret_cipher).await.map_err(server_error)?;
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool).await.map_err(|e| server_error(e.to_string()))?;
    if user_count == 0 {
        if payload.admin_password.len() < 12 {
            return Err(bad_request("Password superadmin baru minimal 12 karakter.".into()));
        }
        let password_hash = hash_password(&payload.admin_password);
        sqlx::query("INSERT INTO users (id, username, password_hash, role, is_active) VALUES ($1, $2, $3, 'superadmin', true)")
            .bind(Uuid::now_v7())
            .bind(payload.admin_username.trim())
            .bind(password_hash)
            .execute(&pool).await.map_err(|e| server_error(format!("Gagal membuat admin: {e}")))?;
    } else {
        let stored: Option<String> = sqlx::query_scalar("SELECT password_hash FROM users WHERE username = $1 AND role = 'superadmin' AND is_active = true")
            .bind(payload.admin_username.trim()).fetch_optional(&pool).await
            .map_err(|e| server_error(e.to_string()))?;
        if !stored.is_some_and(|hash| verify_password(&payload.admin_password, &hash)) {
            return Err(bad_request("Database sudah memiliki akun. Masukkan kredensial superadmin yang berlaku.".into()));
        }
    }
    settings::save_database(&state.settings_path, &database)
        .map_err(|e| server_error(format!("Gagal menyimpan konfigurasi: {e}")))?;
    *state.pool.write().expect("pool lock poisoned") = pool;
    *state.db_settings.write().expect("settings lock poisoned") = Some(database);
    Ok(Json(json!({"success": true, "message": "PostgreSQL berhasil dikonfigurasi."})))
}

fn bad_request(message: String) -> (StatusCode, Json<Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({"error": message})))
}
fn server_error(message: String) -> (StatusCode, Json<Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": message})))
}
