mod ai;
mod auth;
mod config;
mod db;
mod models;
mod routes;
mod secrets;
mod settings;
mod whisper;

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
    tracing::info!("Menginisialisasi Resmeet-STT Rust Backend...");
    let settings_path = settings::settings_path();
    let secret_cipher = secrets::SecretCipher::load_or_create(
        settings_path.parent().unwrap_or_else(|| std::path::Path::new("."))
    ).map_err(std::io::Error::other)?;

    // Requirement 9: Database connection loaded directly from .env variables
    let database_settings = if let Ok(host) = std::env::var("DB_HOST") {
        Some(settings::DatabaseSettings {
            host,
            port: std::env::var("DB_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(5432),
            name: std::env::var("DB_NAME").unwrap_or_else(|_| "stt_db".to_string()),
            user: std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string()),
            password: std::env::var("DB_PASSWORD").unwrap_or_else(|_| "password".to_string()),
        })
    } else if let Ok(_db_url) = std::env::var("DATABASE_URL") {
        // Parse simple postgres://user:pass@host:port/dbname if needed or fallback
        settings::load_database(&settings_path).map_err(std::io::Error::other)?
    } else {
        settings::load_database(&settings_path).map_err(std::io::Error::other)?
    };

    let pool = if let Some(db_settings) = &database_settings {
        match db_settings.connect().await {
            Ok(pool) => {
                db::ensure_pg_schema(&pool).await?;
                secrets::migrate_ai_keys(&pool, &secret_cipher).await.map_err(std::io::Error::other)?;
                db::seed_initial_superadmin(&pool).await?;
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

    // 4. Initialize Socket.IO Layer for realtime progress
    let (socket_layer, io) = SocketIo::new_layer();
    io.ns("/", |socket: socketioxide::extract::SocketRef| {
        tracing::info!("Socket.IO Client terhubung: {}", socket.id);
        socket.emit("connected", &serde_json::json!({ "status": "ready" })).ok();
    });

    // 5. Setup CORS Layer
    let cors = CorsLayer::very_permissive();

    // 6. State for handlers
    let shared_state = AppState {
        pool: Arc::new(RwLock::new(pool)),
        db_settings: Arc::new(RwLock::new(database_settings)),
        setup_lock: Arc::new(tokio::sync::Mutex::new(())),
        settings_path,
        secret_cipher,
        config: config.clone(),
    };

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
        .route("/transcripts/{id}/share", post(routes::transcripts::share_transcript_handler))
        .route("/transcripts/{id}/mom", put(routes::ai::update_mom_handler))
        .route("/public/transcripts/share/{slug}", get(routes::transcripts::public_share_handler))
        // AI & Models
        .route("/paraphrase", post(routes::ai::paraphrase_handler))
        .route("/ai/test", post(routes::ai::test_ai_handler))
        .route("/ai/settings", get(routes::ai::get_ai_settings_handler).post(routes::ai::save_ai_settings_handler))
        .route("/user/ai-models", get(routes::ai::get_ai_models_handler).post(routes::ai::save_ai_models_handler))
        .route("/user/ai-models/{id}", delete(routes::ai::delete_user_ai_model_handler))
        .route("/user/ai-models/set-default", post(routes::ai::set_default_ai_model_handler))
        // Upload & Transcribe (accept up to 1GB audio files)
        .route("/upload-and-transcribe", post(routes::upload::upload_and_transcribe_handler))
        .layer(DefaultBodyLimit::max(1024 * 1024 * 1024))
        .with_state(shared_state);

    // 8. Serve Frontend Static Assets if index.html exists
    let frontend_dist = PathBuf::from("../frontend/dist");
    let fallback_dist = PathBuf::from("dist");
    let static_service = if frontend_dist.join("index.html").exists() {
        ServeDir::new(frontend_dist)
    } else if fallback_dist.join("index.html").exists() {
        ServeDir::new(fallback_dist)
    } else {
        ServeDir::new(".")
    };

    // 9. Root router assembling API & Static assets
    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(static_service)
        .layer(cors)
        .layer(socket_layer);

    // 10. Start Server
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("🚀 Resmeet-STT Rust Server aktif di http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
