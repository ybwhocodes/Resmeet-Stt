use crate::{
    inference::EnginePool,
    jobs::{self, Job},
    progress::ProgressReporter,
    AppState,
};
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::watch;
use uuid::Uuid;

pub async fn run(state: AppState, kind: &str) -> Result<(), String> {
    let worker = Uuid::new_v4();
    let engine_pool = Arc::new(EnginePool::new(state.config.stt_concurrency));
    loop {
        if let Err(error) = refresh_database(&state).await {
            tracing::warn!(%error,"Worker menunggu konfigurasi database");
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }
        let pool = state.db_pool();
        let leader = async {
            let mut connection = pool.acquire().await?.detach();
            let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(hashtextextended($1,0))")
                .bind(format!("resmeet-worker-{kind}"))
                .fetch_one(&mut connection)
                .await?;
            if !locked {
                return Ok::<_, sqlx::Error>(());
            }
            tracing::info!(%worker, kind, "Worker memperoleh pengunci global PostgreSQL");

            let hb_pool = pool.clone();
            let hb_kind = kind.to_string();
            let (hb_stop_tx, mut hb_stop_rx) = tokio::sync::oneshot::channel::<()>();
            let hb_handle = tokio::spawn(async move {
                let mut hb_interval = tokio::time::interval(Duration::from_secs(5));
                hb_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                loop {
                    tokio::select! {
                        _ = hb_interval.tick() => {
                            let _ = jobs::heartbeat(&hb_pool, &hb_kind, worker).await;
                        }
                        _ = &mut hb_stop_rx => break,
                    }
                }
            });

            let mut last_gc = Instant::now().checked_sub(Duration::from_secs(3601)).unwrap_or_else(Instant::now);
            let loop_res = async {
                loop {
                    jobs::heartbeat(&pool, kind, worker).await?;
                    sqlx::query("SELECT 1").execute(&mut connection).await?;
                    let Some(job) = jobs::claim(&pool, kind, worker).await? else {
                        engine_pool.unload_if_idle(state.config.model_idle_seconds).await;
                        if last_gc.elapsed() > Duration::from_secs(3600) {
                            cleanup_old_jobs(&state).await?;
                            last_gc = Instant::now();
                        }
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    };
                    let (sender, receiver) = watch::channel(Value::Null);
                    let initial = job.progress["percent"].as_u64().unwrap_or(0).min(100) as u8;
                    let progress = ProgressReporter::new(None).with_sink(sender, initial);
                    let engine_pool_clone = engine_pool.clone();
                    let result = {
                        let work = async {
                            if job.attempt > job.max_attempts {
                                return Err("Worker berhenti berulang kali; pekerjaan memerlukan percobaan ulang.".into());
                            }
                            if kind == "transcription" {
                                crate::pipeline::transcribe(&state, &job, worker, engine_pool_clone, progress).await
                            } else {
                                crate::pipeline::process_ai(&state, &job, worker, progress).await
                            }
                        };
                        tokio::select! {
                            result = work => Some(result),
                            error = maintain_lease(&pool, &mut connection, &job, worker, kind, receiver) => {
                                tracing::warn!(job_id=%job.id, %error, "Lease hilang; pekerjaan dihentikan agar tidak diproses ganda");
                                None
                            }
                        }
                    };
                    match result {
                        Some(Ok(())) => {},
                        Some(Err(error)) => {
                            tracing::warn!(job_id=%job.id, attempt=job.attempt, %error, "Pekerjaan belum selesai");
                            crate::pipeline::fail(&state, &job, worker, &error).await.map_err(sqlx::Error::Protocol)?;
                        },
                        None => {
                            engine_pool.reset().await;
                            if matches!(sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM transcription_jobs WHERE id=$1)").bind(job.id).fetch_one(&pool).await, Ok(false)) {
                                crate::pipeline::cleanup_files(&state, job.id, job.input_name.as_deref()).await;
                            }
                            return Err(sqlx::Error::Protocol("Koneksi/lease worker terputus".into()));
                        }
                    }
                }
            }.await;

            let _ = hb_stop_tx.send(());
            hb_handle.abort();
            loop_res
        }.await;
        engine_pool.reset().await;
        if let Err(error) = leader {
            tracing::warn!(%error, kind, "Worker akan menyambung kembali");
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

async fn maintain_lease(
    pool: &sqlx::PgPool,
    connection: &mut sqlx::PgConnection,
    job: &Job,
    worker: Uuid,
    kind: &str,
    mut progress: watch::Receiver<Value>,
) -> String {
    let mut interval = tokio::time::interval(Duration::from_secs((jobs::LEASE_SECONDS as u64 / 3).max(1)));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = interval.tick() => {
                let _ = jobs::heartbeat(pool, kind, worker).await;
                if let Err(error) = sqlx::query("SELECT 1").execute(&mut *connection).await {
                    return format!("Koneksi leader terputus: {error}");
                }
                match jobs::renew(pool, job, worker, None).await {
                    Ok(true) => {},
                    Ok(false) => return "Pekerjaan diambil alih oleh worker lain".into(),
                    Err(error) => return format!("Gagal memperbarui lease: {error}"),
                }
            }
            change = progress.changed() => {
                if change.is_err() { continue; }
                let latest = progress.borrow().clone();
                if latest.is_null() { continue; }
                let _ = jobs::heartbeat(pool, kind, worker).await;
                if let Err(error) = jobs::renew(pool, job, worker, Some(latest)).await {
                    tracing::warn!(job_id=%job.id,%error,"Progres sementara gagal disimpan");
                }
            }
        }
    }
}

async fn refresh_database(state: &AppState) -> Result<(), sqlx::Error> {
    let pool = state.db_pool();
    let mut connection = pool.acquire().await?.detach();
    sqlx::query("SELECT 1").execute(&mut connection).await?;
    jobs::ensure_schema(&pool).await?;
    Ok(())
}

async fn cleanup_old_jobs(state: &AppState) -> Result<(), sqlx::Error> {
    let pool = state.db_pool();
    let expired: Vec<(Uuid, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT id, input_name, state
           FROM transcription_jobs
           WHERE created_at < NOW() - make_interval(hours => 24)
             AND state IN ('completed', 'failed')
           LIMIT 50"#,
    )
    .fetch_all(&pool)
    .await?;

    for (job_id, input_name, state_str) in expired {
        tracing::info!(%job_id, ?state_str, "Membersihkan data file pekerjaan kadaluarsa (>24 jam)");
        crate::pipeline::cleanup_files(
            state,
            job_id,
            input_name.as_deref(),
        )
        .await;

        let _ = sqlx::query(
            "UPDATE transcription_jobs SET input_name=NULL, checkpoint=checkpoint || jsonb_build_object('input_expired', true), updated_at=NOW() WHERE id=$1",
        )
        .bind(job_id)
        .execute(&pool)
        .await;
    }

    Ok(())
}
