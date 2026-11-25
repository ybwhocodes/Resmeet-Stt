use chrono::{Duration, Utc};
use sqlx::postgres::PgPoolOptions;
use sqlx::postgres::PgConnectOptions;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::auth::generate_session_token;
use crate::models::{TranscriptRecord, UserAiModelDto};
use crate::secrets::SecretCipher;

pub fn placeholder_pool() -> PgPool {
    PgPoolOptions::new().acquire_timeout(std::time::Duration::from_secs(1))
        .connect_lazy_with(PgConnectOptions::new().host("127.0.0.1").port(1).username("unconfigured").database("unconfigured"))
}

pub async fn ensure_pg_schema(pool: &PgPool) -> Result<(), sqlx::Error> {
    // A detached connection releases the session lock by closing on every return path.
    let mut migration_lock=pool.acquire().await?.detach();
    sqlx::query("SELECT pg_advisory_lock(hashtextextended('resmeet-schema',0))").execute(&mut migration_lock).await?;
    sqlx::query(r#"CREATE EXTENSION IF NOT EXISTS "pgcrypto";"#).execute(pool).await?;

    // 1. Users table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'user',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE TABLE IF NOT EXISTS user_transcription_settings (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, device TEXT NOT NULL DEFAULT 'cpu' CHECK (device IN ('cpu', 'gpu')))")
        .execute(pool).await?;

    // 2. User AI models table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS user_ai_models (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            model_id VARCHAR(255) NOT NULL,
            model_name VARCHAR(255) DEFAULT NULL,
            is_default BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_user_ai_models_user ON user_ai_models(user_id)")
        .execute(pool)
        .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS user_ai_settings (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            base_url TEXT NOT NULL,
            api_key_hash TEXT NOT NULL DEFAULT '',
            api_key_ciphertext TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"#,
    ).execute(pool).await?;

    // Existing installations may still have only the legacy plaintext api_key column.
    sqlx::query("ALTER TABLE user_ai_settings ADD COLUMN IF NOT EXISTS api_key_hash TEXT NOT NULL DEFAULT ''")
        .execute(pool).await?;
    sqlx::query("ALTER TABLE user_ai_settings ADD COLUMN IF NOT EXISTS api_key_ciphertext TEXT NOT NULL DEFAULT ''")
        .execute(pool).await?;
    sqlx::query("ALTER TABLE user_ai_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP")
        .execute(pool).await?;

    // 3. Sessions table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(255) NOT NULL UNIQUE,
            remember_me BOOLEAN NOT NULL DEFAULT FALSE,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)")
        .execute(pool)
        .await?;

    // 4. Transcripts table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS transcripts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            filename VARCHAR(255) NOT NULL,
            final_text TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            duration_s REAL DEFAULT NULL,
            generation_time_s REAL DEFAULT NULL,
            language VARCHAR(10) DEFAULT 'id',
            word_timestamps JSONB DEFAULT NULL,
            raw_text TEXT DEFAULT NULL,
            ai_corrected_text TEXT DEFAULT NULL,
            ai_summary TEXT DEFAULT NULL,
            md_path VARCHAR(500) DEFAULT NULL,
            ai_correction_status VARCHAR(50) DEFAULT 'skipped',
            directed_topics JSONB DEFAULT NULL,
            ai_data JSONB DEFAULT NULL,
            share_slug VARCHAR(150) UNIQUE DEFAULT NULL,
            is_public BOOLEAN NOT NULL DEFAULT FALSE
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS document_docx BYTEA").execute(pool).await?;
    sqlx::query("ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS mom_title VARCHAR(200)").execute(pool).await?;

    sqlx::query("ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS document_revision BIGINT NOT NULL DEFAULT 0").execute(pool).await?;

    // Ensure new columns exist for existing databases
    sqlx::query("ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS share_slug VARCHAR(150) UNIQUE DEFAULT NULL").execute(pool).await?;
    sqlx::query("ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE").execute(pool).await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_transcripts_user ON transcripts(user_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_transcripts_created ON transcripts(created_at)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_transcripts_share_slug ON transcripts(share_slug)")
        .execute(pool)
        .await?;

    // 5. Knowledge table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS knowledge (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            category VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            source VARCHAR(255) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_knowledge_cat_title UNIQUE (category, title)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category)")
        .execute(pool)
        .await?;

    crate::jobs::ensure_schema(pool).await?;
    Ok(())
}

pub async fn create_session(
    pool: &PgPool,
    user_id: Uuid,
    remember_me: bool,
) -> Result<(String, String), sqlx::Error> {
    let token = generate_session_token();
    let days = if remember_me { 30 } else { 1 };
    let expires_at = Utc::now() + Duration::days(days);
    let expires_at_naive = expires_at.naive_utc();
    let session_id = Uuid::now_v7();

    sqlx::query(
        r#"
        INSERT INTO sessions (id, user_id, token, remember_me, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(session_id)
    .bind(user_id)
    .bind(&token)
    .bind(remember_me)
    .bind(expires_at_naive)
    .execute(pool)
    .await?;

    Ok((token, expires_at.to_rfc3339()))
}

pub async fn get_user_ai_models(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<UserAiModelDto>, sqlx::Error> {
    let models = sqlx::query_as::<_, UserAiModelDto>(
        r#"
        SELECT id, model_id, model_name, is_default
        FROM user_ai_models
        WHERE user_id = $1
        ORDER BY is_default DESC, created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(models)
}

pub async fn get_transcripts(
    pool: &PgPool,
    user_id: Option<Uuid>,
    search: Option<String>,
    limit: i64,
    offset: i64,
    start_date: Option<chrono::NaiveDate>,
    end_date: Option<chrono::NaiveDate>,
) -> Result<(Vec<TranscriptRecord>, i64), sqlx::Error> {
    let search_pattern = search.map(|s| format!("%{}%", s));

    let rows = sqlx::query_as::<_, TranscriptRecord>(
        r#"
        SELECT
            id, user_id, filename, mom_title, final_text,
            created_at, duration_s, generation_time_s,
            language, word_timestamps, raw_text,
            ai_corrected_text, ai_summary, md_path,
            ai_correction_status, directed_topics, ai_data,
            share_slug, is_public
        FROM transcripts
        WHERE ($1::UUID IS NULL OR user_id = $1)
          AND ($2::TEXT IS NULL OR filename ILIKE $2 OR mom_title ILIKE $2 OR final_text ILIKE $2)
          AND ($5::DATE IS NULL OR created_at >= $5::DATE)
          AND ($6::DATE IS NULL OR created_at < $6::DATE + INTERVAL '1 day')
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
        "#,
    )
    .bind(user_id)
    .bind(&search_pattern)
    .bind(limit)
    .bind(offset)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await?;

    let count_row = sqlx::query(
        r#"
        SELECT COUNT(*) as count
        FROM transcripts
        WHERE ($1::UUID IS NULL OR user_id = $1)
          AND ($2::TEXT IS NULL OR filename ILIKE $2 OR mom_title ILIKE $2 OR final_text ILIKE $2)
          AND ($3::DATE IS NULL OR created_at >= $3::DATE)
          AND ($4::DATE IS NULL OR created_at < $4::DATE + INTERVAL '1 day')
        "#,
    )
    .bind(user_id)
    .bind(&search_pattern)
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await?;

    let total: i64 = count_row.get("count");

    Ok((rows, total))
}

pub async fn get_transcript_by_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<TranscriptRecord>, sqlx::Error> {
    sqlx::query_as::<_, TranscriptRecord>(
        r#"
        SELECT
            id, user_id, filename, mom_title, final_text,
            created_at, duration_s, generation_time_s,
            language, word_timestamps, raw_text,
            ai_corrected_text, ai_summary, md_path,
            ai_correction_status, directed_topics, ai_data,
            share_slug, is_public
        FROM transcripts
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn get_transcript_by_share_slug(
    pool: &PgPool,
    slug: &str,
) -> Result<Option<TranscriptRecord>, sqlx::Error> {
    sqlx::query_as::<_, TranscriptRecord>(
        r#"
        SELECT
            id, user_id, filename, mom_title, final_text,
            created_at, duration_s, generation_time_s,
            language, word_timestamps, raw_text,
            ai_corrected_text, ai_summary, md_path,
            ai_correction_status, directed_topics, ai_data,
            share_slug, is_public
        FROM transcripts
        WHERE share_slug = $1 AND is_public = true
        "#,
    )
    .bind(slug)
    .fetch_optional(pool)
    .await
}

pub async fn delete_transcript(
    pool: &PgPool,
    id: Uuid,
    user_id: Option<Uuid>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM transcripts
        WHERE id = $1 AND ($2::UUID IS NULL OR user_id = $2)
        "#,
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

pub struct AiGateway {
    pub base_url: String,
    pub api_key: String,
    pub model_id: String,
}

pub async fn get_ai_gateway(pool: &PgPool, cipher: &SecretCipher, user_id: Uuid, requested_model: Option<&str>) -> Result<Option<AiGateway>, String> {
    let row = sqlx::query("SELECT base_url, api_key_hash, api_key_ciphertext FROM user_ai_settings WHERE user_id = $1")
        .bind(user_id).fetch_optional(pool).await.map_err(|e| e.to_string())?;
    let Some(row) = row else { return Ok(None); };
    let base_url: String = row.get("base_url");
    let hash: String = row.get("api_key_hash");
    let sealed: String = row.get("api_key_ciphertext");
    if sealed.is_empty() { return Ok(None); }
    let api_key = cipher.open(user_id, &hash, &sealed)?;
    let models = get_user_ai_models(pool, user_id).await.map_err(|e| e.to_string())?
        .into_iter().filter(|model| !model.model_id.trim().is_empty()).collect::<Vec<_>>();
    let selected = requested_model.and_then(|id| models.iter().find(|model| model.model_id == id))
        .or_else(|| models.iter().find(|model| model.is_default))
        .or_else(|| models.first());
    Ok(selected.map(|model| AiGateway { base_url, api_key, model_id: model.model_id.clone() }))
}

pub async fn has_configured_ai_gateway(pool: &PgPool, cipher: &SecretCipher) -> bool {
    let rows = sqlx::query("SELECT user_id, api_key_hash, api_key_ciphertext FROM user_ai_settings WHERE base_url <> '' AND api_key_ciphertext <> ''")
        .fetch_all(pool)
        .await;
    match rows {
        Ok(list) => {
            for row in list {
                let user_id: Uuid = row.get("user_id");
                let hash: String = row.get("api_key_hash");
                let sealed: String = row.get("api_key_ciphertext");
                if cipher.open(user_id, &hash, &sealed).is_ok() {
                    return true;
                }
            }
            false
        }
        Err(_) => false,
    }
}
