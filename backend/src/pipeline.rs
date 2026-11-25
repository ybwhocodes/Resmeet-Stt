use crate::{
    audio_chunks::{self, Chunk},
    inference::{Backend, EnginePool},
    jobs::{self, Job},
    progress::ProgressReporter,
    whisper::TranscriptionResult,
    AppState,
};
use serde_json::{json, Value};
use sqlx::Row;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

fn db(error: sqlx::Error) -> String {
    error.to_string()
}
fn safe_input(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        Err("Nama berkas antrean tidak valid".into())
    } else {
        Ok(name)
    }
}
fn wav(state: &AppState, id: Uuid) -> PathBuf {
    state.config.uploads_dir.join(format!("{id}.wav"))
}
pub async fn cleanup_files(state: &AppState, id: Uuid, input: Option<&str>) {
    for suffix in ["wav", "converting.wav", "part.wav"] {
        let _ =
            tokio::fs::remove_file(state.config.uploads_dir.join(format!("{id}.{suffix}"))).await;
    }
    if let Ok(mut entries) = tokio::fs::read_dir(&state.config.uploads_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&format!("{id}.")) && name.ends_with(".part.wav") {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }
    if let Some(name) = input.and_then(|name| safe_input(name).ok()) {
        let _ = tokio::fs::remove_file(state.config.uploads_dir.join(name)).await;
    }
}
pub async fn transcribe(
    state: &AppState,
    job: &Job,
    worker: Uuid,
    engine_pool: Arc<EnginePool>,
    progress: ProgressReporter,
) -> Result<(), String> {
    let pool = state.db_pool();
    let canonical = wav(state, job.id);
    let mut rows =
        sqlx::query("SELECT * FROM transcription_chunks WHERE job_id=$1 ORDER BY chunk_index")
            .bind(job.id)
            .fetch_all(&pool)
            .await
            .map_err(db)?;
    let complete = !rows.is_empty()
        && rows
            .iter()
            .all(|row| row.get::<Option<Value>, _>("result").is_some());
    let total = if complete {
        job.checkpoint["duration_s"]
            .as_f64()
            .ok_or("Durasi checkpoint hilang")? as f32
    } else {
        if !canonical.is_file() {
            progress.update(5, "Mengonversi audio ke WAV 16 kHz...");
            let name = safe_input(
                job.input_name
                    .as_deref()
                    .ok_or("Berkas sumber tidak tersedia")?,
            )?;
            let temp = state
                .config
                .uploads_dir
                .join(format!("{}.converting.wav", job.id));
            crate::whisper::convert_with_ffmpeg(&state.config.uploads_dir.join(name), &temp)
                .await?;
            audio_chunks::duration(&temp).await?;
            tokio::fs::File::open(&temp)
                .await
                .map_err(|e| e.to_string())?
                .sync_all()
                .await
                .map_err(|e| e.to_string())?;
            tokio::fs::rename(&temp, &canonical)
                .await
                .map_err(|e| e.to_string())?;
        }
        let duration = audio_chunks::duration(&canonical).await?;
        if rows.is_empty() {
            progress.update(
                8,
                "Menentukan batas bagian audio berdasarkan jeda ucapan...",
            );
            let plan = audio_chunks::plan(&canonical, duration, state.config.chunk_seconds).await?;
            let mut tx = jobs::owned_transaction(&pool, job.id, worker)
                .await
                .map_err(db)?;
            for chunk in plan {
                sqlx::query("INSERT INTO transcription_chunks (job_id,chunk_index,start_s,end_s,audio_start_s,audio_end_s) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING")
                .bind(job.id).bind(chunk.index).bind(chunk.start).bind(chunk.end).bind(chunk.audio_start).bind(chunk.audio_end).execute(&mut *tx).await.map_err(db)?;
            }
            sqlx::query("UPDATE transcription_jobs SET checkpoint=checkpoint || $2 WHERE id=$1")
                .bind(job.id)
                .bind(json!({"duration_s":duration}))
                .execute(&mut *tx)
                .await
                .map_err(db)?;
            tx.commit().await.map_err(db)?;
            rows = sqlx::query(
                "SELECT * FROM transcription_chunks WHERE job_id=$1 ORDER BY chunk_index",
            )
            .bind(job.id)
            .fetch_all(&pool)
            .await
            .map_err(db)?;
        }
        duration
    };
    if let Some(name) = job
        .input_name
        .as_deref()
        .and_then(|name| safe_input(name).ok())
    {
        let _ = tokio::fs::remove_file(state.config.uploads_dir.join(name)).await;
    }
    let gpu = job
        .options
        .device
        .use_gpu(state.config.gpu_info().available);
    let backend = if gpu {
        Backend::NativeGpu
    } else if state.config.faster_available() {
        Backend::Fast
    } else {
        Backend::NativeCpu
    };

    let count = rows.len();
    let mut pending_chunks = Vec::new();
    for row in &rows {
        if row.get::<Option<Value>, _>("result").is_none() {
            pending_chunks.push(Chunk {
                index: row.get("chunk_index"),
                start: row.get("start_s"),
                end: row.get("end_s"),
                audio_start: row.get("audio_start_s"),
                audio_end: row.get("audio_end_s"),
            });
        } else {
            let chunk_end: f32 = row.get("end_s");
            progress.whisper(chunk_end / total, chunk_end, total, "");
        }
    }

    if !pending_chunks.is_empty() {
        // Pre-extract audio slices in parallel
        for chunk in &pending_chunks {
            let part = state
                .config
                .uploads_dir
                .join(format!("{}.{}.part.wav", job.id, chunk.index));
            if !part.is_file() {
                audio_chunks::extract(&canonical, &part, chunk).await?;
            }
        }

        let concurrency = engine_pool.concurrency().min(pending_chunks.len()).max(1);
        let (engine_tx, engine_rx) = tokio::sync::mpsc::channel::<usize>(concurrency);
        for i in 0..concurrency {
            let _ = engine_tx.send(i).await;
        }
        let engine_rx = Arc::new(tokio::sync::Mutex::new(engine_rx));
        let engine_tx = Arc::new(engine_tx);

        let mut tasks = tokio::task::JoinSet::new();
        for chunk in pending_chunks {
            let engine_rx = engine_rx.clone();
            let engine_tx = engine_tx.clone();
            let engine_pool = engine_pool.clone();
            let state_clone = state.clone();
            let pool_clone = pool.clone();
            let progress_clone = progress.clone();
            let job_id = job.id;
            let filename = job.filename.clone();
            let ai_correction = job.options.ai_correction;
            let part = state
                .config
                .uploads_dir
                .join(format!("{}.{}.part.wav", job.id, chunk.index));

            tasks.spawn(async move {
                let engine_idx = {
                    let mut rx = engine_rx.lock().await;
                    rx.recv().await.ok_or_else(|| "Engine pool tidak tersedia".to_string())?
                };

                progress_clone.update(
                    10 + (75.0 * chunk.start / total) as u8,
                    &format!(
                        "Mentranskripsi bagian {}/{}; bagian selesai tersimpan sebagai checkpoint",
                        chunk.index + 1,
                        count
                    ),
                );

                let reporter = progress_clone.for_chunk(chunk.audio_start, total);
                let mut chunk_backend = backend;
                let first = engine_pool
                    .transcribe(engine_idx, chunk_backend, &part, &state_clone.config, reporter.clone())
                    .await;
                let result = match first {
                    Ok(result) => result,
                    Err(error) if chunk_backend != Backend::NativeCpu => {
                        tracing::warn!(job_id=%job_id,%error,?chunk_backend,"Mesin utama gagal; memakai cadangan CPU");
                        chunk_backend = if chunk_backend == Backend::NativeGpu && state_clone.config.faster_available() {
                            Backend::Fast
                        } else {
                            Backend::NativeCpu
                        };
                        match engine_pool
                            .transcribe(engine_idx, chunk_backend, &part, &state_clone.config, reporter.clone())
                            .await
                        {
                            Ok(result) => result,
                            Err(error) if chunk_backend == Backend::Fast => {
                                tracing::warn!(%error,"INT8 gagal; memakai Whisper CPU");
                                chunk_backend = Backend::NativeCpu;
                                engine_pool
                                    .transcribe(engine_idx, chunk_backend, &part, &state_clone.config, reporter)
                                    .await?
                            }
                            Err(error) => {
                                let _ = engine_tx.send(engine_idx).await;
                                return Err(error);
                            }
                        }
                    }
                    Err(error) => {
                        let _ = engine_tx.send(engine_idx).await;
                        return Err(error);
                    }
                };
                let _ = engine_tx.send(engine_idx).await;

                let result = audio_chunks::align(result, &chunk, total);
                let mut tx = jobs::owned_transaction(&pool_clone, job_id, worker)
                    .await
                    .map_err(db)?;
                sqlx::query("UPDATE transcription_chunks SET result=$3,completed_at=NOW() WHERE job_id=$1 AND chunk_index=$2 AND result IS NULL")
                    .bind(job_id).bind(chunk.index).bind(json!(&result)).execute(&mut *tx).await.map_err(db)?;

                let saved_rows = sqlx::query("SELECT result FROM transcription_chunks WHERE job_id=$1 AND result IS NOT NULL ORDER BY chunk_index")
                    .bind(job_id).fetch_all(&mut *tx).await.map_err(db)?;
                let current_results: Vec<TranscriptionResult> = saved_rows
                    .iter()
                    .filter_map(|r| r.get::<Option<Value>, _>("result").and_then(|v| serde_json::from_value(v).ok()))
                    .collect();
                let partial = audio_chunks::merge(current_results, total);
                let preview = json!({
                    "filename": filename,
                    "partial": true,
                    "finalText": partial.full_text,
                    "rawText": partial.raw_text,
                    "segments": partial.segments,
                    "durationS": total,
                    "aiCorrectionStatus": "transcribing",
                    "aiEnabled": ai_correction
                });
                sqlx::query("UPDATE transcription_jobs SET preview=$2,preview_revision=revision+1,revision=revision+1,updated_at=NOW() WHERE id=$1")
                    .bind(job_id).bind(preview).execute(&mut *tx).await.map_err(db)?;
                tx.commit().await.map_err(db)?;

                let _ = tokio::fs::remove_file(&part).await;
                progress_clone.whisper(chunk.end / total, chunk.end, total, "");
                Ok::<_, String>(())
            });
        }

        while let Some(res) = tasks.join_next().await {
            res.map_err(|e| e.to_string())??;
        }
    }

    let all_rows = sqlx::query("SELECT result FROM transcription_chunks WHERE job_id=$1 ORDER BY chunk_index")
        .bind(job.id).fetch_all(&pool).await.map_err(db)?;
    let mut completed = Vec::new();
    for row in all_rows {
        if let Some(val) = row.get::<Option<Value>, _>("result") {
            completed.push(serde_json::from_value::<TranscriptionResult>(val).map_err(|e| e.to_string())?);
        }
    }

    let result = audio_chunks::merge(completed, total);
    if result.full_text.trim().is_empty() {
        return Err("Tidak ada percakapan yang terdeteksi dalam audio.".into());
    }
    progress.update(85, "Menyimpan transkrip asli...");
    let ai = job.options.ai_correction;
    let share_slug = format!("{}-{}", chrono::Utc::now().format("%Y%m%d-%H%M"), job.id);
    let metadata = json!({"ai_enabled":ai,"ai_error":null,"transcription_engine":result.engine,"speech_duration_s":result.speech_duration_s});
    let mut tx = jobs::owned_transaction(&pool, job.id, worker)
        .await
        .map_err(db)?;
    let saved=sqlx::query("INSERT INTO transcripts (id,user_id,filename,final_text,raw_text,duration_s,generation_time_s,language,word_timestamps,ai_correction_status,ai_data,share_slug,is_public) VALUES ($1,$2,$3,$4,$4,$5,$6,'id',$7,$8,$9,$10,FALSE) RETURNING created_at")
        .bind(job.id).bind(job.user_id).bind(&job.filename).bind(&result.full_text).bind(total).bind(result.generation_time_s).bind(json!(result.segments))
        .bind(if ai{"pending"}else{"disabled"}).bind(metadata).bind(&share_slug).fetch_one(&mut *tx).await.map_err(db)?;
    let created: chrono::NaiveDateTime = saved.get("created_at");
    let response = json!({"success":true,"id":job.id,"filename":job.filename,"finalText":result.full_text,"rawText":result.raw_text,"segments":result.segments,
        "aiCorrectionStatus":if ai{"pending"}else{"disabled"},"aiEnabled":ai,"aiError":null,"durationS":total,"generationTimeS":result.generation_time_s,
        "transcriptionEngine":result.engine,"speechDurationS":result.speech_duration_s,"aiSummary":null,"shareSlug":share_slug,"createdAt":created.to_string()});
    sqlx::query("UPDATE transcription_jobs SET state=$2,transcript_id=$1,preview=$3,result=$4,progress=$5,revision=revision+1,preview_revision=revision+1,lease_owner=NULL,lease_until=NULL,updated_at=NOW() WHERE id=$1")
        .bind(job.id).bind(if ai{"waiting_ai"}else{"completed"}).bind(&response).bind(if ai{None}else{Some(response.clone())})
        .bind(json!({"type":"progress","percent":if ai{86}else{100},"stage":if ai{"Transkrip asli tersimpan; menunggu worker AI..."}else{"Selesai"}})).execute(&mut *tx).await.map_err(db)?;
    if ai {
        let mut options = job.options.clone();
        options.cleanup_transcript = true;
        sqlx::query("INSERT INTO transcription_jobs (id,user_id,kind,filename,options,source_job_id,transcript_id) VALUES ($1,$2,'ai',$3,$4,$5,$5)")
            .bind(Uuid::now_v7()).bind(job.user_id).bind(&job.filename).bind(json!(options)).bind(job.id).execute(&mut *tx).await.map_err(db)?;
    }
    tx.commit().await.map_err(db)?;
    cleanup_files(state, job.id, job.input_name.as_deref()).await;
    Ok(())
}

pub async fn process_ai(
    state: &AppState,
    job: &Job,
    worker: Uuid,
    progress: ProgressReporter,
) -> Result<(), String> {
    let pool = state.db_pool();
    let parent = job
        .source_job_id
        .ok_or("Induk pekerjaan AI tidak tersedia")?;
    let base: Value = sqlx::query_scalar(
        "SELECT preview FROM transcription_jobs WHERE id=$1 AND state='waiting_ai'",
    )
    .bind(parent)
    .fetch_optional(&pool)
    .await
    .map_err(db)?
    .ok_or("Pekerjaan induk sudah dihapus atau selesai")?;
    let gateway = crate::db::get_ai_gateway(
        &pool,
        &state.secret_cipher,
        job.user_id,
        job.options.model_id.as_deref(),
    )
    .await?;
    let Some(gateway) = gateway else {
        let mut response = base;
        response["aiEnabled"] = json!(false);
        response["aiCorrectionStatus"] = json!("disabled");
        return finish_ai(state, job, worker, response, false).await;
    };
    let knowledge_entries = crate::db::get_active_knowledge_for_user(&pool, job.user_id)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "Gagal membaca knowledge NLP; melanjutkan tanpa konteks RAG");
            Vec::new()
        });
    let source = if job.options.cleanup_transcript {
        base["rawText"]
            .as_str()
            .filter(|t| !t.is_empty())
            .or(base["finalText"].as_str())
            .unwrap_or_default()
    } else {
        base["finalText"].as_str().unwrap_or_default()
    };
    let cleaned = if let Some(cleaned) = job.checkpoint["cleaned"].as_str() {
        cleaned.to_string()
    } else {
        progress.update(88, "Worker AI merapikan transkrip dengan Knowledge NLP...");
        let cleaned = if job.options.cleanup_transcript {
            crate::ai::clean_transcript_with_knowledge_and_progress(
                source,
                &gateway.base_url,
                &gateway.api_key,
                &gateway.model_id,
                Some(progress.clone()),
                &knowledge_entries,
            )
            .await?
        } else {
            source.to_string()
        };
        let mut tx = jobs::owned_transaction(&pool, job.id, worker)
            .await
            .map_err(db)?;
        sqlx::query("UPDATE transcription_jobs SET checkpoint=checkpoint || $2 WHERE id=$1")
            .bind(job.id)
            .bind(json!({"cleaned":cleaned}))
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        cleaned
    };
    progress.update(94, "Worker AI menyusun notulen rapat...");
    let summary = crate::ai::call_ai_paraphrase_with_knowledge(
        &cleaned,
        &job.options.style,
        job.options.custom_prompt.as_deref(),
        &gateway.base_url,
        &gateway.api_key,
        &gateway.model_id,
        &knowledge_entries,
    )
    .await?;
    let mut response = base;
    response["finalText"] = json!(cleaned);
    response["aiSummary"] = json!(summary);
    response["aiCorrectionStatus"] = json!("completed");
    response["aiEnabled"] = json!(true);
    response["aiError"] = Value::Null;
    finish_ai(state, job, worker, response, true).await
}
async fn finish_ai(
    state: &AppState,
    job: &Job,
    worker: Uuid,
    mut response: Value,
    mut invalidate_docx: bool,
) -> Result<(), String> {
    let pool = state.db_pool();
    let mut tx = jobs::owned_transaction(&pool, job.id, worker)
        .await
        .map_err(db)?;
    let transcript = job
        .transcript_id
        .ok_or("Transkrip pekerjaan AI tidak ditemukan")?;
    let current = sqlx::query(
        "SELECT document_revision,final_text,ai_summary FROM transcripts WHERE id=$1 FOR UPDATE",
    )
    .bind(transcript)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    if current.get::<i64, _>("document_revision") != job.options.document_revision {
        response["finalText"] = json!(current.get::<String, _>("final_text"));
        response["aiSummary"] = json!(current.get::<Option<String>, _>("ai_summary"));
        response["aiCorrectionStatus"] = json!("failed");
        response["aiError"]=json!("Dokumen diperbarui selama AI bekerja. Perubahan yang disimpan tetap dipertahankan; jalankan AI kembali bila diperlukan.");
        invalidate_docx = false;
    }
    sqlx::query("UPDATE transcripts SET final_text=$2,ai_summary=$3,ai_correction_status=$4,ai_corrected_text=CASE WHEN $5 THEN $2 ELSE ai_corrected_text END,document_docx=CASE WHEN $5 THEN NULL ELSE document_docx END,document_revision=document_revision+CASE WHEN $5 THEN 1 ELSE 0 END,ai_data=COALESCE(ai_data,'{}'::jsonb) || $6 WHERE id=$1")
        .bind(transcript).bind(response["finalText"].as_str().unwrap_or_default()).bind(response["aiSummary"].as_str()).bind(response["aiCorrectionStatus"].as_str().unwrap_or("failed"))
        .bind(invalidate_docx).bind(json!({"ai_enabled":response["aiEnabled"],"ai_error":response["aiError"]})).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE transcription_jobs SET state='completed',result=$2,lease_owner=NULL,lease_until=NULL,revision=revision+1,updated_at=NOW() WHERE id=$1")
        .bind(job.id).bind(&response).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE transcription_jobs SET state='completed',result=$2,preview=$2,preview_revision=revision+1,progress=$3,revision=revision+1,updated_at=NOW() WHERE id=$1 AND state='waiting_ai'")
        .bind(job.source_job_id).bind(&response).bind(json!({"type":"progress","percent":100,"stage":"Selesai"})).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(())
}
pub fn permanent_error(error:&str)->bool {
    if error.starts_with("Tidak ada percakapan") || error.starts_with("Nama berkas antrean"){return true;}
    if !error.starts_with("Konversi FFmpeg gagal"){return false;}
    let lower=error.to_lowercase();
    !["no space left","input/output error","resource temporarily unavailable","cannot allocate memory","permission denied","no such file"].iter().any(|message|lower.contains(message))
}

pub async fn fail(state: &AppState, job: &Job, worker: Uuid, error: &str) -> Result<(), String> {
    let pool = state.db_pool();
    let permanent=permanent_error(error);
    if job.attempt < job.max_attempts && !permanent {
        let mut tx = jobs::owned_transaction(&pool, job.id, worker)
            .await
            .map_err(db)?;
        let progress = json!({"type":"progress","stage":format!("Percobaan {} belum selesai; worker akan mencoba kembali dari checkpoint...",job.attempt)});
        sqlx::query("UPDATE transcription_jobs SET state='queued',available_at=NOW()+make_interval(secs => $3),lease_owner=NULL,lease_until=NULL,error=$4,progress=progress || $5,revision=revision+1,updated_at=NOW() WHERE id=$1 AND lease_owner=$2")
            .bind(job.id).bind(worker).bind((job.attempt*10) as f64).bind(error).bind(&progress).execute(&mut *tx).await.map_err(db)?;
        if let Some(parent) = job.source_job_id {
            sqlx::query("UPDATE transcription_jobs SET progress=progress || $2,revision=revision+1,updated_at=NOW() WHERE id=$1 AND state='waiting_ai'").bind(parent).bind(progress).execute(&mut *tx).await.map_err(db)?;
        }
        tx.commit().await.map_err(db)?;
        return Ok(());
    }
    if let Some(parent) = job.source_job_id {
        let mut response: Value =
            sqlx::query_scalar("SELECT preview FROM transcription_jobs WHERE id=$1")
                .bind(parent)
                .fetch_one(&pool)
                .await
                .map_err(db)?;
        response["aiCorrectionStatus"] = json!("failed");
        response["aiError"] = json!(error);
        finish_ai(state, job, worker, response, false).await
    } else {
        let mut tx = jobs::owned_transaction(&pool, job.id, worker)
            .await
            .map_err(db)?;
        sqlx::query("UPDATE transcription_jobs SET state='failed',error=$2,lease_owner=NULL,lease_until=NULL,revision=revision+1,updated_at=NOW() WHERE id=$1")
            .bind(job.id).bind(error).execute(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queue_input_names_cannot_escape_shared_storage() {
        for name in ["../secret", "/etc/passwd", "a/b", "a\\b", ""] {
            assert!(safe_input(name).is_err());
        }
        assert!(safe_input("0193-audio.bin").is_ok());
    }
}

#[cfg(test)]mod retry_classification_tests{use super::*;#[test]fn temporary_storage_failures_can_be_resumed_but_corrupt_audio_needs_replacement(){assert!(permanent_error("Konversi FFmpeg gagal: Invalid data found when processing input"));assert!(!permanent_error("Konversi FFmpeg gagal: No space left on device"));assert!(permanent_error("Tidak ada percakapan yang terdeteksi dalam audio."));assert!(!permanent_error("Worker terputus"));}}
