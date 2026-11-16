use serde::{Deserialize, Serialize};
use sqlx::{postgres::{PgConnectOptions, PgPoolOptions}, PgPool};
use std::{fs, io, path::{Path, PathBuf}};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DatabaseSettings {
    pub host: String,
    pub port: u16,
    pub name: String,
    pub user: String,
    pub password: String,
}

impl DatabaseSettings {
    fn options(&self) -> PgConnectOptions {
        PgConnectOptions::new()
            .host(&self.host).port(self.port).database(&self.name)
            .username(&self.user).password(&self.password)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.host.trim().is_empty() || self.name.trim().is_empty() || self.user.trim().is_empty() || self.port == 0 {
            return Err("Host, port, nama database, dan username wajib diisi.".into());
        }
        if self.password.is_empty() {
            return Err("Password database wajib diisi.".into());
        }
        Ok(())
    }

    pub async fn connect(&self) -> Result<PgPool, sqlx::Error> {
        PgPoolOptions::new().max_connections(15)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(self.options()).await
    }

    pub fn lazy_pool(&self) -> PgPool {
        PgPoolOptions::new().max_connections(15)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_lazy_with(self.options())
    }
}

pub fn settings_path() -> PathBuf {
    std::env::var("APP_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("database.json")
}

pub fn load_database(path: &Path) -> Result<Option<DatabaseSettings>, String> {
    if !path.exists() { return Ok(None); }
    let bytes = fs::read(path).map_err(|e| format!("Gagal membaca konfigurasi database: {e}"))?;
    serde_json::from_slice(&bytes).map(Some).map_err(|e| format!("Konfigurasi database tidak valid: {e}"))
}

pub fn save_database(path: &Path, settings: &DatabaseSettings) -> io::Result<()> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec(settings)?)?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(temp, path)
}
