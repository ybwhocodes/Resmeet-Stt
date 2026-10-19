import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

// Load .env
const baseDir = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(baseDir, ".env") });

export interface AppSettings {
  port: number;
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
  dbType: "sqlite" | "mysql" | "postgres";
  dbSqlitePath: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

const dataDir = process.env.RESMEET_DATA_DIR
  ? path.resolve(process.env.RESMEET_DATA_DIR)
  : baseDir;

// Ensure writable directories exist
for (const p of [
  dataDir,
  path.join(dataDir, "uploads"),
  path.join(dataDir, "knowledge"),
  path.join(dataDir, "transcripts_md"),
]) {
  try {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  } catch {}
}

const SETTINGS_FILE = path.join(dataDir, "settings.json");

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

const defaultDbType: "sqlite" | "mysql" | "postgres" =
  (saved.dbType as any) ||
  (process.env.DB_TYPE as any) ||
  "sqlite";

export const config: AppSettings = {
  port: Number(process.env.PORT || saved.port || 8200),
  aiBaseUrl: saved.aiBaseUrl || (process.env.AI_BASE_URL || "http://localhost:20128/v1").replace(/\/+$/, ""),
  aiApiKey: saved.aiApiKey || (process.env.AI_API_KEY || "sk-ff353870199354cb-rvq507-8ef93405"),
  aiModelId: saved.aiModelId || (process.env.AI_MODEL_ID || "9R-Gemini"),
  aiParaphraseStyle: saved.aiParaphraseStyle || "poin_singkat",
  aiTimeoutS: Number(process.env.AI_TIMEOUT_S || 120),
  aiEnableCorrection: (process.env.AI_ENABLE_CORRECTION || "true").toLowerCase() === "true",
  aiEnableRag: (process.env.AI_ENABLE_RAG || "true").toLowerCase() === "true",
  aiEnableKnowledgeExtraction: (process.env.AI_ENABLE_KNOWLEDGE_EXTRACTION || "true").toLowerCase() === "true",
  whisperModel: process.env.WHISPER_MODEL || "large-v3-turbo",
  modelDir: (process.env.MODEL_DIR && fs.existsSync(process.env.MODEL_DIR))
    ? process.env.MODEL_DIR
    : (fs.existsSync(path.join(dataDir, "models"))
      ? path.join(dataDir, "models")
      : path.join(baseDir, "models")),
  cpuThreads: Number(process.env.CPU_THREADS || 4),
  enableDenoise: (process.env.ENABLE_AUDIO_DENOISE || "false").toLowerCase() === "true",
  ffmpegTimeoutS: Number(process.env.FFMPEG_TIMEOUT_S || 600),
  dbType: defaultDbType,
  dbSqlitePath: path.join(dataDir, "resmeet.sqlite"),
  dbHost: saved.dbHost || process.env.DB_HOST || "127.0.0.1",
  dbPort: Number(saved.dbPort || process.env.DB_PORT || (defaultDbType === "postgres" ? 5432 : 3307)),
  dbName: saved.dbName || process.env.DB_NAME || "stt_db",
  dbUser: saved.dbUser || process.env.DB_USER || (defaultDbType === "postgres" ? "postgres" : "root"),
  dbPassword: saved.dbPassword !== undefined ? saved.dbPassword : (process.env.DB_PASSWORD || "password"),
};

export const PATHS = {
  baseDir,
  dataDir,
  uploadDir: path.join(dataDir, "uploads"),
  knowledgeDir: path.join(dataDir, "knowledge"),
  transcriptsMdDir: path.join(dataDir, "transcripts_md"),
  cacheFile: path.join(dataDir, "transcription_cache.json"),
  settingsFile: SETTINGS_FILE,
  sqliteFile: path.join(dataDir, "resmeet.sqlite"),
};

export function saveSettingsToFile() {
  try {
    const toSave = {
      port: config.port,
      aiBaseUrl: config.aiBaseUrl,
      aiApiKey: config.aiApiKey,
      aiModelId: config.aiModelId,
      aiParaphraseStyle: config.aiParaphraseStyle,
      dbType: config.dbType,
      dbHost: config.dbHost,
      dbPort: config.dbPort,
      dbName: config.dbName,
      dbUser: config.dbUser,
      dbPassword: config.dbPassword,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2), "utf-8");
  } catch (e) {
    console.error("[Config] Gagal menyimpan settings.json:", e);
  }
}

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

  saveSettingsToFile();
}

export function updateDbSettings(newDb: {
  dbType?: "sqlite" | "mysql" | "postgres";
  dbHost?: string;
  dbPort?: number;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
}) {
  if (newDb.dbType !== undefined) config.dbType = newDb.dbType;
  if (newDb.dbHost !== undefined) config.dbHost = newDb.dbHost;
  if (newDb.dbPort !== undefined) config.dbPort = Number(newDb.dbPort);
  if (newDb.dbName !== undefined) config.dbName = newDb.dbName;
  if (newDb.dbUser !== undefined) config.dbUser = newDb.dbUser;
  if (newDb.dbPassword !== undefined) config.dbPassword = newDb.dbPassword;

  saveSettingsToFile();
}
