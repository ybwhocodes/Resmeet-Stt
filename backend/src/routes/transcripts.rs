use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::Authenticated;
use crate::db::{delete_transcript, get_transcripts, get_transcript_by_id, get_transcript_by_share_slug};

#[derive(Debug, Deserialize)]
pub struct ListTranscriptsQuery {
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub page: Option<i64>,
    pub start_date: Option<chrono::NaiveDate>,
    pub end_date: Option<chrono::NaiveDate>,
}

pub async fn list_transcripts_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Query(query): Query<ListTranscriptsQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let page = query.page.unwrap_or(1).max(1);
    let offset = (page - 1).saturating_mul(limit);
    if matches!((query.start_date, query.end_date), (Some(start), Some(end)) if start > end) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error":"Tanggal awal harus sebelum atau sama dengan tanggal akhir."}))));
    }

    // Superadmin can view all transcripts, regular user views own
    let user_filter = if user.role == "superadmin" {
        None
    } else {
        Some(user.id)
    };

    let (rows, total) = get_transcripts(&pool, user_filter, query.search, limit, offset, query.start_date, query.end_date)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("DB error: {}", e) })),
            )
        })?;

    Ok(Json(json!({
        "transcripts": rows,
        "total": total,
        "page": page,
        "limit": limit
    })))
}

pub async fn delete_transcript_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let user_filter = if user.role == "superadmin" {
        None
    } else {
        Some(user.id)
    };

    let success = delete_transcript(&pool, id, user_filter)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("DB error: {}", e) })),
            )
        })?;

    if success {
        Ok(Json(json!({ "success": true, "message": "Notulen berhasil dihapus." })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Notulen tidak ditemukan atau bukan milik Anda." })),
        ))
    }
}

#[derive(Debug, Deserialize)]
pub struct ShareTranscriptRequest {
    pub is_public: Option<bool>,
}

/// Generate or toggle public share link: Format: tanggal-menit-UUID (e.g. YYYYMMDD-HHmm-<uuid>)
pub async fn share_transcript_handler(
    Authenticated(user): Authenticated,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(payload): Json<ShareTranscriptRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let transcript = get_transcript_by_id(&pool, id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Notulen tidak ditemukan."}))))?;

    if user.role != "superadmin" && transcript.user_id != Some(user.id) {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Akses ditolak."}))));
    }

    let is_public = payload.is_public.unwrap_or(true);
    let slug = if let Some(existing_slug) = transcript.share_slug.filter(|s| !s.is_empty()) {
        existing_slug
    } else {
        let now = Utc::now();
        // Format: tanggal-menit-UUID (e.g. 20261116-0330-0193...)
        let timestamp_prefix = now.format("%Y%m%d-%H%M").to_string();
        format!("{}-{}", timestamp_prefix, id)
    };

    sqlx::query("UPDATE transcripts SET share_slug = $1, is_public = $2 WHERE id = $3")
        .bind(&slug)
        .bind(is_public)
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(json!({
        "success": true,
        "isPublic": is_public,
        "shareSlug": slug,
        "shareUrl": format!("/share/{}", slug)
    })))
}

/// Public share view endpoint (No login required)
pub async fn public_share_handler(
    State(pool): State<PgPool>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let transcript = get_transcript_by_share_slug(&pool, &slug)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let Some(t) = transcript else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Dokumen MoM tidak ditemukan atau akses publik telah dinonaktifkan." })),
        ));
    };

    Ok(Json(json!({
        "success": true,
        "id": t.id,
        "filename": t.filename,
        "momTitle": t.mom_title,
        "createdAt": t.created_at.to_string(),
        "durationS": t.duration_s,
        "finalText": t.final_text,
        "aiSummary": t.ai_summary,
        "aiData": t.ai_data,
        "wordTimestamps": t.word_timestamps,
        "isPublic": t.is_public,
        "shareSlug": t.share_slug
    })))
}
