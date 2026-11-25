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
    #[serde(skip)]
    pub connect_options: Option<PgConnectOptions>,
}

impl DatabaseSettings {
    pub fn from_url(url: &str) -> Result<Self, String> {
        let parsed = reqwest::Url::parse(url).map_err(|e| format!("DATABASE_URL tidak valid: {e}"))?;
        let options: PgConnectOptions = url.parse().map_err(|e| format!("DATABASE_URL tidak valid: {e}"))?;
        Ok(Self {
            host: options.get_host().to_string(), port: options.get_port(),
            name: options.get_database().unwrap_or("postgres").to_string(),
            user: options.get_username().to_string(),
            password: decode_url_password(parsed.password().unwrap_or_default())?,
            connect_options: Some(options),
        })
    }

    fn options(&self) -> PgConnectOptions {
        if let Some(options) = &self.connect_options { return options.clone(); }
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

fn decode_url_password(value: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    let mut input = value.as_bytes().iter().copied();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let pair = [input.next().ok_or("Password URL tidak valid")?, input.next().ok_or("Password URL tidak valid")?];
            let hex = std::str::from_utf8(&pair).map_err(|_| "Password URL tidak valid")?;
            bytes.push(u8::from_str_radix(hex, 16).map_err(|_| "Password URL tidak valid")?);
        } else { bytes.push(byte); }
    }
    String::from_utf8(bytes).map_err(|_| "Password URL bukan UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_database_url_with_encoded_password() {
        let settings = DatabaseSettings::from_url("postgres://user:p%40ss%3Aword%2B@localhost:5433/meetings").unwrap();
        assert_eq!(settings.password, "p@ss:word+");
        assert_eq!(settings.host, "localhost");
        assert_eq!(settings.port, 5433);
        assert_eq!(settings.name, "meetings");
        assert!(DatabaseSettings::from_url("invalid").is_err());
    }
}
