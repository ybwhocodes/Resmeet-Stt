use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::auth::Authenticated;
use crate::db::{get_user_ai_models, get_ai_gateway};
use crate::models::{ParaphraseRequest, UpdateMomRequest, UserAiModelDto};
use crate::AppState;

#[derive(serde::Deserialize)]
pub struct AiOptions { #[serde(default)] background:bool }
pub async fn paraphrase_handler(
    Authenticated(user):Authenticated,State(state):State<AppState>,Query(options):Query<AiOptions>,Json(payload):Json<ParaphraseRequest>,
)->Result<axum::response::Response,(StatusCode,Json<serde_json::Value>)>{
    let pool=state.db_pool();
    let transcript=crate::db::get_transcript_by_id(&pool,payload.id).await.map_err(database_error)?
        .ok_or_else(||(StatusCode::NOT_FOUND,Json(json!({"error":"Notulen tidak ditemukan."}))))?;
    if user.role!="superadmin" && transcript.user_id!=Some(user.id){return Err((StatusCode::FORBIDDEN,Json(json!({"error":"Akses ditolak."}))));}
    let document_revision:i64=sqlx::query_scalar("SELECT document_revision FROM transcripts WHERE id=$1").bind(transcript.id).fetch_one(&pool).await.map_err(database_error)?;
    let job_options=crate::jobs::JobOptions{device:super::processing::Device::Cpu,ai_correction:true,
        style:payload.style.unwrap_or_else(||"detail_deskriptif".into()),custom_prompt:payload.custom_prompt,model_id:payload.model_id,cleanup_transcript:payload.cleanup_transcript,document_revision};
    let preview=json!({"success":true,"id":transcript.id,"filename":transcript.filename,"momTitle":transcript.mom_title,
        "finalText":transcript.final_text,"rawText":transcript.raw_text,"segments":transcript.word_timestamps,
        "aiSummary":transcript.ai_summary,"aiCorrectionStatus":"pending","aiEnabled":true,"aiError":null,
        "durationS":transcript.duration_s,"generationTimeS":transcript.generation_time_s,"createdAt":transcript.created_at.to_string(),"shareSlug":transcript.share_slug});
    let id=crate::jobs::enqueue_ai(&pool,user.id,transcript.id,&transcript.filename,job_options,preview).await.map_err(|e|{
        if e.as_database_error().is_some_and(|e|e.is_unique_violation()) {(StatusCode::CONFLICT,Json(json!({"error":"AI untuk dokumen ini masih diproses."})))}else{database_error(e)}
    })?;
    if options.background{return Ok((StatusCode::ACCEPTED,Json(json!({"jobId":id}))).into_response());}
    Ok(Json(crate::jobs::wait_for_result(&pool,id,user.id).await?).into_response())
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

    sqlx::query("UPDATE transcripts SET ai_summary = $1, document_docx = NULL, document_revision=document_revision+1 WHERE id = $2")
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
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error":"Daftar models wajib diisi."}))));
    };

    let models: Vec<UserAiModelDto> = serde_json::from_value(models_val)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": format!("Daftar model tidak valid: {e}")}))))?;
    let mut ids = std::collections::HashSet::new();
    if models.len() > 100 || models.iter().filter(|m| m.is_default).count() > 1 || models.iter().any(|m|
        m.model_id.trim().is_empty() || m.model_id.chars().count() > 255 ||
        m.model_name.as_ref().is_some_and(|name| name.chars().count() > 255) || !ids.insert(m.model_id.trim().to_string())) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error":"ID model wajib unik, maksimal 255 karakter, dan hanya satu model default."}))));
    }

    let mut tx = pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Transaction error: {}", e) })),
        )
    })?;

    sqlx::query("DELETE FROM user_ai_models WHERE user_id = $1")
        .bind(user.id)
        .execute(&mut *tx)
        .await.map_err(database_error)?;

    for m in models {
        sqlx::query(
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
        .await.map_err(database_error)?;
    }

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Commit error: {}", e) })),
        )
    })?;

    let updated = get_user_ai_models(&pool, user.id).await.map_err(database_error)?;
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

    let updated = get_user_ai_models(&pool, user.id).await.map_err(database_error)?;
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

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_ai_models WHERE user_id = $1 AND model_id = $2)")
        .bind(user.id).bind(&model_id).fetch_one(&mut *tx).await.map_err(database_error)?;
    if !exists { return Err((StatusCode::NOT_FOUND, Json(json!({"error":"Model tidak ditemukan pada akun Anda."})))); }
    sqlx::query("UPDATE user_ai_models SET is_default = false WHERE user_id = $1")
        .bind(user.id)
        .execute(&mut *tx)
        .await.map_err(database_error)?;

    sqlx::query(
        "UPDATE user_ai_models SET is_default = true WHERE user_id = $1 AND model_id = $2",
    )
    .bind(user.id)
    .bind(&model_id)
    .execute(&mut *tx)
    .await.map_err(database_error)?;

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Commit error: {}", e) })),
        )
    })?;

    let updated = get_user_ai_models(&pool, user.id).await.map_err(database_error)?;
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
        (base_url, !sealed.is_empty() && state.secret_cipher.open(user.id, &hash, &sealed).is_ok())
    } else { (String::new(), false) };
    let models = get_user_ai_models(&state.db_pool(), user.id).await.unwrap_or_default();
    let configured = has_key && !base_url.trim().is_empty() && models.iter().any(|model| !model.model_id.trim().is_empty());
    Ok(Json(json!({
        "configured": configured,
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

fn database_error(error: sqlx::Error) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error":format!("Database error: {error}")})))
}
