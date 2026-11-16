use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::ai::call_ai_paraphrase;
use crate::auth::Authenticated;
use crate::db::{get_user_ai_models, get_ai_gateway};
use crate::models::{ParaphraseRequest, UpdateMomRequest, UserAiModelDto};
use crate::AppState;

pub async fn paraphrase_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
    Json(payload): Json<ParaphraseRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db_pool();
    let row = sqlx::query(
        r#"
        SELECT id, user_id, final_text, raw_text
        FROM transcripts
        WHERE id = $1
        "#,
    )
    .bind(payload.id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("DB error: {}", e) })),
        )
    })?;

    let transcript = match row {
        Some(t) => {
            let user_id: Option<Uuid> = t.get("user_id");
            if user.role != "superadmin" && user_id != Some(user.id) {
                return Err((
                    StatusCode::FORBIDDEN,
                    Json(json!({ "error": "Akses ditolak" })),
                ));
            }
            t
        }
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Notulen tidak ditemukan" })),
            ));
        }
    };

    let style = payload.style.unwrap_or_else(|| "poin_singkat".to_string());
    let final_text: String = transcript.get("final_text");
    let raw_text: Option<String> = transcript.get("raw_text");
    let source_text = if !final_text.is_empty() {
        final_text
    } else {
        raw_text.unwrap_or_default()
    };

    let gateway = get_ai_gateway(&pool, &state.secret_cipher, user.id, payload.model_id.as_deref()).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Konfigurasi Gateway AI atau model belum tersedia di menu Model AI."}))))?;
    
    let summary_md = call_ai_paraphrase(
        &source_text,
        &style,
        payload.custom_prompt.as_deref(),
        &gateway.base_url,
        &gateway.api_key,
        &gateway.model_id,
    )
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("AI error: {}", e) })),
        )
    })?;

    sqlx::query(
        r#"
        UPDATE transcripts
        SET ai_summary = $1, ai_correction_status = 'paraphrased'
        WHERE id = $2
        "#,
    )
    .bind(&summary_md)
    .bind(payload.id)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to update DB: {}", e) })),
        )
    })?;

    Ok(Json(json!({
        "success": true,
        "aiSummary": summary_md,
        "style": style
    })))
}

pub async fn update_mom_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateMomRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db_pool();

    let check_row = sqlx::query("SELECT user_id FROM transcripts WHERE id = $1")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let Some(r) = check_row else {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Notulen tidak ditemukan."}))));
    };

    let owner_id: Option<Uuid> = r.get("user_id");
    if user.role != "superadmin" && owner_id != Some(user.id) {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Akses ditolak."}))));
    }

    sqlx::query("UPDATE transcripts SET ai_summary = $1 WHERE id = $2")
        .bind(&payload.content)
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(json!({
        "success": true,
        "message": "Dokumen MoM berhasil disimpan."
    })))
}

pub async fn get_ai_models_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let models = get_user_ai_models(&pool, user.id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("DB error: {}", e) })),
        )
    })?;

    Ok(Json(json!({ "models": models })))
}

pub async fn save_ai_models_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Json(payload): Json<serde_json::Value>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let models_val = if payload.is_array() {
        payload
    } else if let Some(m) = payload.get("models") {
        m.clone()
    } else {
        serde_json::json!([])
    };

    let models: Vec<UserAiModelDto> = serde_json::from_value(models_val).unwrap_or_default();

    let mut tx = pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Transaction error: {}", e) })),
        )
    })?;

    let _ = sqlx::query("DELETE FROM user_ai_models WHERE user_id = $1")
        .bind(user.id)
        .execute(&mut *tx)
        .await;

    for m in models {
        let _ = sqlx::query(
            r#"
            INSERT INTO user_ai_models (id, user_id, model_id, model_name, is_default)
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user.id)
        .bind(&m.model_id)
        .bind(&m.model_name)
        .bind(m.is_default)
        .execute(&mut *tx)
        .await;
    }

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Commit error: {}", e) })),
        )
    })?;

    let updated = get_user_ai_models(&pool, user.id).await.unwrap_or_default();
    Ok(Json(json!({ "success": true, "message": "Model AI berhasil disimpan.", "models": updated })))
}

pub async fn delete_user_ai_model_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let res = sqlx::query("DELETE FROM user_ai_models WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user.id)
        .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("DB error: {}", e) })),
            )
        })?;

    let updated = get_user_ai_models(&pool, user.id).await.unwrap_or_default();
    Ok(Json(json!({
        "success": res.rows_affected() > 0,
        "message": "Model AI berhasil dihapus.",
        "models": updated
    })))
}

#[derive(serde::Deserialize)]
pub struct SetDefaultAiModelRequest {
    pub model_id: Option<String>,
    #[serde(rename = "modelId")]
    pub model_id_camel: Option<String>,
}

pub async fn set_default_ai_model_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Json(payload): Json<SetDefaultAiModelRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let model_id = payload.model_id.or(payload.model_id_camel).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Model ID wajib diisi." })),
        )
    })?;

    let mut tx = pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Transaction error: {}", e) })),
        )
    })?;

    let _ = sqlx::query("UPDATE user_ai_models SET is_default = false WHERE user_id = $1")
        .bind(user.id)
        .execute(&mut *tx)
        .await;

    let _ = sqlx::query(
        "UPDATE user_ai_models SET is_default = true WHERE user_id = $1 AND model_id = $2",
    )
    .bind(user.id)
    .bind(&model_id)
    .execute(&mut *tx)
    .await;

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Commit error: {}", e) })),
        )
    })?;

    let updated = get_user_ai_models(&pool, user.id).await.unwrap_or_default();
    Ok(Json(json!({
        "success": true,
        "message": format!("Model '{}' berhasil diatur sebagai default akun Anda.", model_id),
        "models": updated,
    })))
}

pub async fn get_ai_settings_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let row = sqlx::query("SELECT base_url, api_key_hash, api_key_ciphertext FROM user_ai_settings WHERE user_id = $1")
        .bind(user.id).fetch_optional(&state.db_pool()).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let (base_url, has_key) = if let Some(row) = row {
        let base_url: String = row.get("base_url");
        let hash: String = row.get("api_key_hash");
        let sealed: String = row.get("api_key_ciphertext");
        if !sealed.is_empty() {
            let _ = state.secret_cipher.open(user.id, &hash, &sealed);
        }
        (base_url, !sealed.is_empty())
    } else { (String::new(), false) };
    Ok(Json(json!({
        "baseUrl": base_url, "hasApiKey": has_key,
        "aiEnableCorrection": true, "aiEnableRag": true,
        "aiEnableKnowledgeExtraction": true, "aiTimeoutS": 120
    })))
}

#[derive(serde::Deserialize)]
pub struct SaveAiSettingsRequest {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

pub async fn save_ai_settings_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
    Json(payload): Json<SaveAiSettingsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let base_url = payload.base_url.trim().trim_end_matches('/');
    if !(base_url.starts_with("https://") || base_url.starts_with("http://")) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error":"AI Base URL harus diawali http:// atau https://."}))));
    }
    let pool = state.db_pool();
    let key = payload.api_key.filter(|key| !key.is_empty());
    let existing: Option<(String, String)> = sqlx::query_as("SELECT api_key_hash, api_key_ciphertext FROM user_ai_settings WHERE user_id = $1")
        .bind(user.id).fetch_optional(&pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let (hash, sealed) = if let Some(plaintext) = key {
        state.secret_cipher.seal(user.id, &plaintext)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))))?
    } else {
        existing.filter(|(_, sealed)| !sealed.is_empty()).ok_or_else(||
            (StatusCode::BAD_REQUEST, Json(json!({"error":"AI API Key wajib diisi."}))))?
    };
    sqlx::query("INSERT INTO user_ai_settings (user_id, base_url, api_key_hash, api_key_ciphertext) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO UPDATE SET base_url = EXCLUDED.base_url, api_key_hash = EXCLUDED.api_key_hash, api_key_ciphertext = EXCLUDED.api_key_ciphertext, updated_at = NOW()")
        .bind(user.id).bind(base_url).bind(hash).bind(sealed).execute(&pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!({"success": true, "message": "Gateway AI berhasil disimpan."})))
}

pub async fn test_ai_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let gateway = get_ai_gateway(&state.db_pool(), &state.secret_cipher, user.id, None).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error":"Gateway AI atau model belum dikonfigurasi."}))))?;
    let result = crate::ai::test_ai_connection(&gateway.base_url, &gateway.api_key, &gateway.model_id).await;
    Ok(Json(json!({
        "success": result.is_ok(), "message": result.unwrap_or_else(|error| error),
        "modelId": gateway.model_id, "baseUrl": gateway.base_url
    })))
}
