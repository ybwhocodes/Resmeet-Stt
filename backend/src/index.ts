import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Server } from "socket.io";
import { config, PATHS, updateAiSettings } from "./config";
import { initDb, checkDbConnection, saveTranscript, getRecentTranscripts, getTranscriptById, deleteTranscript, updateTranscriptParaphrase } from "./db";
import { ensureKnowledgeFiles, updateKnowledge } from "./knowledge";
import { calculateFileHash, getCacheKey, readCache, writeCache } from "./cache";
import { convertWithFfmpeg, transcribeWithProgress, getWhisperModelPath, findWhisperCliBinary } from "./whisper";
import { callAiCorrection, callAiParaphrase, isAiConfigured, testAiConnection } from "./ai";
import { renderMarkdown } from "./markdown";

const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "webm", "mp4", "mpeg", "mpg", "m4v", "aac"]);

interface JobStatus {
  status: string;
  queued_at?: string;
  started_at?: string;
  error?: string;
  cache_hit?: boolean;
  md_url?: string | null;
  [key: string]: any;
}

const JOB_STATUS: Record<string, JobStatus> = {};

function setJobStatus(jobId: string, status: string, extra: Record<string, any> = {}) {
  JOB_STATUS[jobId] = { ...(JOB_STATUS[jobId] || {}), status, ...extra };
}

function getJobStatus(jobId: string): JobStatus | undefined {
  return JOB_STATUS[jobId];
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
    ai_config: !requireAi || isAiConfigured(),
  };

  return checks;
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

    // 3. Settings - GET current AI configuration
    if (pathname === "/api/settings" && req.method === "GET") {
      return sendJson({
        baseUrl: config.aiBaseUrl,
        apiKey: config.aiApiKey,
        modelId: config.aiModelId,
        paraphraseStyle: config.aiParaphraseStyle,
        isConfigured: isAiConfigured(),
        whisperModel: config.whisperModel,
      });
    }

    // 4. Settings - POST update AI configuration
    if (pathname === "/api/settings" && (req.method === "POST" || req.method === "PUT")) {
      const body = await readJsonBody();
      updateAiSettings({
        baseUrl: body.baseUrl || body.url,
        apiKey: body.apiKey || body.api_key,
        modelId: body.modelId || body.model || body.model_id,
        paraphraseStyle: body.paraphraseStyle || body.aiParaphraseStyle,
      });
      return sendJson({
        success: true,
        message: "Pengaturan model AI dan gaya parafrase berhasil diperbarui.",
        settings: {
          baseUrl: config.aiBaseUrl,
          apiKey: config.aiApiKey ? `${config.aiApiKey.slice(0, 4)}...${config.aiApiKey.slice(-4)}` : "",
          modelId: config.aiModelId,
          paraphraseStyle: config.aiParaphraseStyle,
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

    // 9. Job status
    const jobMatch = pathname.match(/^\/api\/jobs\/([a-zA-Z0-9_-]+)$/);
    if (jobMatch && req.method === "GET") {
      const jobId = jobMatch[1];
      const status = getJobStatus(jobId);
      if (!status) return sendJson({ error: "Job tidak ditemukan" }, 404);
      return sendJson({ job_id: jobId, ...status });
    }

    // 9. Download job markdown
    const jobMdMatch = pathname.match(/^\/api\/jobs\/([a-zA-Z0-9_-]+)\/download-md$/);
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

    // 11. Upload and Transcribe
    if (pathname === "/api/upload-and-transcribe" && req.method === "POST") {
      ensureKnowledgeFiles();

      const responseWrapper = new Response(req as any, {
        headers: req.headers as any,
      });

      const formData = await responseWrapper.formData();
      const audioFile = formData.get("audioFile");

      if (!audioFile || !(audioFile instanceof File)) {
        return sendJson({ error: "Tidak ada file audio yang diunggah." }, 400);
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

      const jobId = crypto.randomUUID().replace(/-/g, "");
      const savePath = path.join(PATHS.uploadDir, `${jobId}.${ext}`);

      // Save uploaded file
      const buffer = await audioFile.arrayBuffer();
      await Bun.write(savePath, buffer);

      // Start transcription asynchronously in background
      startTranscriptionWorker(jobId, savePath, filename, wordTimestamps, aiCorrection, outputFormat, combo);

      return sendJson({
        job_id: jobId,
        filename,
        status: "queued",
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
      const status = getJobStatus(jobId);
      if (status) {
        socket.emit("job_status", { job_id: jobId, ...status });
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
  combo = "1"
) {
  let processedPath: string | null = null;
  const queuedAt = Date.now();

  const comboLabels: Record<string, string> = {
    "1": "Combo 1 (DeepFilter-Net+, NoiseReduce, VAD + Fast-Whisper Turbo)",
    "2": "Combo 2 (DeepFilter-Net+, NoiseReduce, ggml-base + VAD + Fast-Whisper)",
    "3": "Combo 3 (DeepFilter-Net, NoiseReduce, Silero-VAD & Sherpa-ONNX)",
  };

  setJobStatus(jobId, "queued", { queued_at: new Date().toISOString(), combo });
  io.to(jobId).emit("progress", {
    job_id: jobId,
    percent: 0,
    elapsed_s: 0,
    current_text: "",
    stage: `Queued (${comboLabels[combo] || "Combo " + combo})`,
  });

  try {
    setJobStatus(jobId, "preflight");
    const preflight = await runPreflight(false);
    if (!preflight.ffmpeg || !preflight.whisper_model) {
      throw new Error(`Preflight check gagal: ffmpeg=${preflight.ffmpeg}, model=${preflight.whisper_model}`);
    }

    // Check cache
    const fileHash = calculateFileHash(savePath);
    const cacheKey = `${getCacheKey(fileHash, wordTimestamps, aiCorrection)}:combo=${combo}`;
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
        combo,
        created_at: new Date().toISOString(),
        cache_hit: true,
        md_url: mdUrl,
      });

      setJobStatus(jobId, "completed", { cache_hit: true, md_url: mdUrl, combo });
      return;
    }

    // 1. Audio Preprocessing with Selected Combo
    io.to(jobId).emit("progress", {
      job_id: jobId,
      percent: 2,
      elapsed_s: 0,
      current_text: "",
      stage: `Preprocessing audio (${comboLabels[combo] || "Combo " + combo})...`,
    });

    const { outputPath, durationS } = await convertWithFfmpeg(savePath, combo);
    processedPath = outputPath;

    // 2. STT Transcription with Selected Combo
    setJobStatus(jobId, "transcribing");
    const whisperResult = await transcribeWithProgress(
      processedPath,
      durationS,
      wordTimestamps,
      combo,
      (percent, stage, currentText) => {
        io.to(jobId).emit("progress", {
          job_id: jobId,
          percent,
          elapsed_s: Math.round((durationS * percent) / 100),
          current_text: currentText || "",
          stage,
        });
      }
    );

    let finalText = whisperResult.finalText;
    let aiData: any = null;
    let aiStatus: "completed" | "skipped" | "failed" = "skipped";

    // 3. AI Correction & Jev-ultrafast Goal-Directed Topics Analysis
    if (aiCorrection) {
      setJobStatus(jobId, "correcting");
      io.to(jobId).emit("progress", {
        job_id: jobId,
        percent: 96,
        elapsed_s: Math.round(durationS),
        current_text: "",
        stage: "Menganalisis topik terarah & koreksi AI...",
      });

      const aiRes = await callAiCorrection(whisperResult.rawText, originalFilename, durationS);
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
      directed_topics: aiData?.directed_topics || null,
    };

    if (aiStatus !== "failed") {
      writeCache(cacheKey, payload);
    }

    // 7. Save to Database
    const newId = await saveTranscript({
      filename: originalFilename,
      finalText,
      durationS,
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
