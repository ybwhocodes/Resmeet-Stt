mod ai;
mod jobs;
mod auth;
mod config;
mod db;
mod models;
mod nlp;
mod progress;
mod routes;
mod secrets;
mod settings;
mod whisper;
mod audio_chunks;
mod inference;
mod pipeline;
mod worker;
#[cfg(test)]
mod queue_tests;

use axum::{
    extract::{DefaultBodyLimit, FromRef},
    routing::{delete, get, post, put},
    Router,
};
use socketioxide::SocketIo;
use sqlx::PgPool;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::AppConfig;

#[derive(Clone)]
pub struct AppState {
    pub pool: Arc<RwLock<PgPool>>,
    pub db_settings: Arc<RwLock<Option<settings::DatabaseSettings>>>,
    pub setup_lock: Arc<tokio::sync::Mutex<()>>,
    pub settings_path: PathBuf,
    pub secret_cipher: secrets::SecretCipher,
    pub config: AppConfig,
    pub started: std::time::Instant,
}

impl AppState {
    pub fn db_pool(&self) -> PgPool {
        self.pool.read().expect("pool lock poisoned").clone()
    }
}

impl FromRef<AppState> for PgPool {
    fn from_ref(state: &AppState) -> Self {
        state.db_pool()
    }
}

impl FromRef<AppState> for AppConfig {
    fn from_ref(state: &AppState) -> Self {
        state.config.clone()
    }
}

fn with_transport_layers(app: Router) -> Router {
    let (socket_layer, io) = SocketIo::new_layer();
    io.ns("/", |socket: socketioxide::extract::SocketRef| {
        socket.emit("connected", &serde_json::json!({ "status": "ready" })).ok();
    });
    // The outermost layer must also cover Engine.IO polling and its error responses.
    app.layer(socket_layer).layer(CorsLayer::very_permissive())
}

fn frontend_assets(frontend_dist: PathBuf, fallback_dist: PathBuf) -> ServeDir {
    if frontend_dist.join("index.html").is_file() {
        ServeDir::new(frontend_dist)
    } else {
        // The working directory contains credentials and must never be served.
        ServeDir::new(fallback_dist)
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;

    #[tokio::test]
    async fn missing_frontend_never_exposes_the_working_directory() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let missing = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let app = Router::new().fallback_service(frontend_assets(missing.join("frontend"), missing.join("dist")));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        for path in ["/Cargo.toml", "/.env", "/config/database.json", "/config/ai-encryption.key"] {
            let response = reqwest::get(format!("http://{address}{path}")).await.unwrap();
            assert_eq!(response.status(), reqwest::StatusCode::NOT_FOUND);
        }
        server.abort();
    }

    #[tokio::test]
    async fn cors_covers_socket_handshake_post_preflight_and_transport_errors() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, with_transport_layers(Router::new())).await.unwrap(); });
        let client = reqwest::Client::new();
        let url = format!("http://{address}/socket.io/?EIO=4&transport=polling");
        let origin = "http://localhost:5173";
        let response = client.get(&url).header("Origin", origin).send().await.unwrap();
        assert!(response.status().is_success());
        assert_eq!(response.headers()["access-control-allow-origin"], origin);
        assert_eq!(response.headers()["access-control-allow-credentials"], "true");
        let handshake = response.text().await.unwrap();
        let payload: serde_json::Value = serde_json::from_str(&handshake[1..]).unwrap();
        let response = client.post(format!("{url}&sid={}", payload["sid"].as_str().unwrap()))
            .header("Origin", origin).header("Content-Type", "text/plain;charset=UTF-8").body("40").send().await.unwrap();
        assert!(response.status().is_success());
        assert_eq!(response.headers()["access-control-allow-origin"], origin);
        let response = client.request(reqwest::Method::OPTIONS, &url).header("Origin", origin)
            .header("Access-Control-Request-Method", "POST").header("Access-Control-Request-Headers", "content-type").send().await.unwrap();
        assert!(response.status().is_success());
        assert_eq!(response.headers()["access-control-allow-origin"], origin);
        let response = client.get(format!("http://{address}/socket.io/?EIO=4&transport=invalid"))
            .header("Origin", origin).send().await.unwrap();
        assert!(response.status().is_client_error());
        assert_eq!(response.headers()["access-control-allow-origin"], origin);
        server.abort();
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "resmeet_backend=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // 2. Load Configuration
    let config = AppConfig::from_env();
    let role=std::env::var("APP_ROLE").unwrap_or_else(|_|"api".into());
    tracing::info!("Menginisialisasi Resmeet-STT Rust Backend...");
    let settings_path = settings::settings_path();
    let secret_cipher = secrets::SecretCipher::load_or_create(
        settings_path.parent().unwrap_or_else(|| std::path::Path::new("."))
    ).map_err(std::io::Error::other)?;

    // Requirement 9: Database connection loaded directly from .env variables
    let database_settings = if let Ok(host) = std::env::var("DB_HOST") {
        Some(settings::DatabaseSettings {
            host,
            connect_options: None,
            port: std::env::var("DB_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(5432),
            name: std::env::var("DB_NAME").unwrap_or_else(|_| "stt_db".to_string()),
            user: std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string()),
            password: std::env::var("DB_PASSWORD").unwrap_or_else(|_| "password".to_string()),
        })
    } else if let Ok(url) = std::env::var("DATABASE_URL") {
        Some(settings::DatabaseSettings::from_url(&url).map_err(std::io::Error::other)?)
    } else {
        settings::load_database(&settings_path).map_err(std::io::Error::other)?
    };

    let pool = if let Some(db_settings) = &database_settings {
        match db_settings.connect().await {
            Ok(pool) => {
                if role=="api" || role=="all" {
                    db::ensure_pg_schema(&pool).await?;
                    secrets::migrate_ai_keys(&pool, &secret_cipher).await.map_err(std::io::Error::other)?;
                }
                    pool
            }
            Err(error) => {
                tracing::error!("Koneksi PostgreSQL gagal: {error}");
                db_settings.lazy_pool()
            }
        }
    } else {
        tracing::warn!("Database belum disetel di .env. Menggunakan placeholder pool.");
        db::placeholder_pool()
    };

    // 6. State for handlers
    let shared_state = AppState {
        pool: Arc::new(RwLock::new(pool)),
        db_settings: Arc::new(RwLock::new(database_settings)),
        setup_lock: Arc::new(tokio::sync::Mutex::new(())),
        settings_path,
        secret_cipher,
        config: config.clone(),
        started: std::time::Instant::now(),
    };

    if std::env::args().any(|arg|arg=="--check-worker") {
        let kind=if role=="ai-worker"{"ai"}else{"transcription"};
        if jobs::available(&shared_state.db_pool(),kind).await{return Ok(());}
        return Err(std::io::Error::other("Heartbeat worker belum tersedia").into());
    }
    match role.as_str(){
        "worker"|"ai-worker"=>{
            let kind=if role=="worker"{"transcription"}else{"ai"};
            return tokio::select!{
                result=worker::run(shared_state,kind)=>result.map_err(|e|std::io::Error::other(e).into()),
                _=shutdown_signal()=>Ok(()),
            };
        },
        "all"=>{
            for kind in ["transcription","ai"]{let state=shared_state.clone();tokio::spawn(async move{worker::run(state,kind).await.expect("worker stopped");});}
        },
        "api"=>{},
        _=>return Err(std::io::Error::other("APP_ROLE harus api, worker, ai-worker, atau all").into()),
    }

    // 7. API Routes
    let api_routes = Router::new()
        // Health & Preflight
        .route("/health", get(routes::preflight::health_handler))
        .route("/preflight", get(routes::preflight::preflight_handler))
        .route("/setup/status", get(routes::setup::status_handler))
        .route("/setup/database", post(routes::setup::configure_database_handler))
        // Authentication
        .route("/auth/login", post(routes::auth::login_handler))
        .route("/auth/me", get(routes::auth::me_handler))
        .route("/auth/logout", post(routes::auth::logout_handler))
        // Admin
        .route("/admin/users", get(routes::admin::list_users_handler).post(routes::admin::create_user_handler))
        .route("/admin/users/{id}", delete(routes::admin::delete_user_handler))
        .route("/admin/users/{id}/status", axum::routing::patch(routes::admin::update_user_status_handler))
        .route("/admin/users/{id}/reset-password", post(routes::admin::reset_user_password_handler))
        .route("/admin/database", get(routes::admin::get_database_config))
        // Transcripts & Public Sharing
        .route("/transcripts", get(routes::transcripts::list_transcripts_handler))
        .route("/transcripts/{id}", delete(routes::transcripts::delete_transcript_handler))
        .route("/transcripts/{id}/title", axum::routing::patch(routes::documents::update_title))
        .route("/transcripts/{id}/share", post(routes::transcripts::share_transcript_handler))
        .route("/transcripts/{id}/document", get(routes::documents::get_document).put(routes::documents::save_document).layer(DefaultBodyLimit::max(20 * 1024 * 1024)))
        .route("/public/transcripts/share/{slug}/document", get(routes::documents::public_document))
        .route("/transcripts/{id}/mom", put(routes::ai::update_mom_handler))
        .route("/public/transcripts/share/{slug}", get(routes::transcripts::public_share_handler))
        .route("/user/processing-settings", get(routes::processing::get_settings).put(routes::processing::save_settings))
        // NLP Knowledge / RAG
        .route("/knowledge", get(routes::knowledge::list_knowledge_handler).post(routes::knowledge::create_knowledge_handler))
        .route("/knowledge/analyze", post(routes::knowledge::analyze_knowledge_handler))
        .route("/knowledge/{id}", put(routes::knowledge::update_knowledge_handler).delete(routes::knowledge::delete_knowledge_handler))
        // AI & Models
        .route("/paraphrase", post(routes::ai::paraphrase_handler))
        .route("/ai/test", post(routes::ai::test_ai_handler))
        .route("/ai/settings", get(routes::ai::get_ai_settings_handler).post(routes::ai::save_ai_settings_handler))
        .route("/user/ai-models", get(routes::ai::get_ai_models_handler).post(routes::ai::save_ai_models_handler))
        .route("/user/ai-models/{id}", delete(routes::ai::delete_user_ai_model_handler))
        .route("/user/ai-models/set-default", post(routes::ai::set_default_ai_model_handler))
        // Upload & Transcribe (accept up to 1GB audio files)
        .route("/transcription-jobs", get(jobs::list_handler))
        .route("/transcription-jobs/{id}", get(jobs::status_handler))
        .route("/transcription-jobs/{id}/retry", post(jobs::retry_handler))
        .route("/upload-and-transcribe", post(routes::upload::upload_and_transcribe_handler)
            .layer(DefaultBodyLimit::max(1024 * 1024 * 1024)))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .with_state(shared_state);

    // 8. Serve Frontend Static Assets if index.html exists
    let frontend_dist = PathBuf::from("../frontend/dist");
    let fallback_dist = PathBuf::from("dist");
    let static_service = frontend_assets(frontend_dist, fallback_dist);

    // 9. Root router assembling API & Static assets
    let app = with_transport_layers(Router::new()
        .nest("/api", api_routes)
        .fallback_service(static_service));

    // 10. Start Server
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("🚀 Resmeet-STT Rust Server aktif di http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn shutdown_signal(){
    #[cfg(unix)] {
        let mut terminate=tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler unavailable");
        tokio::select!{_=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{}}
    }
    #[cfg(not(unix))] {let _=tokio::signal::ctrl_c().await;}
}
