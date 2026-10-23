import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Server } from "socket.io";
import { config, PATHS, updateAiSettings, updateDbSettings } from "./config";
import {
  initDb,
  checkDbConnection,
  testDbConnection,
  migrateDatabase,
  saveTranscript,
  getRecentTranscripts,
  getTranscriptById,
  deleteTranscript,
  updateTranscriptParaphrase,
  closeDbConnections,
} from "./db";
import { ensureKnowledgeFiles, updateKnowledge } from "./knowledge";
import { calculateFileHash, getCacheKey, readCache, writeCache } from "./cache";
import { convertWithFfmpeg, transcribeWithProgress, getWhisperModelPath, findWhisperCliBinary } from "./whisper";
import { callAiCorrection, callAiParaphrase, isAiConfigured, testAiConnection, resolveParaphraseStyle } from "./ai";
import { renderMarkdown } from "./markdown";

const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "webm", "mp4", "mpeg", "mpg", "m4v", "aac"]);

interface JobStatus {
  status: string;
  queued_at?: string;
  started_at?: string;
  error?: string;
  cache_hit?: boolean;
  md_url?: string | null;
  progress?: {
    percent: number;
    stage: string;
    elapsed_s: number;
    current_text: string;
  };
  [key: string]: any;
}

const JOB_STATUS: Record<string, JobStatus> = {};

function setJobStatus(jobId: string, status: string, extra: Record<string, any> = {}) {
  JOB_STATUS[jobId] = { ...(JOB_STATUS[jobId] || {}), status, ...extra };
}

function getJobStatus(jobId: string): JobStatus | undefined {
  return JOB_STATUS[jobId];
}

function emitJobProgress(jobId: string, percent: number, stage: string, elapsed_s = 0, current_text = "") {
  const p = { percent, stage, elapsed_s, current_text };
  setJobStatus(jobId, "processing", { progress: p });
  io.to(jobId).emit("progress", {
    job_id: jobId,
    ...p,
  });
}

// Check system preflight
async function runPreflight(requireAi = false) {
  ensureKnowledgeFiles();

  let ffmpegOk = false;
  try {
    const p = Bun.spawnSync(["ffmpeg", "-version"]);
    ffmpegOk = p.exitCode === 0;
  } catch {
    ffmpegOk = false;
  }

  let whisperModelOk = false;
  try {
    const modelPath = getWhisperModelPath();
    whisperModelOk = fs.existsSync(modelPath);
  } catch {
    whisperModelOk = false;
  }

  const dbOk = await checkDbConnection();

  const checks = {
    uploads_writable: fs.existsSync(PATHS.uploadDir),
    knowledge_readable: fs.existsSync(PATHS.knowledgeDir),
    transcripts_md_writable: fs.existsSync(PATHS.transcriptsMdDir),
    ffmpeg: ffmpegOk,
    format_mom: fs.existsSync(path.join(PATHS.knowledgeDir, "format-mom.md")),
    whisper_model: whisperModelOk,
    database: dbOk,
    drizzle_orm: dbOk,
    whisper_engine: true,
    ai_config: !requireAi || isAiConfigured(),
  };

  return checks;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

export function getFrontendDistDir(): string | null {
  const candidates = [
    process.env.FRONTEND_DIST_DIR,
    path.join(PATHS.baseDir, "..", "frontend", "dist"),
    path.join(PATHS.baseDir, "frontend", "dist"),
    path.join(PATHS.baseDir, "dist"),
    path.join(PATHS.dataDir, "dist"),
    path.join(process.cwd(), "frontend", "dist"),
    path.join(process.cwd(), "dist"),
    path.join(path.dirname(process.execPath), "..", "app", "dist"),
    path.join(path.dirname(process.execPath), "..", "dist"),
    path.join(path.dirname(process.execPath), "dist"),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, "index.html"))) {
      return c;
    }
  }
  return null;
}

function serveStaticFrontend(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const distDir = getFrontendDistDir();
  if (!distDir) {
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Resmeet STT Server</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0e14; color: #f1f5f9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .box { background: #151821; border: 1px solid #1e2330; border-radius: 16px; padding: 32px; max-width: 520px; text-align: center; }
    h1 { color: #818cf8; margin-top: 0; font-size: 22px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
    .status { display: inline-block; padding: 6px 14px; background: #10b981; color: #fff; border-radius: 9999px; font-size: 12px; font-weight: 700; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="status">✓ Resmeet-STT Backend Online</div>
    <h1>Resmeet STT API Server</h1>
    <p>Backend API berjalan normal pada port ${config.port}. Jika menggunakan frontend web mandiri, pastikan berkas web telah dikompilasi atau buka <code>http://localhost:5173</code>.</p>
  </div>
</body>
</html>`);
      return true;
    }
    return false;
  }

  // Sanitize path to prevent directory traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(distDir, safePath);

  // If path is a directory or root, serve index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  // If file doesn't exist, fallback to index.html (SPA client-side routing)
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(distDir, "index.html");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const isImmutable = pathname.startsWith("/assets/");

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": isImmutable ? "public, max-age=31536000, immutable" : "no-cache",
    });

    if (req.method === "HEAD") {
      res.end();
      return true;
    }

    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  return false;
}

// Start HTTP and Socket.IO server
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // Serve static frontend assets and SPA routes when not an /api route
  if (!pathname.startsWith("/api")) {
    if (serveStaticFrontend(pathname, req, res)) {
      return;
    }
  }

  // JSON helper
  const sendJson = (data: any, statusCode = 200) => {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  // Helper to read JSON body
  const readJsonBody = async () => {
    const buffers: Buffer[] = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const str = Buffer.concat(buffers).toString("utf-8");
    return str ? JSON.parse(str) : {};
  };

  try {
    // 1. Health check
    if (pathname === "/api/health" && req.method === "GET") {
      let modelPath = "";
      try {
        modelPath = getWhisperModelPath();
      } catch {}

      return sendJson({
        status: "ok",
        server: "Bun + TypeScript",
        engine: "whisper.cpp",
        orm: "Drizzle ORM (Zero-overhead)",
        worker_mode: "In-Process Realtime Streaming Engine",
        model: config.whisperModel,
        model_path: modelPath,
        cpu_threads: config.cpuThreads,
        ai_correction_enabled: config.aiEnableCorrection && isAiConfigured(),
        ai_model: config.aiModelId,
        ai_base_url: config.aiBaseUrl,
        rag_enabled: config.aiEnableRag,
        knowledge_ready: fs.existsSync(PATHS.knowledgeDir),
      });
    }

    // 2. Preflight check
    if (pathname === "/api/preflight" && req.method === "GET") {
      const requireAi = url.searchParams.get("ai") === "true";
      const checks = await runPreflight(requireAi);
      const allOk = Object.values(checks).every(Boolean);
      return sendJson({ status: allOk ? "ok" : "failed", checks }, allOk ? 200 : 500);
    }

    // 3. Settings - GET current configuration
    if (pathname === "/api/settings" && req.method === "GET") {
      return sendJson({
        port: config.port,
        baseUrl: config.aiBaseUrl,
        apiKey: config.aiApiKey,
        modelId: config.aiModelId,
        paraphraseStyle: config.aiParaphraseStyle,
        isConfigured: isAiConfigured(),
        whisperModel: config.whisperModel,
        dbType: config.dbType || "sqlite",
        dbHost: config.dbHost,
        dbPort: config.dbPort,
        dbName: config.dbName,
        dbUser: config.dbUser,
        dbPassword: config.dbPassword,
      });
    }

    // 4. Settings - POST update configuration
    if (pathname === "/api/settings" && (req.method === "POST" || req.method === "PUT")) {
      const body = await readJsonBody();
      
      // Update AI settings
      if (body.baseUrl !== undefined || body.apiKey !== undefined || body.modelId !== undefined || body.paraphraseStyle !== undefined) {
        updateAiSettings({
          baseUrl: body.baseUrl || body.url,
          apiKey: body.apiKey || body.api_key,
          modelId: body.modelId || body.model || body.model_id,
          paraphraseStyle: body.paraphraseStyle || body.aiParaphraseStyle,
        });
      }

      // Update Database settings
      if (body.dbType !== undefined || body.dbHost !== undefined || body.dbPort !== undefined || body.dbName !== undefined || body.dbUser !== undefined || body.dbPassword !== undefined) {
        updateDbSettings({
          dbType: body.dbType,
          dbHost: body.dbHost,
          dbPort: body.dbPort ? Number(body.dbPort) : undefined,
          dbName: body.dbName,
          dbUser: body.dbUser,
          dbPassword: body.dbPassword,
        });
        await closeDbConnections();
        await initDb();
      }

      return sendJson({
        success: true,
        message: "Pengaturan berhasil diperbarui dan disimpan.",
        settings: {
          port: config.port,
          baseUrl: config.aiBaseUrl,
          apiKey: config.aiApiKey ? `${config.aiApiKey.slice(0, 4)}...${config.aiApiKey.slice(-4)}` : "",
          modelId: config.aiModelId,
          paraphraseStyle: config.aiParaphraseStyle,
          dbType: config.dbType,
          dbHost: config.dbHost,
          dbPort: config.dbPort,
          dbName: config.dbName,
          dbUser: config.dbUser,
        },
      });
    }

    // 5. Settings - POST test AI connection
    if (pathname === "/api/settings/test" && req.method === "POST") {
      const body = await readJsonBody();
      const testUrl = body.baseUrl || body.url || config.aiBaseUrl;
      const testKey = body.apiKey || body.api_key || config.aiApiKey;
      const testModel = body.modelId || body.model || config.aiModelId;

      const result = await testAiConnection(testUrl, testKey, testModel);
      return sendJson(result, result.success ? 200 : 400);
    }

    // 5.1 Settings - POST test Database connection
    if (pathname === "/api/settings/db-test" && req.method === "POST") {
      const body = await readJsonBody();
      const result = await testDbConnection({
        type: body.type || body.dbType || config.dbType,
        host: body.host || body.dbHost || config.dbHost,
        port: body.port || body.dbPort || config.dbPort,
        user: body.user || body.dbUser || config.dbUser,
        password: body.password !== undefined ? body.password : config.dbPassword,
        name: body.name || body.dbName || config.dbName,
      });
      return sendJson(result, result.success ? 200 : 400);
    }

    // 5.2 Settings - POST migrate Database schema
    if (pathname === "/api/settings/db-migrate" && req.method === "POST") {
      const body = await readJsonBody();
      const targetType = body.type || body.dbType || config.dbType || "sqlite";
      const targetHost = body.host || body.dbHost || config.dbHost;
      const targetPort = body.port || body.dbPort || config.dbPort;
      const targetUser = body.user || body.dbUser || config.dbUser;
      const targetPassword = body.password !== undefined ? body.password : config.dbPassword;
      const targetName = body.name || body.dbName || config.dbName;

      const result = await migrateDatabase({
        type: targetType,
        host: targetHost,
        port: targetPort,
        user: targetUser,
        password: targetPassword,
        name: targetName,
      });

      if (result.success) {
        updateDbSettings({
          dbType: targetType,
          dbHost: targetHost,
          dbPort: Number(targetPort),
          dbUser: targetUser,
          dbPassword: targetPassword,
          dbName: targetName,
        });
        await closeDbConnections();
        await initDb();
      }

      return sendJson(result, result.success ? 200 : 400);
    }

    // 5.3 Settings - POST set default database
    if (pathname === "/api/settings/set-default-db" && req.method === "POST") {
      const body = await readJsonBody();
      const targetType = (body.type || body.dbType || "sqlite").toLowerCase() as "sqlite" | "mysql" | "postgres";
      const targetHost = body.host || body.dbHost || config.dbHost;
      const targetPort = body.port || body.dbPort || config.dbPort;
      const targetUser = body.user || body.dbUser || config.dbUser;
      const targetPassword = body.password !== undefined ? body.password : config.dbPassword;
      const targetName = body.name || body.dbName || config.dbName;

      updateDbSettings({
        dbType: targetType,
        dbHost: targetHost,
        dbPort: Number(targetPort),
        dbUser: targetUser,
        dbPassword: targetPassword,
        dbName: targetName,
      });

      await closeDbConnections();
      const initResult = await initDb();

      return sendJson({
        success: initResult.success,
        message: initResult.success
          ? `${targetType.toUpperCase()} berhasil diatur dan disimpan sebagai default penyimpanan sistem.`
          : `Gagal mengaktifkan ${targetType}: ${initResult.message}`,
        activeDefaultDb: config.dbType,
      }, initResult.success ? 200 : 400);
    }

    // 6. Transcripts list
    if (pathname === "/api/transcripts" && req.method === "GET") {
      const list = await getRecentTranscripts(50);
      return sendJson(list);
    }

    // 6.1 Get single transcript by ID
    const singleTranscriptMatch = pathname.match(/^\/api\/transcripts\/(\d+)$/);
    if (singleTranscriptMatch && req.method === "GET") {
      const id = parseInt(singleTranscriptMatch[1], 10);
      const row = await getTranscriptById(id);
      if (!row) {
        return sendJson({ error: "Transkrip tidak ditemukan" }, 404);
      }
      return sendJson(row);
    }

    // 7. Download transcript markdown by database ID
    const transcriptMatch = pathname.match(/^\/api\/transcripts\/(\d+)\/download-md$/);
    if (transcriptMatch && req.method === "GET") {
      const id = parseInt(transcriptMatch[1], 10);
      const row = await getTranscriptById(id);
      if (!row || !row.md_path || !fs.existsSync(row.md_path)) {
        return sendJson({ error: "Markdown tidak ditemukan" }, 404);
      }
      const filename = `transcript-${row.filename || id}.md`;
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
      return fs.createReadStream(row.md_path).pipe(res);
    }

    // 8. Delete transcript by ID
    const transcriptDeleteMatch = pathname.match(/^\/api\/transcripts\/(\d+)$/);
    if (transcriptDeleteMatch && req.method === "DELETE") {
      const id = parseInt(transcriptDeleteMatch[1], 10);
      const ok = await deleteTranscript(id);
      if (!ok) {
        return sendJson({ error: "Transkrip tidak ditemukan atau gagal dihapus." }, 404);
      }
      return sendJson({ success: true, message: `Transkrip ID ${id} berhasil dihapus.` });
    }

    // 9. Job status (supports /api/jobs/:id and /api/status/:id)
    const jobMatch = pathname.match(/^\/api\/(?:jobs|status)\/([a-zA-Z0-9_-]+)$/);
    if (jobMatch && req.method === "GET") {
      const jobId = jobMatch[1];
      const status = getJobStatus(jobId);
      if (!status) return sendJson({ error: "Job tidak ditemukan" }, 404);
      return sendJson({ job_id: jobId, ...status });
    }

    // 9. Download job markdown
    const jobMdMatch = pathname.match(/^\/api\/(?:jobs|status)\/([a-zA-Z0-9_-]+)\/download-md$/);
    if (jobMdMatch && req.method === "GET") {
      const jobId = jobMdMatch[1];
      const mdPath = path.join(PATHS.transcriptsMdDir, `${jobId}.md`);
      if (!fs.existsSync(mdPath)) {
        return sendJson({ error: "Markdown tidak ditemukan" }, 404);
      }
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="transcript-${jobId}.md"`,
      });
      return fs.createReadStream(mdPath).pipe(res);
    }

    // 10. AI Paraphrase
    if (pathname === "/api/paraphrase" && req.method === "POST") {
      const body = await readJsonBody();
      const text = (body.text || "").trim();
      const style = (body.style || "").trim();
      const id = body.id ? parseInt(String(body.id), 10) : null;
      if (!text) return sendJson({ error: "Teks kosong" }, 400);

      try {
        const result = await callAiParaphrase(text, style);

        // If id provided, update DB and markdown file if exists
        if (id) {
          await updateTranscriptParaphrase(id, {
            finalText: result.markdown || result.text,
            aiSummary: result.summary,
            directedTopics: result.directed_topics,
            aiData: result,
          });
          const row = await getTranscriptById(id);
          if (row && row.md_path && fs.existsSync(row.md_path)) {
            try {
              fs.writeFileSync(row.md_path, result.markdown || result.text, "utf-8");
            } catch (err) {
              console.warn(`[Paraphrase] Gagal update file markdown ${row.md_path}:`, err);
            }
          }
        }

        return sendJson({
          text: result.text,
          markdown: result.markdown || result.text,
          markdown_text: result.markdown || result.text,
          final_text: result.markdown || result.text,
          summary: result.summary,
          ai_summary: result.summary,
          directed_topics: result.directed_topics,
          ai_data: result,
          ai_correction_status: "paraphrased",
        });
      } catch (err: any) {
        return sendJson({ error: err.message }, 500);
      }
    }

    // 11. Upload and Transcribe (supports /api/upload-and-transcribe, /api/transcribe, and /api/upload)
    if ((pathname === "/api/upload-and-transcribe" || pathname === "/api/transcribe" || pathname === "/api/upload") && req.method === "POST") {
      ensureKnowledgeFiles();

      const responseWrapper = new Response(req as any, {
        headers: req.headers as any,
      });

      const formData = await responseWrapper.formData();
      const audioFile = formData.get("audioFile") || formData.get("file") || formData.get("audio");

      if (!audioFile || !(audioFile instanceof File)) {
        return sendJson({ error: "Tidak ada file audio yang diunggah. Gunakan field 'audioFile' atau 'file'." }, 400);
      }

      const filename = audioFile.name || "audio.wav";
      const ext = filename.split(".").pop()?.toLowerCase() || "";

      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return sendJson({ error: `Format tidak didukung: .${ext}. Gunakan: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}` }, 400);
      }

      const wordTimestamps = formData.get("word_timestamps") === "true";
      const aiCorrection = formData.get("ai_correction") === "true";
      const outputFormat = formData.get("output_format") === "md" ? "md" : "json";
      const combo = String(formData.get("combo") || "1");
      const paraphraseStyle = String(formData.get("paraphrase_style") || config.aiParaphraseStyle || "poin_singkat");

      const jobId = crypto.randomUUID().replace(/-/g, "");
      const savePath = path.join(PATHS.uploadDir, `${jobId}.${ext}`);

      // Save uploaded file
      const buffer = await audioFile.arrayBuffer();
      await Bun.write(savePath, buffer);

      // Start transcription asynchronously in background
      startTranscriptionWorker(jobId, savePath, filename, wordTimestamps, aiCorrection, outputFormat, combo, paraphraseStyle);

      return sendJson({
        job_id: jobId,
        filename,
        status: "processing",
        combo,
        word_timestamps: wordTimestamps,
        ai_correction: aiCorrection,
        output_format: outputFormat,
      });
    }

    // 404 for unknown routes
    sendJson({ error: "Endpoint tidak ditemukan" }, 404);
  } catch (err: any) {
    console.error("[Server Error]", err);
    sendJson({ error: err.message || "Internal Server Error" }, 500);
  }
});

// Attach Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  socket.on("join_job", (data: { job_id: string }) => {
    const jobId = data?.job_id;
    if (jobId) {
      socket.join(jobId);
      const job = getJobStatus(jobId);
      if (job) {
        if (job.progress) {
          socket.emit("progress", { job_id: jobId, ...job.progress });
        }
        socket.emit("job_status", { job_id: jobId, ...job });
      }
    }
  });
});

// Worker to run transcription jobs
async function startTranscriptionWorker(
  jobId: string,
  savePath: string,
  originalFilename: string,
  wordTimestamps: boolean,
  aiCorrection: boolean,
  outputFormat: string,
  combo = "1",
  paraphraseStyle = config.aiParaphraseStyle || "poin_singkat"
) {
  let processedPath: string | null = null;
  const queuedAt = Date.now();

  const comboLabels: Record<string, string> = {
    "1": "Model 1: Fast-Whisper + Silero VAD (ggml-large-v3-turbo.bin)",
    "2": "Model 2: Faster-Whisper Turbo (faster-whisper-large-v3-turbo)",
  };

  const styleInfo = resolveParaphraseStyle(paraphraseStyle);

  setJobStatus(jobId, "processing", { queued_at: new Date().toISOString(), combo, paraphraseStyle: styleInfo.key });
  emitJobProgress(jobId, 1, `Memulai pemrosesan (${comboLabels[combo] || "Model " + combo})...`);

  try {
    setJobStatus(jobId, "preflight");
    const preflight = await runPreflight(false);
    if (!preflight.ffmpeg || !preflight.whisper_model) {
      throw new Error(`Preflight check gagal: ffmpeg=${preflight.ffmpeg}, model=${preflight.whisper_model}`);
    }

    // Check cache (keyed with combo and paraphrase style)
    const fileHash = calculateFileHash(savePath);
    const cacheKey = `${getCacheKey(fileHash, wordTimestamps, aiCorrection)}:combo=${combo}:style=${styleInfo.key}`;
    const cached = readCache(cacheKey);

    if (cached) {
      console.log(`[Job ${jobId}] Cache HIT!`);
      const mdPath = outputFormat === "md"
        ? renderMarkdown(jobId, originalFilename, cached.duration_s, cached.final_text, cached.ai_data, cached.ai_correction_status || "skipped")
        : null;

      const newId = await saveTranscript({
        filename: originalFilename,
        finalText: cached.final_text,
        durationS: cached.duration_s,
        generationTimeS: 0.1,
        wordTimestamps: cached.word_timestamps,
        rawText: cached.raw_text,
        aiText: cached.ai_corrected_text,
        aiSummary: cached.ai_summary,
        mdPath,
        aiStatus: cached.ai_correction_status || "skipped",
        directedTopics: cached.directed_topics || cached.ai_data?.directed_topics,
        aiData: cached.ai_data,
      });

      const mdUrl = mdPath ? `/api/jobs/${jobId}/download-md` : null;
      io.to(jobId).emit("done", {
        job_id: jobId,
        id: newId,
        filename: originalFilename,
        ...cached,
        generation_time_s: 0.1,
        summary: cached.ai_summary || cached.summary || null,
        ai_summary: cached.ai_summary || cached.summary || null,
        directed_topics: cached.directed_topics || cached.ai_data?.directed_topics || [],
        combo,
        created_at: new Date().toISOString(),
        cache_hit: true,
        md_url: mdUrl,
      });

      setJobStatus(jobId, "completed", { cache_hit: true, md_url: mdUrl, combo });
      return;
    }

    // 1. Audio Preprocessing with Selected Model (Pydub/Scipy/DeepFilter/NoiseReduce/VAD)
    emitJobProgress(jobId, 2, `Preprocessing audio (${comboLabels[combo] || "Model " + combo})...`);

    const { outputPath, durationS } = await convertWithFfmpeg(savePath, combo, 16000, (pct, stage) => {
      emitJobProgress(jobId, pct, stage);
    });
    processedPath = outputPath;

    // 2. STT Transcription with Realtime Live Progress
    setJobStatus(jobId, "transcribing");
    const whisperResult = await transcribeWithProgress(
      processedPath,
      durationS,
      wordTimestamps,
      combo,
      (percent, stage, currentText) => {
        emitJobProgress(
          jobId,
          percent,
          stage,
          Math.round((durationS * percent) / 100),
          currentText || ""
        );
      }
    );

    let finalText = whisperResult.finalText;
    let aiData: any = null;
    let aiStatus: "completed" | "skipped" | "failed" = "skipped";

    // 3. AI Correction & Jev-ultrafast Goal-Directed Topics Analysis with Paraphrase Style
    if (aiCorrection) {
      setJobStatus(jobId, "correcting");
      emitJobProgress(
        jobId,
        95,
        `Menganalisis topik terarah & parafrase AI (${styleInfo.name})...`,
        Math.round(durationS)
      );

      const aiRes = await callAiCorrection(whisperResult.rawText, originalFilename, durationS, paraphraseStyle);
      aiData = aiRes.data;
      aiStatus = aiRes.status;

      if (aiData) {
        finalText = aiData.markdown || aiData.corrected_text || finalText;
        // 4. Update knowledge base
        setJobStatus(jobId, "updating_knowledge");
        updateKnowledge(jobId, aiData);
      }
    }

    // 5. Generate Markdown
    let mdPath: string | null = null;
    if (outputFormat === "md") {
      setJobStatus(jobId, "generating_markdown");
      mdPath = renderMarkdown(jobId, originalFilename, durationS, finalText, aiData, aiStatus);
    }
    const mdUrl = mdPath ? `/api/jobs/${jobId}/download-md` : null;

    // 6. Save payload and cache
    const payload = {
      final_text: finalText,
      markdown_text: aiData?.markdown || finalText,
      duration_s: Math.round(durationS * 100) / 100,
      word_timestamps: whisperResult.wordTimestamps || null,
      raw_text: whisperResult.rawText,
      ai_corrected_text: aiStatus === "completed" ? finalText : null,
      ai_summary: aiData?.summary || null,
      ai_correction_status: aiStatus,
      ai_data: aiData,
      directed_topics: aiData?.directed_topics || [],
    };

    if (aiStatus !== "failed") {
      writeCache(cacheKey, payload);
    }

    const generationTimeS = Math.round(((Date.now() - queuedAt) / 1000) * 10) / 10;

    // 7. Save to Database (Drizzle ORM)
    const newId = await saveTranscript({
      filename: originalFilename,
      finalText,
      durationS,
      generationTimeS,
      wordTimestamps: whisperResult.wordTimestamps,
      rawText: whisperResult.rawText,
      aiText: payload.ai_corrected_text,
      aiSummary: payload.ai_summary,
      mdPath,
      aiStatus,
      directedTopics: payload.directed_topics,
      aiData: payload.ai_data,
    });

    // 8. Emit Done event
    io.to(jobId).emit("done", {
      job_id: jobId,
      id: newId,
      filename: originalFilename,
      ...payload,
      generation_time_s: generationTimeS,
      summary: aiData?.summary || null,
      ai_summary: aiData?.summary || null,
      directed_topics: aiData?.directed_topics || [],
      combo,
      created_at: new Date().toISOString(),
      cache_hit: false,
      md_url: mdUrl,
    });

    setJobStatus(jobId, "completed", { cache_hit: false, md_url: mdUrl });
    console.log(`[Job ${jobId}] Selesai dalam ${((Date.now() - queuedAt) / 1000).toFixed(2)}s.`);
  } catch (err: any) {
    console.error(`[Job ${jobId}] Gagal:`, err);
    setJobStatus(jobId, "failed", { error: err.message });
    io.to(jobId).emit("error", {
      job_id: jobId,
      message: err.message || "Gagal memproses audio.",
    });
  } finally {
    // Cleanup temporary audio files
    for (const p of [savePath, processedPath]) {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  }
}

// Start application
async function bootstrap() {
  console.log("-----------------------------------------");
  console.log("Resmeet-STT Backend: Bun.js + TypeScript");
  console.log("STT Engine: whisper.cpp");
  console.log("Model: " + config.whisperModel);
  console.log("AI Model: " + config.aiModelId + " (" + config.aiBaseUrl + ")");
  console.log("Storage DB: " + (config.dbType || "sqlite").toUpperCase() + (config.dbType === "sqlite" ? ` (${PATHS.sqliteFile})` : ` (${config.dbHost}:${config.dbPort}/${config.dbName})`));
  console.log("Port: " + config.port);
  console.log("-----------------------------------------");

  await initDb();
  ensureKnowledgeFiles();

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`[Server] Berjalan pada http://0.0.0.0:${config.port}`);
  });
}

bootstrap().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
