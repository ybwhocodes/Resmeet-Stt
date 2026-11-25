use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::auth::{hash_password, Authenticated};
use crate::models::CreateUserRequest;
use crate::settings::DatabaseSettings;
use crate::AppState;

pub async fn list_users_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if user.role != "superadmin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Akses khusus Superadmin" })),
        ));
    }

    let rows = sqlx::query(
        r#"
        SELECT id, username, role, is_active, created_at, updated_at
        FROM users
        ORDER BY created_at ASC
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("DB error: {}", e) })),
        )
    })?;

    let users: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let username: String = r.get("username");
            let role: String = r.get("role");
            let is_active: bool = r.get("is_active");
            let created_at: Option<chrono::NaiveDateTime> = r.get("created_at");
            let updated_at: Option<chrono::NaiveDateTime> = r.get("updated_at");

            json!({
                "id": id,
                "username": username,
                "role": role,
                "is_active": is_active,
                "created_at": created_at.map(|t| t.to_string()),
                "updated_at": updated_at.map(|t| t.to_string()),
            })
        })
        .collect();

    Ok(Json(json!({ "users": users })))
}

pub async fn create_user_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if user.role != "superadmin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Akses khusus Superadmin" })),
        ));
    }

    validate_credentials(&payload.username, &payload.password, &payload.role)?;
    let hash = hash_password(&payload.password);
    let new_user_id = Uuid::now_v7();
    let row = sqlx::query(
        r#"
        INSERT INTO users (id, username, password_hash, role, is_active)
        VALUES ($1, $2, $3, $4, true)
        RETURNING id, username, role, is_active
        "#,
    )
    .bind(new_user_id)
    .bind(payload.username.trim())
    .bind(&hash)
    .bind(&payload.role)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Gagal membuat user: {}", e) })),
        )
    })?;

    let id: Uuid = row.get("id");
    let username: String = row.get("username");
    let role: String = row.get("role");
    let is_active: bool = row.get("is_active");

    Ok(Json(json!({
        "success": true,
        "user": {
            "id": id,
            "username": username,
            "role": role,
            "is_active": is_active
        }
    })))
}

pub async fn delete_user_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if user.role != "superadmin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Akses khusus Superadmin" })),
        ));
    }

    if user.id == id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Tidak dapat menghapus akun sendiri." })),
        ));
    }

    let res = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("DB error: {}", e) })),
            )
        })?;

    Ok(Json(json!({
        "success": res.rows_affected() > 0,
        "message": "User berhasil dihapus."
    })))
}

pub async fn update_user_status_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(payload): Json<serde_json::Value>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if user.role != "superadmin" {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Akses khusus Superadmin" }))));
    }
    let is_active = payload.get("is_active").and_then(|v| v.as_bool())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error":"is_active harus berupa boolean."}))))?;
    if user.id == id && !is_active {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Tidak dapat menonaktifkan akun sendiri." }))));
    }

    let _ = sqlx::query("UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2")
        .bind(is_active)
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("DB error: {}", e) }))))?;

    Ok(Json(json!({ "success": true, "message": "Status user berhasil diperbarui." })))
}

pub async fn reset_user_password_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(payload): Json<serde_json::Value>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if user.role != "superadmin" {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Akses khusus Superadmin" }))));
    }

    let new_pass = payload.get("new_password").or_else(|| payload.get("newPassword"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            (StatusCode::BAD_REQUEST, Json(json!({ "error": "Password baru wajib diisi." })))
        })?;

    if new_pass.len() < 12 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error":"Password baru minimal 12 karakter."}))));
    }
    let hash = hash_password(new_pass);
    let mut tx = pool.begin().await.map_err(admin_db_error)?;
    let updated = sqlx::query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2")
        .bind(&hash).bind(id).execute(&mut *tx).await.map_err(admin_db_error)?;
    if updated.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error":"User tidak ditemukan."}))));
    }
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(id).execute(&mut *tx).await.map_err(admin_db_error)?;
    tx.commit().await.map_err(admin_db_error)?;

    Ok(Json(json!({ "success": true, "message": "Password user berhasil direset." })))
}

pub async fn get_database_config(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if user.role != "superadmin" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error":"Akses khusus Superadmin"}))));
    }
    let current = state.db_settings.read().expect("settings lock poisoned").clone();
    let db = current.unwrap_or(DatabaseSettings {
        host: std::env::var("DB_HOST").unwrap_or_else(|_| "postgres".to_string()),
        port: 5432,
        name: std::env::var("DB_NAME").unwrap_or_else(|_| "stt_db".to_string()),
        user: std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string()),
        password: String::new(),
        connect_options: None,
    });
    let connected = sqlx::query("SELECT 1").execute(&state.db_pool()).await.is_ok();
    Ok(Json(json!({
        "dbType": "postgres", "dbHost": db.host, "dbPort": db.port,
        "dbName": db.name, "dbUser": db.user, "connected": connected,
        "managedViaEnv": true
    })))
}

fn admin_db_error(error: sqlx::Error) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error":format!("Database error: {error}")})))
}
fn validate_credentials(username: &str, password: &str, role: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if username.trim().is_empty() || username.chars().count() > 100 || username.chars().any(char::is_control) || password.len() < 12 || !["user", "superadmin"].contains(&role) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error":"Username wajib diisi (maksimal 100 karakter), password minimal 12 karakter, dan role harus user atau superadmin."}))));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_empty_accounts_weak_passwords_and_unknown_roles() {
        assert!(validate_credentials("user", "long-password-123", "user").is_ok());
        assert!(validate_credentials(" ", "long-password-123", "user").is_err());
        assert!(validate_credentials("user", "123", "user").is_err());
        assert!(validate_credentials("user", "long-password-123", "root").is_err());
    }
}
