import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

// Load .env
const baseDir = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(baseDir, ".env") });

export interface AppSettings {
  aiBaseUrl: string;
  aiApiKey: string;
  aiModelId: string;
  aiParaphraseStyle: string;
  aiTimeoutS: number;
  aiEnableCorrection: boolean;
  aiEnableRag: boolean;
  aiEnableKnowledgeExtraction: boolean;
  whisperModel: string;
  modelDir: string;
  cpuThreads: number;
  enableDenoise: boolean;
  ffmpegTimeoutS: number;
  port: number;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

const SETTINGS_FILE = path.join(baseDir, "settings.json");

function loadSavedSettings(): Partial<AppSettings> {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const content = fs.readFileSync(SETTINGS_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn("[Config] Gagal membaca settings.json:", err);
  }
  return {};
}

const saved = loadSavedSettings();

export const config: AppSettings = {
  aiBaseUrl: saved.aiBaseUrl || (process.env.AI_BASE_URL || "http://localhost:20128/v1").replace(/\/+$/, ""),
  aiApiKey: saved.aiApiKey || (process.env.AI_API_KEY || "sk-ff353870199354cb-rvq507-8ef93405"),
  aiModelId: saved.aiModelId || (process.env.AI_MODEL_ID || "9R-Gemini"),
  aiParaphraseStyle: saved.aiParaphraseStyle || "poin_singkat",
  aiTimeoutS: Number(process.env.AI_TIMEOUT_S || 120),
  aiEnableCorrection: (process.env.AI_ENABLE_CORRECTION || "true").toLowerCase() === "true",
  aiEnableRag: (process.env.AI_ENABLE_RAG || "true").toLowerCase() === "true",
  aiEnableKnowledgeExtraction: (process.env.AI_ENABLE_KNOWLEDGE_EXTRACTION || "true").toLowerCase() === "true",
  whisperModel: process.env.WHISPER_MODEL || "large-v3-turbo",
  modelDir: (process.env.MODEL_DIR && fs.existsSync(process.env.MODEL_DIR)) ? process.env.MODEL_DIR : path.join(baseDir, "models"),
  cpuThreads: Number(process.env.CPU_THREADS || 4),
  enableDenoise: (process.env.ENABLE_AUDIO_DENOISE || "false").toLowerCase() === "true",
  ffmpegTimeoutS: Number(process.env.FFMPEG_TIMEOUT_S || 600),
  port: Number(process.env.PORT || 8081),
  dbHost: process.env.DB_HOST || "127.0.0.1",
  dbPort: Number(process.env.DB_PORT || 3307),
  dbName: process.env.DB_NAME || "stt_db",
  dbUser: process.env.DB_USER || "root",
  dbPassword: process.env.DB_PASSWORD || "password",
};

export const PATHS = {
  baseDir,
  uploadDir: path.join(baseDir, "uploads"),
  knowledgeDir: path.join(baseDir, "knowledge"),
  transcriptsMdDir: path.join(baseDir, "transcripts_md"),
  cacheFile: path.join(baseDir, "transcription_cache.json"),
  settingsFile: SETTINGS_FILE,
};

export function updateAiSettings(newSettings: {
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  paraphraseStyle?: string;
}) {
  if (newSettings.baseUrl !== undefined) config.aiBaseUrl = newSettings.baseUrl.replace(/\/+$/, "");
  if (newSettings.apiKey !== undefined) config.aiApiKey = newSettings.apiKey;
  if (newSettings.modelId !== undefined) config.aiModelId = newSettings.modelId;
  if (newSettings.paraphraseStyle !== undefined) config.aiParaphraseStyle = newSettings.paraphraseStyle;

  // Persist to settings.json
  try {
    const toSave = {
      aiBaseUrl: config.aiBaseUrl,
      aiApiKey: config.aiApiKey,
      aiModelId: config.aiModelId,
      aiParaphraseStyle: config.aiParaphraseStyle,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2), "utf-8");
  } catch (e) {
    console.error("[Config] Gagal menyimpan settings.json:", e);
  }
}
