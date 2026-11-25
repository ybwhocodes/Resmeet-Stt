use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub port: u16,
    pub whisper_model: String,
    pub model_dir: PathBuf,
    pub cpu_threads: usize,
    pub uploads_dir: PathBuf,
    pub stt_engine: String,
    pub faster_model_dir: PathBuf,
    pub faster_python: PathBuf,
    pub faster_worker: PathBuf,
    pub stt_batch_size: usize,
    pub stt_concurrency: usize,
    pub vad_model: PathBuf,
    pub vad_enabled: bool,
    pub chunk_seconds: f32,
    pub model_idle_seconds: u64,
}

impl AppConfig {
    pub fn native_server(&self) -> Option<PathBuf> {
        if let Some(path)=std::env::var_os("WHISPER_SERVER").map(PathBuf::from){return path.is_file().then_some(path);}
        [PathBuf::from("/usr/local/bin/whisper-server"),PathBuf::from("/usr/bin/whisper-server")].into_iter()
            .chain(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).map(|path|path.join("whisper-server")))
            .find(|path|path.is_file())
    }
    pub fn gpu_info(&self) -> GpuInfo {
        let render = std::fs::read_dir("/dev/dri").ok().and_then(|entries| entries.flatten()
            .find(|entry| entry.file_name().to_string_lossy().starts_with("renderD")));
        let detected = render.is_some();
        let name = render.and_then(|entry| {
            let vendor = std::fs::read_to_string(std::path::Path::new("/sys/class/drm").join(entry.file_name()).join("device/vendor")).ok()?;
            Some(match vendor.trim() { "0x1002" => "AMD · Vulkan", "0x8086" => "Intel · Vulkan", "0x10de" => "NVIDIA · Vulkan", _ => "GPU · Vulkan" }.to_string())
        }).unwrap_or_else(|| "GPU · Vulkan".into());
        let has_vulkan_lib = std::path::Path::new("/usr/local/lib/libggml-vulkan.so").is_file()
            || std::path::Path::new("/usr/local/lib/libggml-vulkan.so.1").is_file();
        GpuInfo { detected, available: detected && has_vulkan_lib && self.model_path().is_file() && self.native_server().is_some(), name }
    }
    pub fn faster_available(&self) -> bool {
        self.stt_engine != "whisper_cpp" && self.faster_python.is_file() && self.faster_worker.is_file()
            && self.faster_model_dir.join("model.bin").is_file() && self.faster_model_dir.join("config.json").is_file()
    }
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
        let chunk_seconds=env_parse("STT_CHUNK_SECONDS",45.0f32);
        let chunk_seconds=if chunk_seconds.is_finite(){chunk_seconds.clamp(5.0,600.0)}else{45.0};
        Self {
            port: env_parse("PORT", 8200),
            whisper_model: env_default("WHISPER_MODEL", "large-v3-turbo"),
            stt_engine: env_default("STT_ENGINE", "auto"),
            faster_model_dir: std::env::var("FASTER_WHISPER_MODEL_DIR").map(PathBuf::from).unwrap_or_else(|_| model_dir.join("faster-whisper-large-v3-turbo")),
            faster_python: PathBuf::from(env_default("FASTER_WHISPER_PYTHON", "/opt/stt-python/bin/python")),
            faster_worker: root_dir.join("scripts/transcribe_fast.py"),
            stt_batch_size: env_parse("STT_BATCH_SIZE", 1usize).clamp(1, 4),
            stt_concurrency: env_parse("STT_CONCURRENCY", 2usize).clamp(1, 4),
            vad_model: model_dir.join(env_default("WHISPER_VAD_MODEL", "ggml-silero-v6.2.0.bin")),
            vad_enabled: env_parse("VAD_ENABLED", true),
            chunk_seconds,
            model_idle_seconds: env_parse("MODEL_IDLE_SECONDS", 300u64).clamp(10,3600),
            model_dir,
            cpu_threads: env_parse("CPU_THREADS", 6usize).clamp(1, std::thread::available_parallelism().map(|n| n.get()).unwrap_or(6)),
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

#[derive(Debug)]
pub struct GpuInfo { pub detected: bool, pub available: bool, pub name: String }
