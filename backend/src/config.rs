use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub port: u16,
    pub whisper_model: String,
    pub model_dir: PathBuf,
    pub cpu_threads: usize,
    pub uploads_dir: PathBuf,
}

impl AppConfig {
    pub fn model_path(&self) -> PathBuf {
        let file_name = if self.whisper_model.ends_with(".bin") {
            self.whisper_model.clone()
        } else {
            format!("ggml-{}-q5_0.bin", self.whisper_model)
        };
        self.model_dir.join(file_name)
    }

    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        let root_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let uploads_dir = root_dir.join("uploads");
        let model_dir = std::env::var("MODEL_DIR")
            .ok().filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| root_dir.join("models"));
        for dir in [&uploads_dir, &model_dir] { let _ = std::fs::create_dir_all(dir); }
        Self {
            port: env_parse("PORT", 8200),
            whisper_model: env_default("WHISPER_MODEL", "large-v3-turbo"),
            model_dir,
            cpu_threads: env_parse("CPU_THREADS", 4),
            uploads_dir,
        }
    }
}

fn env_default(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

fn env_parse<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}
