use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::auth::Authenticated;
use crate::db::{get_active_knowledge_for_user, get_transcript_by_id};
use crate::models::KnowledgeRecord;
use crate::nlp::analyze_transcript;
use crate::AppState;

type ApiError = (StatusCode, Json<serde_json::Value>);

fn db_error(e: sqlx::Error) -> ApiError {
    if e.as_database_error().is_some_and(|db| db.is_unique_violation()) {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Istilah dengan kategori dan nama tersebut sudah ada dalam Knowledge Anda." })),
        );
    }
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": format!("Database knowledge gagal: {e}") })),
    )
}

#[derive(Debug, Deserialize)]
pub struct ListKnowledgeQuery {
    pub search: Option<String>,
    pub category: Option<String>,
    pub active_only: Option<bool>,
}

pub async fn list_knowledge_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Query(query): Query<ListKnowledgeQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let search = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));
    let category = query
        .category
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "semua")
        .map(ToString::to_string);
    let active_only = query.active_only.unwrap_or(false);

    let items = sqlx::query_as::<_, KnowledgeRecord>(
        r#"
        SELECT id, user_id, category, title, aliases, content, source, is_active, created_at, updated_at
        FROM knowledge
        WHERE (user_id = $1 OR user_id IS NULL)
          AND ($2::TEXT IS NULL OR title ILIKE $2 OR aliases ILIKE $2 OR content ILIKE $2 OR COALESCE(source, '') ILIKE $2)
          AND ($3::TEXT IS NULL OR LOWER(category) = LOWER($3))
          AND (NOT $4 OR is_active = TRUE)
        ORDER BY is_active DESC, updated_at DESC, title ASC
        "#,
    )
    .bind(user.id)
    .bind(&search)
    .bind(&category)
    .bind(active_only)
    .fetch_all(&pool)
    .await
    .map_err(db_error)?;

    Ok(Json(json!({ "items": items })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertKnowledgeRequest {
    pub category: Option<String>,
    pub title: String,
    #[serde(default)]
    pub aliases: String,
    #[serde(default)]
    pub content: String,
    pub source: Option<String>,
    pub is_active: Option<bool>,
    pub is_global: Option<bool>,
}

fn clean_knowledge_input(payload: &UpsertKnowledgeRequest) -> Result<(String, String, String, String, Option<String>, bool), ApiError> {
    let category = payload
        .category
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Istilah / Nama")
        .to_string();
    let title = payload.title.trim().to_string();
    let aliases = payload.aliases.trim().to_string();
    let content = payload.content.trim().to_string();
    let source = payload
        .source
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);
    let is_active = payload.is_active.unwrap_or(true);

    if title.is_empty() || title.chars().count() > 255 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Istilah baku (Target) wajib diisi, maksimal 255 karakter." })),
        ));
    }
    if category.chars().count() > 50 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Kategori maksimal 50 karakter." })),
        ));
    }
    if source.as_ref().is_some_and(|s| s.chars().count() > 255) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Sumber maksimal 255 karakter." })),
        ));
    }

    Ok((category, title, aliases, content, source, is_active))
}

pub async fn create_knowledge_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Json(payload): Json<UpsertKnowledgeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let (category, title, aliases, content, source, is_active) = clean_knowledge_input(&payload)?;
    let owner_id = if user.role == "superadmin" && payload.is_global.unwrap_or(false) {
        None
    } else {
        Some(user.id)
    };
    let id = Uuid::now_v7();

    let item = sqlx::query_as::<_, KnowledgeRecord>(
        r#"
        INSERT INTO knowledge (id, user_id, category, title, aliases, content, source, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, user_id, category, title, aliases, content, source, is_active, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(owner_id)
    .bind(&category)
    .bind(&title)
    .bind(&aliases)
    .bind(&content)
    .bind(&source)
    .bind(is_active)
    .fetch_one(&pool)
    .await
    .map_err(db_error)?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "message": "Knowledge NLP berhasil ditambahkan.",
            "item": item
        })),
    ))
}

pub async fn update_knowledge_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpsertKnowledgeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let existing = sqlx::query("SELECT user_id FROM knowledge WHERE id = $1")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "Data knowledge tidak ditemukan." }))))?;

    let owner_id: Option<Uuid> = existing.get("user_id");
    if user.role != "superadmin" && owner_id != Some(user.id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Anda tidak memiliki izin mengubah entri knowledge global atau milik pengguna lain." })),
        ));
    }

    let (category, title, aliases, content, source, is_active) = clean_knowledge_input(&payload)?;
    let next_owner = if user.role == "superadmin" && payload.is_global.is_some() {
        if payload.is_global == Some(true) { None } else { owner_id.or(Some(user.id)) }
    } else {
        owner_id
    };

    let item = sqlx::query_as::<_, KnowledgeRecord>(
        r#"
        UPDATE knowledge
        SET user_id = $2,
            category = $3,
            title = $4,
            aliases = $5,
            content = $6,
            source = $7,
            is_active = $8,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, user_id, category, title, aliases, content, source, is_active, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(next_owner)
    .bind(&category)
    .bind(&title)
    .bind(&aliases)
    .bind(&content)
    .bind(&source)
    .bind(is_active)
    .fetch_one(&pool)
    .await
    .map_err(db_error)?;

    Ok(Json(json!({
        "success": true,
        "message": "Knowledge NLP berhasil diperbarui.",
        "item": item
    })))
}

pub async fn delete_knowledge_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let existing = sqlx::query("SELECT user_id FROM knowledge WHERE id = $1")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "Data knowledge tidak ditemukan." }))))?;

    let owner_id: Option<Uuid> = existing.get("user_id");
    if user.role != "superadmin" && owner_id != Some(user.id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Anda tidak memiliki izin menghapus entri knowledge global atau milik pengguna lain." })),
        ));
    }

    sqlx::query("DELETE FROM knowledge WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(db_error)?;

    Ok(Json(json!({
        "success": true,
        "message": "Knowledge NLP berhasil dihapus."
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeKnowledgeRequest {
    pub text: Option<String>,
    pub transcript_id: Option<Uuid>,
}

pub async fn analyze_knowledge_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
    Json(payload): Json<AnalyzeKnowledgeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state.db_pool();
    let source_text = if let Some(text) = payload.text.filter(|t| !t.trim().is_empty()) {
        text
    } else if let Some(tid) = payload.transcript_id {
        let transcript = get_transcript_by_id(&pool, tid)
            .await
            .map_err(db_error)?
            .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "Transkrip tidak ditemukan." }))))?;
        if user.role != "superadmin" && transcript.user_id != Some(user.id) {
            return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Akses ditolak." }))));
        }
        transcript.final_text
    } else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Masukkan teks transkrip atau pilih ID notulen untuk dianalisis NLP." })),
        ));
    };

    let entries = get_active_knowledge_for_user(&pool, user.id)
        .await
        .map_err(db_error)?;
    let analysis = analyze_transcript(&source_text, &entries);

    Ok(Json(json!({
        "success": true,
        "analysis": analysis
    })))
}
