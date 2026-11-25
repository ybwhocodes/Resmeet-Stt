use crate::{auth::Authenticated, routes::processing::Device, AppState};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub const LEASE_SECONDS: i64 = 60;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JobOptions {
    pub device: Device,
    pub ai_correction: bool,
    pub style: String,
    pub custom_prompt: Option<String>,
    pub model_id: Option<String>,
    #[serde(default)]
    pub cleanup_transcript: bool,
    #[serde(default)]
    pub document_revision: i64,
}
#[derive(Clone, Debug)]
pub struct Job {
    pub id: Uuid,
    pub user_id: Uuid,
    pub kind: String,
    pub filename: String,
    pub input_name: Option<String>,
    pub options: JobOptions,
    pub attempt: i32,
    pub max_attempts: i32,
    pub source_job_id: Option<Uuid>,
    pub transcript_id: Option<Uuid>,
    pub checkpoint: Value,
    pub progress: Value,
}

pub async fn ensure_schema(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(r#"CREATE TABLE IF NOT EXISTS transcription_jobs (
        id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('transcription','ai')),
        filename TEXT NOT NULL, input_name TEXT, options JSONB NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','waiting_ai','completed','failed')),
        attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), lease_owner UUID, lease_until TIMESTAMPTZ,
        progress JSONB NOT NULL DEFAULT '{"type":"progress","percent":0,"stage":"Menunggu worker..."}',
        preview JSONB, preview_revision BIGINT NOT NULL DEFAULT 0, result JSONB, error TEXT,
        checkpoint JSONB NOT NULL DEFAULT '{}', revision BIGINT NOT NULL DEFAULT 0,
        source_job_id UUID UNIQUE REFERENCES transcription_jobs(id) ON DELETE CASCADE,
        transcript_id UUID REFERENCES transcripts(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )"#).execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_jobs_claim ON transcription_jobs(kind, state, available_at, created_at)").execute(pool).await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_jobs_owner ON transcription_jobs(user_id, created_at)",
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_ai ON transcription_jobs(transcript_id) WHERE kind = 'ai' AND state IN ('queued','running')").execute(pool).await?;
    sqlx::query(r#"CREATE TABLE IF NOT EXISTS transcription_chunks (
        job_id UUID NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL, start_s REAL NOT NULL, end_s REAL NOT NULL,
        audio_start_s REAL NOT NULL, audio_end_s REAL NOT NULL, result JSONB, completed_at TIMESTAMPTZ,
        PRIMARY KEY(job_id, chunk_index)
    )"#).execute(pool).await?;
    sqlx::query(
        "ALTER TABLE transcription_chunks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ",
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS worker_heartbeats (role TEXT PRIMARY KEY, worker_id UUID NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())").execute(pool).await?;
    Ok(())
}

pub async fn enqueue(
    pool: &PgPool,
    user_id: Uuid,
    filename: &str,
    input_name: &str,
    options: JobOptions,
) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO transcription_jobs (id,user_id,kind,filename,input_name,options) VALUES ($1,$2,'transcription',$3,$4,$5)")
        .bind(id).bind(user_id).bind(filename).bind(input_name).bind(json!(options)).execute(pool).await?;
    Ok(id)
}

pub async fn claim(pool: &PgPool, kind: &str, worker: Uuid) -> Result<Option<Job>, sqlx::Error> {
    let row = sqlx::query(r#"UPDATE transcription_jobs SET state='running', attempt=attempt+1,
        lease_owner=$2, lease_until=NOW()+make_interval(secs => $3), error=NULL, updated_at=NOW(), revision=revision+1
        WHERE id=(SELECT id FROM transcription_jobs
          WHERE kind=$1 AND ((state='queued' AND available_at<=NOW()) OR (state='running' AND lease_until<NOW()))
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *"#).bind(kind).bind(worker).bind(LEASE_SECONDS as f64).fetch_optional(pool).await?;
    row.map(|r| {
        Ok(Job {
            id: r.get("id"),
            user_id: r.get("user_id"),
            kind: r.get("kind"),
            filename: r.get("filename"),
            input_name: r.get("input_name"),
            options: serde_json::from_value(r.get("options"))
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
            attempt: r.get("attempt"),
            max_attempts: r.get("max_attempts"),
            source_job_id: r.get("source_job_id"),
            transcript_id: r.get("transcript_id"),
            checkpoint: r.get("checkpoint"),
            progress: r.get("progress"),
        })
    })
    .transpose()
}

pub async fn heartbeat(pool: &PgPool, role: &str, worker: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO worker_heartbeats (role,worker_id) VALUES ($1,$2) ON CONFLICT(role) DO UPDATE SET worker_id=EXCLUDED.worker_id,updated_at=NOW()")
        .bind(role).bind(worker).execute(pool).await?;
    Ok(())
}
pub async fn available(pool: &PgPool, role: &str) -> bool {
    let heartbeat_ok = match sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM worker_heartbeats WHERE role=$1 AND updated_at > NOW() - INTERVAL '60 seconds')"
    )
    .bind(role)
    .fetch_one(pool)
    .await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(%role, %e, "worker_heartbeats check error");
            false
        }
    };

    if heartbeat_ok {
        return true;
    }

    match sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM transcription_jobs WHERE kind=$1 AND state='running' AND lease_until > NOW())"
    )
    .bind(role)
    .fetch_one(pool)
    .await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(%role, %e, "transcription_jobs running check error");
            false
        }
    }
}
pub async fn renew(
    pool: &PgPool,
    job: &Job,
    worker: Uuid,
    progress: Option<Value>,
) -> Result<bool, sqlx::Error> {
    let result=sqlx::query(r#"UPDATE transcription_jobs SET lease_until=NOW()+make_interval(secs => $3),
        progress=COALESCE($4,progress),revision=revision+CASE WHEN $4::JSONB IS NULL THEN 0 ELSE 1 END,updated_at=NOW()
        WHERE id=$1 AND lease_owner=$2 AND state='running' AND lease_until>NOW()"#)
        .bind(job.id).bind(worker).bind(LEASE_SECONDS as f64).bind(&progress).execute(pool).await?;
    if result.rows_affected() == 0 {
        return Ok(false);
    }
    if let (Some(parent), Some(progress)) = (job.source_job_id, progress) {
        sqlx::query("UPDATE transcription_jobs SET progress=$2,revision=revision+1,updated_at=NOW() WHERE id=$1 AND state='waiting_ai' AND EXISTS(SELECT 1 FROM transcription_jobs WHERE id=$3 AND lease_owner=$4 AND state='running' AND lease_until>NOW())")
            .bind(parent).bind(progress).bind(job.id).bind(worker).execute(pool).await?;
    }
    Ok(true)
}
pub async fn owned_transaction(
    pool: &PgPool,
    job: Uuid,
    worker: Uuid,
) -> Result<sqlx::Transaction<'_, sqlx::Postgres>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let owned: Option<Uuid>=sqlx::query_scalar("SELECT id FROM transcription_jobs WHERE id=$1 AND lease_owner=$2 AND state='running' AND lease_until>NOW() FOR UPDATE")
        .bind(job).bind(worker).fetch_optional(&mut *tx).await?;
    if owned.is_none() {
        return Err(sqlx::Error::Protocol(
            "Lease pekerjaan sudah berakhir".into(),
        ));
    }
    Ok(tx)
}
pub async fn snapshot(
    pool: &PgPool,
    id: Uuid,
    owner: Uuid,
    after: Option<i64>,
) -> Result<Option<(Value, i64)>, sqlx::Error> {
    let row=sqlx::query("SELECT state,progress,EXTRACT(EPOCH FROM (NOW()-created_at))::BIGINT AS elapsed_s,CASE WHEN $3::BIGINT IS NULL OR preview_revision>$3 OR $3>revision THEN preview ELSE NULL END AS preview,preview_revision,CASE WHEN $3::BIGINT=revision THEN NULL ELSE result END AS result,error,revision FROM transcription_jobs WHERE id=$1 AND user_id=$2 AND kind='transcription'")
        .bind(id).bind(owner).bind(after).fetch_optional(pool).await?;
    Ok(row.map(|r| {
        let state:String=r.get("state");let revision:i64=r.get("revision");
        if after==Some(revision){return (Value::Null,revision);}
        let terminal=match state.as_str() {
            "completed"=>json!({"type":"result","data":r.get::<Value,_>("result")}),
            "failed"=>json!({"type":"error","error":r.get::<Option<String>,_>("error").unwrap_or_else(||"Pekerjaan gagal".into())}),
            _=>Value::Null,
        };
        let preview=if after.is_none_or(|previous|previous<r.get::<i64,_>("preview_revision") || previous>revision) {r.get::<Option<Value>,_>("preview")}else{None};
        let mut progress=r.get::<Value,_>("progress");progress["elapsed_s"]=json!(r.get::<i64,_>("elapsed_s"));
        (json!({"jobId":id,"state":state,"progress":progress,"preview":preview,"terminal":terminal}),revision)
    }))
}
#[derive(Deserialize)]
pub struct ListOptions { #[serde(default)] failed:bool }
pub async fn list_handler(Authenticated(user):Authenticated,State(state):State<AppState>,Query(options):Query<ListOptions>)->Result<Json<Value>,(StatusCode,Json<Value>)>{
    let rows=sqlx::query("SELECT id,filename,state,error,checkpoint,progress || jsonb_build_object('elapsed_s',EXTRACT(EPOCH FROM (NOW()-created_at))::BIGINT) AS progress FROM transcription_jobs WHERE user_id=$1 AND kind='transcription' AND (($2 AND state='failed') OR (NOT $2 AND state IN ('queued','running','waiting_ai'))) ORDER BY created_at DESC LIMIT 20")
        .bind(user.id).bind(options.failed).fetch_all(&state.db_pool()).await.map_err(api_error)?;
    let jobs=rows.into_iter().map(|row|{
        let error=row.get::<Option<String>,_>("error");let checkpoint=row.get::<Value,_>("checkpoint");
        let can_retry=row.get::<String,_>("state")=="failed" && checkpoint["input_expired"]!=true && !error.as_deref().is_some_and(crate::pipeline::permanent_error);
        json!({"jobId":row.get::<Uuid,_>("id"),"filename":row.get::<String,_>("filename"),"state":row.get::<String,_>("state"),"progress":row.get::<Value,_>("progress"),"error":error,"canRetry":can_retry})
    }).collect::<Vec<_>>();
    Ok(Json(json!({"jobs":jobs})))
}

pub async fn status_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let after = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|h| h.to_str().ok())
        .and_then(|value| parse_etag(value, id));
    let (body,revision)=snapshot(&state.db_pool(),id,user.id,after).await.map_err(api_error)?
        .ok_or_else(||(StatusCode::NOT_FOUND,Json(json!({"error":"Job tidak ditemukan. Periksa Riwayat untuk hasil yang telah disimpan."}))))?;
    let etag = format!("\"{id}:{revision}\"");
    if after == Some(revision) {
        return Ok((StatusCode::NOT_MODIFIED, [(header::ETAG, etag)]).into_response());
    }
    Ok((
        [
            (header::ETAG, etag),
            (header::CACHE_CONTROL, "private, no-cache".into()),
        ],
        Json(body),
    )
        .into_response())
}
fn parse_etag(value: &str, id: Uuid) -> Option<i64> {
    value
        .strip_prefix('"')?
        .strip_suffix('"')?
        .strip_prefix(&format!("{id}:"))?
        .parse()
        .ok()
}
pub fn api_error(error: sqlx::Error) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error":format!("Database pekerjaan gagal: {error}")})),
    )
}

pub async fn enqueue_ai(
    pool: &PgPool,
    user_id: Uuid,
    transcript_id: Uuid,
    filename: &str,
    options: JobOptions,
    preview: Value,
) -> Result<Uuid, sqlx::Error> {
    let parent = Uuid::now_v7();
    let child = Uuid::now_v7();
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO transcription_jobs (id,user_id,kind,filename,options,state,transcript_id,preview,preview_revision,revision,progress) VALUES ($1,$2,'transcription',$3,$4,'waiting_ai',$5,$6,1,1,'{\"type\":\"progress\",\"percent\":86,\"stage\":\"Menunggu worker AI...\"}')")
        .bind(parent).bind(user_id).bind(filename).bind(json!(&options)).bind(transcript_id).bind(preview).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO transcription_jobs (id,user_id,kind,filename,options,source_job_id,transcript_id) VALUES ($1,$2,'ai',$3,$4,$5,$6)")
        .bind(child).bind(user_id).bind(filename).bind(json!(options)).bind(parent).bind(transcript_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(parent)
}

pub async fn wait_for_result(
    pool: &PgPool,
    id: Uuid,
    owner: Uuid,
) -> Result<Value, (StatusCode, Json<Value>)> {
    loop {
        let (snapshot, _) = snapshot(pool, id, owner, None)
            .await
            .map_err(api_error)?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error":"Job tidak tersedia."})),
                )
            })?;
        if snapshot["terminal"]["type"] == "result" {
            return Ok(snapshot["terminal"]["data"].clone());
        }
        if snapshot["terminal"]["type"] == "error" {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":snapshot["terminal"]["error"]})),
            ));
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}
pub async fn retry_handler(
    Authenticated(user): Authenticated,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let error=sqlx::query_scalar::<_,Option<String>>("SELECT error FROM transcription_jobs WHERE id=$1 AND user_id=$2 AND state='failed'").bind(id).bind(user.id).fetch_optional(&state.db_pool()).await.map_err(api_error)?;
    if error.flatten().as_deref().is_some_and(crate::pipeline::permanent_error){return Err((StatusCode::CONFLICT,Json(json!({"error":"Rekaman perlu diperiksa atau diunggah kembali sebelum diproses."}))));}
    let result=sqlx::query("UPDATE transcription_jobs SET state='queued',attempt=0,error=NULL,available_at=NOW(),revision=revision+1,updated_at=NOW(),progress=progress || '{\"stage\":\"Melanjutkan dari checkpoint...\"}'::jsonb WHERE id=$1 AND user_id=$2 AND kind='transcription' AND state='failed' AND checkpoint->>'input_expired' IS DISTINCT FROM 'true'")
        .bind(id).bind(user.id).execute(&state.db_pool()).await.map_err(api_error)?;
    if result.rows_affected() == 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(
                json!({"error":"Job tidak dapat dicoba ulang. Berkas mungkin kedaluwarsa atau pekerjaan masih aktif."}),
            ),
        ));
    }
    Ok(Json(json!({"jobId":id})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn etags_are_scoped_to_the_job_and_revision() {
        let id = Uuid::new_v4();
        assert_eq!(parse_etag(&format!("\"{id}:12\""), id), Some(12));
        assert!(parse_etag(&format!("\"{}:12\"", Uuid::new_v4()), id).is_none());
        assert!(parse_etag("garbage", id).is_none());
    }
}
