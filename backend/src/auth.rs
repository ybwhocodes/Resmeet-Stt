use axum::{
    extract::{FromRef, FromRequestParts},
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use hmac::Hmac;
use rand::RngCore;
use serde_json::json;
use sha2::Sha512;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::models::AuthUser;

const PBKDF2_ROUNDS: u32 = 10_000;
const KEY_LEN: usize = 64;

pub fn hash_password(password: &str) -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);

    let mut key = [0u8; KEY_LEN];
    pbkdf2::pbkdf2::<Hmac<Sha512>>(password.as_bytes(), &salt, PBKDF2_ROUNDS, &mut key)
        .expect("PBKDF2 derivation failed");

    format!("{}:{}", hex::encode(salt), hex::encode(key))
}

pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    let parts: Vec<&str> = stored_hash.split(':').collect();
    if parts.len() != 2 {
        return false;
    }

    let salt = match hex::decode(parts[0]) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let expected_hash = parts[1];

    let mut key = [0u8; KEY_LEN];
    if pbkdf2::pbkdf2::<Hmac<Sha512>>(password.as_bytes(), &salt, PBKDF2_ROUNDS, &mut key).is_err()
    {
        return false;
    }

    hex::encode(key) == expected_hash
}

pub fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn extract_token(parts: &Parts) -> Option<String> {
    if let Some(auth_header) = parts.headers.get(AUTHORIZATION) {
        if let Ok(auth_str) = auth_header.to_str() {
            if auth_str.starts_with("Bearer ") {
                return Some(auth_str[7..].trim().to_string());
            }
        }
    }
    None
}

/// Axum Extractor for authenticated user
pub struct Authenticated(pub AuthUser);

impl<S> FromRequestParts<S> for Authenticated
where
    PgPool: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let pool = PgPool::from_ref(state);
        let token = match extract_token(parts) {
            Some(t) => t,
            None => {
                let body = Json(json!({ "error": "Unauthorized: Missing Authorization header" }));
                return Err((StatusCode::UNAUTHORIZED, body).into_response());
            }
        };

        let row = sqlx::query(
            r#"
            SELECT u.id, u.username, u.role, u.is_active, s.expires_at
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = $1
            "#,
        )
        .bind(token)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            let body = Json(json!({ "error": format!("Database error: {}", e) }));
            (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
        })?;

        match row {
            Some(r) => {
                let is_active: bool = r.get("is_active");
                if !is_active {
                    let body = Json(json!({ "error": "User account is inactive" }));
                    return Err((StatusCode::FORBIDDEN, body).into_response());
                }

                let expires_at: chrono::NaiveDateTime = r.get("expires_at");
                if expires_at < chrono::Utc::now().naive_utc() {
                    let body = Json(json!({ "error": "Session expired" }));
                    return Err((StatusCode::UNAUTHORIZED, body).into_response());
                }

                let id: Uuid = r.get("id");
                Ok(Authenticated(AuthUser {
                    id,
                    username: r.get("username"),
                    role: r.get("role"),
                    is_active,
                }))
            }
            None => {
                let body = Json(json!({ "error": "Invalid or expired session token" }));
                Err((StatusCode::UNAUTHORIZED, body).into_response())
            }
        }
    }
}
