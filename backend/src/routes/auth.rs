use axum::{
    extract::State,
    http::{header::AUTHORIZATION, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::auth::{verify_password, Authenticated};
use crate::models::{AuthUser, LoginRequest, LoginResponse};

pub async fn login_handler(
    State(pool): State<PgPool>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (StatusCode, Json<serde_json::Value>)> {
    let row = sqlx::query(
        r#"
        SELECT id, username, password_hash, role, is_active
        FROM users
        WHERE username = $1
        "#,
    )
    .bind(&payload.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Database error: {}", e) })),
        )
    })?;

    let user_row = match row {
        Some(u) => u,
        None => {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Username atau password salah." })),
            ));
        }
    };

    let is_active: bool = user_row.get("is_active");
    if !is_active {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Akun Anda dinonaktifkan." })),
        ));
    }

    let password_hash: String = user_row.get("password_hash");
    if !verify_password(&payload.password, &password_hash) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Username atau password salah." })),
        ));
    }

    let user_id: Uuid = user_row.get("id");
    let username: String = user_row.get("username");
    let role: String = user_row.get("role");

    let (token, expires_at) =
        crate::db::create_session(&pool, user_id, payload.remember_me)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": format!("Gagal membuat session: {}", e) })),
                )
            })?;

    Ok(Json(LoginResponse {
        success: true,
        token,
        user: AuthUser {
            id: user_id,
            username,
            role,
            is_active,
        },
        expires_at,
    }))
}

pub async fn me_handler(Authenticated(user): Authenticated) -> Json<AuthUser> {
    Json(user)
}

pub async fn logout_handler(
    State(pool): State<PgPool>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Some(auth) = headers.get(AUTHORIZATION) {
        if let Ok(s) = auth.to_str() {
            if s.starts_with("Bearer ") {
                let token = s[7..].trim();
                let _ = sqlx::query("DELETE FROM sessions WHERE token = $1")
                    .bind(token)
                    .execute(&pool)
                    .await;
            }
        }
    }
    Json(json!({ "success": true, "message": "Berhasil logout." }))
}
