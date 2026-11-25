//! Real PostgreSQL regression checks. Only the explicitly named scratch DB is accepted.
use crate::{db,jobs::{self,JobOptions},routes::processing::Device};
use serde_json::json;
use sqlx::{postgres::{PgConnectOptions,PgPoolOptions},Row};
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires RESMEET_TEST_DATABASE_URL pointing to scratch database resmeet_test"]
async fn durable_queue_fences_old_workers_and_keeps_checkpoints_private(){
    let url=std::env::var("RESMEET_TEST_DATABASE_URL").expect("Set RESMEET_TEST_DATABASE_URL for the scratch PostgreSQL database");
    let options:PgConnectOptions=url.parse().unwrap();
    assert_eq!(options.get_database(),Some("resmeet_test"),"Refusing to modify a non-test database");
    let pool=PgPoolOptions::new().max_connections(8).connect_with(options).await.unwrap();
    db::ensure_pg_schema(&pool).await.unwrap();
    let owner=Uuid::new_v4();let stranger=Uuid::new_v4();
    for id in [owner,stranger]{sqlx::query("INSERT INTO users (id,username,password_hash) VALUES ($1,$2,'test-only')").bind(id).bind(format!("queue-test-{id}")).execute(&pool).await.unwrap();}
    let options=JobOptions{device:Device::Cpu,ai_correction:false,style:"detail_deskriptif".into(),custom_prompt:None,model_id:None,cleanup_transcript:false,document_revision:0};
    let id=jobs::enqueue(&pool,owner,"recording.wav","test-input",options.clone()).await.unwrap();
    let worker_a=Uuid::new_v4();let worker_b=Uuid::new_v4();
    let first=jobs::claim(&pool,"transcription",worker_a).await.unwrap().unwrap();assert_eq!(first.id,id);
    let mut tx=jobs::owned_transaction(&pool,id,worker_a).await.unwrap();
    sqlx::query("INSERT INTO transcription_chunks (job_id,chunk_index,start_s,end_s,audio_start_s,audio_end_s,result,completed_at) VALUES ($1,0,0,120,0,121,$2,NOW())")
        .bind(id).bind(json!({"text":"25 unit"})).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let checkpoint:serde_json::Value=sqlx::query_scalar("SELECT result FROM transcription_chunks WHERE job_id=$1").bind(id).fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE transcription_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=$1").bind(id).execute(&pool).await.unwrap();
    let resumed=jobs::claim(&pool,"transcription",worker_b).await.unwrap().unwrap();assert_eq!(resumed.id,id);assert_eq!(resumed.attempt,2);
    assert!(jobs::owned_transaction(&pool,id,worker_a).await.is_err());
    assert!(!jobs::renew(&pool,&first,worker_a,Some(json!({"percent":99}))).await.unwrap());
    let current=jobs::owned_transaction(&pool,id,worker_b).await.unwrap();current.commit().await.unwrap();
    let row=sqlx::query("SELECT result FROM transcription_chunks WHERE job_id=$1").bind(id).fetch_one(&pool).await.unwrap();
    assert_eq!(row.get::<serde_json::Value,_>("result"),checkpoint);
    assert!(jobs::snapshot(&pool,id,stranger,None).await.unwrap().is_none());
    sqlx::query("UPDATE transcription_jobs SET state='completed',result=$2,revision=revision+1 WHERE id=$1").bind(id).bind(json!({"id":id,"finalText":"25 unit"})).execute(&pool).await.unwrap();
    let (body,revision)=jobs::snapshot(&pool,id,owner,None).await.unwrap().unwrap();assert_eq!(body["terminal"]["data"]["finalText"],"25 unit");
    assert!(jobs::snapshot(&pool,id,owner,Some(revision)).await.unwrap().unwrap().0.is_null());
    assert_eq!(jobs::snapshot(&pool,id,owner,Some(revision+1)).await.unwrap().unwrap().0["terminal"]["type"],"result");
    // Concurrent claims of separate jobs never return the same queued row.
    let one=jobs::enqueue(&pool,owner,"one.wav","one",options.clone()).await.unwrap();
    let two=jobs::enqueue(&pool,owner,"two.wav","two",options).await.unwrap();
    let (a,b)=tokio::join!(jobs::claim(&pool,"transcription",worker_a),jobs::claim(&pool,"transcription",worker_b));
    let a=a.unwrap().unwrap().id;let b=b.unwrap().unwrap().id;assert_ne!(a,b);assert!([one,two].contains(&a));assert!([one,two].contains(&b));
    for id in [owner,stranger]{sqlx::query("DELETE FROM users WHERE id=$1").bind(id).execute(&pool).await.unwrap();}
    pool.close().await;
}
