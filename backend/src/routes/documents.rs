use axum::{body::Body, extract::{Multipart, Path, State}, http::{header, StatusCode}, response::Response, Json};
use serde_json::json;
use sqlx::Row;
use std::io::Cursor;
use uuid::Uuid;
use crate::{auth::Authenticated, AppState};

type ApiError = (StatusCode, Json<serde_json::Value>);
fn error(status: StatusCode, message: impl Into<String>) -> ApiError { (status, Json(json!({"error":message.into()}))) }

#[derive(serde::Deserialize)]
pub struct TitleRequest { title: String }

fn clean_title(title: &str) -> Result<String, ApiError> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 200 || title.chars().any(char::is_control) {
        return Err(error(StatusCode::BAD_REQUEST, "Judul MoM wajib diisi, maksimal 200 karakter, dan tidak boleh mengandung baris baru."));
    }
    Ok(title.to_string())
}

pub async fn update_title(Authenticated(user): Authenticated, State(state): State<AppState>, Path(id): Path<Uuid>, Json(payload): Json<TitleRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    let title = clean_title(&payload.title)?;
    let result = sqlx::query("UPDATE transcripts SET mom_title = $1 WHERE id = $2 AND (user_id = $3 OR $4)")
        .bind(&title).bind(id).bind(user.id).bind(user.role == "superadmin")
        .execute(&state.db_pool()).await.map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if result.rows_affected() == 0 { return Err(error(StatusCode::NOT_FOUND, "Dokumen tidak ditemukan atau bukan milik Anda.")); }
    Ok(Json(json!({"success":true, "momTitle":title})))
}

fn valid_docx(bytes: &[u8]) -> bool {
    if bytes.len() > 20 * 1024 * 1024 { return false; }
    let Ok(mut archive) = zip::ZipArchive::new(Cursor::new(bytes)) else { return false; };
    if archive.len() > 2048 { return false; }
    let mut total = 0u64;
    for i in 0..archive.len() {
        let Ok(file) = archive.by_index(i) else { return false; };
        total = total.saturating_add(file.size());
        if total > 64 * 1024 * 1024 { return false; }
    }
    archive.by_name("[Content_Types].xml").is_ok() && archive.by_name("word/document.xml").is_ok()
}

fn response(bytes: Option<Vec<u8>>) -> Result<Response, ApiError> {
    let bytes = bytes.ok_or_else(|| error(StatusCode::NOT_FOUND, "Dokumen DOCX belum disimpan."))?;
    Ok(Response::builder().header(header::CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        .header(header::CACHE_CONTROL, "private, no-store")
        .body(Body::from(bytes)).unwrap())
}

pub async fn get_document(Authenticated(user): Authenticated, State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Response, ApiError> {
    let row = sqlx::query("SELECT document_docx FROM transcripts WHERE id = $1 AND (user_id = $2 OR $3)")
        .bind(id).bind(user.id).bind(user.role == "superadmin").fetch_optional(&state.db_pool()).await
        .map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Dokumen tidak ditemukan."))?;
    response(row.get("document_docx"))
}

pub async fn public_document(State(state): State<AppState>, Path(slug): Path<String>) -> Result<Response, ApiError> {
    let row = sqlx::query("SELECT document_docx FROM transcripts WHERE share_slug = $1 AND is_public = TRUE")
        .bind(slug).fetch_optional(&state.db_pool()).await
        .map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Dokumen publik tidak tersedia."))?;
    response(row.get("document_docx"))
}

pub async fn save_document(Authenticated(user): Authenticated, State(state): State<AppState>, Path(id): Path<Uuid>, mut fields: Multipart) -> Result<Json<serde_json::Value>, ApiError> {
    let mut document = None;
    let mut markdown = None;
    while let Some(field) = fields.next_field().await.map_err(|e| error(StatusCode::BAD_REQUEST, e.to_string()))? {
        match field.name().unwrap_or_default() {
            "document" => { document = Some(field.bytes().await.map_err(|e| error(StatusCode::BAD_REQUEST, e.to_string()))?.to_vec()); }
            "markdown" => { let text = field.text().await.map_err(|e| error(StatusCode::BAD_REQUEST, e.to_string()))?;
                if text.len() > 1024 * 1024 { return Err(error(StatusCode::PAYLOAD_TOO_LARGE, "Teks dokumen terlalu panjang.")); }
                markdown = Some(text);
            }
            _ => {}
        }
    }
    let document = document.filter(|bytes| valid_docx(bytes)).ok_or_else(|| error(StatusCode::BAD_REQUEST, "Berkas bukan DOCX yang valid atau melewati batas ukuran."))?;
    let markdown = markdown.ok_or_else(|| error(StatusCode::BAD_REQUEST, "Teks dokumen belum tersedia."))?;
    let result = sqlx::query("UPDATE transcripts SET document_docx = $1, ai_summary = $2, document_revision=document_revision+1 WHERE id = $3 AND (user_id = $4 OR $5)")
        .bind(document).bind(markdown).bind(id).bind(user.id).bind(user.role == "superadmin")
        .execute(&state.db_pool()).await.map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if result.rows_affected() == 0 { return Err(error(StatusCode::NOT_FOUND, "Dokumen tidak ditemukan atau bukan milik Anda.")); }
    Ok(Json(json!({"success":true})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn title_validation_trims_and_limits_unicode_characters() {
        assert_eq!(clean_title("  Rapat Stok – Jakarta  ").unwrap(), "Rapat Stok – Jakarta");
        assert!(clean_title(&"é".repeat(200)).is_ok());
        for title in [" ".to_string(), "x".repeat(201), "Judul\nBaru".to_string(), "Judul\0".to_string()] {
            assert!(clean_title(&title).is_err());
        }
    }
    #[test]
    fn validates_a_word_archive_and_rejects_other_zip_files() {
        fn zip(names: &[&str]) -> Vec<u8> {
            let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
            for name in names { archive.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap(); archive.write_all(b"<xml/>").unwrap(); }
            archive.finish().unwrap().into_inner()
        }
        assert!(valid_docx(&zip(&["[Content_Types].xml", "word/document.xml"])));
        assert!(!valid_docx(&zip(&["unrelated.txt"])));
        assert!(!valid_docx(b"not a docx"));
    }
}
