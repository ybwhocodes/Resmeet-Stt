import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config, PATHS } from "./config";
import { postprocess, TranscriptionResult, Segment, WordTimestamp } from "./whisper";

export interface TovWorkerResult {
  whisperResult: TranscriptionResult;
  processedPath: string;
  durationS: number;
}

/**
 * Ensures the Tov worker binary is compiled and up-to-date.
 */
export async function ensureTovWorkerBinary(): Promise<string | null> {
  const binDir = path.join(PATHS.baseDir, "bin");
  const workerBin = path.join(binDir, "resmeet-worker");
  const workerSource = path.join(PATHS.baseDir, "src", "worker.tov");

  if (!fs.existsSync(workerSource)) {
    return null;
  }

  // If binary exists and is newer than source, use it
  if (fs.existsSync(workerBin)) {
    try {
      const binMtime = fs.statSync(workerBin).mtimeMs;
      const srcMtime = fs.statSync(workerSource).mtimeMs;
      if (binMtime >= srcMtime) {
        return workerBin;
      }
    } catch {}
  }

  // Build binary using tov build
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  console.log("[Tov Worker] Mengompilasi worker.tov ke native binary...");
  const tovPath = process.env.TOV_PATH || path.join(process.env.HOME || "", ".tov", "bin", "tov");
  const tovExe = fs.existsSync(tovPath) ? tovPath : "tov";

  const success = await new Promise<boolean>((resolve) => {
    const buildProc = spawn(tovExe, ["build", workerSource, "-o", workerBin], {
      env: {
        ...process.env,
        PATH: `${path.join(process.env.HOME || "", ".tov", "bin")}:${process.env.PATH}`,
      },
    });
    let buildStderr = "";
    buildProc.stderr.on("data", (d) => { buildStderr += d.toString(); });
    buildProc.on("close", (code) => {
      if (code === 0 && fs.existsSync(workerBin)) {
        console.log(`[Tov Worker] Kompilasi native binary sukses: ${workerBin}`);
        resolve(true);
      } else {
        console.warn(`[Tov Worker] Kompilasi gagal (code ${code}): ${buildStderr.slice(-300)}`);
        resolve(false);
      }
    });
    buildProc.on("error", (err) => {
      console.warn(`[Tov Worker] Gagal menjalankan tov build: ${err.message}`);
      resolve(false);
    });
  });

  return success ? workerBin : null;
}

/**
 * Runs the native Tov Worker for audio preprocessing, transcription, and validation.
 */
export async function runTovWorker(
  jobId: string,
  inputPath: string,
  combo: string,
  wordTimestamps: boolean,
  onProgress?: (percent: number, stage: string, currentText?: string) => void
): Promise<TovWorkerResult> {
  const workerBin = await ensureTovWorkerBinary();
  if (!workerBin) {
    throw new Error("Binary Tov Worker tidak tersedia");
  }

  const outputPrefix = inputPath.replace(/\.[^/.]+$/, "") + "_tov_out";
  const scriptsDir = path.join(PATHS.baseDir, "src", "scripts");
  const modelDir = config.modelDir;

  const args = [
    "--job-id", jobId,
    "--input", inputPath,
    "--output-prefix", outputPrefix,
    "--combo", combo,
    "--model-dir", modelDir,
    "--scripts-dir", scriptsDir,
  ];

  if (wordTimestamps) {
    args.push("--word-timestamps");
  }

  onProgress?.(2, "Menjalankan Tov Native Worker...", "");

  return new Promise<TovWorkerResult>((resolve, reject) => {
    const proc = spawn(workerBin, args, {
      env: {
        ...process.env,
        CPU_THREADS: String(Math.max(config.cpuThreads, 4)),
      },
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let completedPayload: { outputJson: string; audioPath: string } | null = null;
    let errorMessage: string | null = null;

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuffer += text;

      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            const data = JSON.parse(trimmed);
            if (data.type === "progress") {
              onProgress?.(data.percent || 0, data.stage || "", data.currentText || "");
            } else if (data.type === "completed") {
              completedPayload = {
                outputJson: data.outputJson,
                audioPath: data.audioPath,
              };
            } else if (data.type === "error") {
              errorMessage = data.message;
            }
          } catch {}
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Gagal mengeksekusi Tov Worker: ${err.message}`));
    });

    proc.on("close", async (code) => {
      if (code !== 0 || errorMessage) {
        return reject(new Error(errorMessage || `Tov Worker exit code ${code}: ${stderrBuffer.slice(-500)}`));
      }

      const jsonPath = completedPayload?.outputJson || `${outputPrefix}_validated.json`;
      const fallbackJson = `${outputPrefix}.json`;
      const targetJson = fs.existsSync(jsonPath) ? jsonPath : fallbackJson;

      if (!fs.existsSync(targetJson)) {
        return reject(new Error(`File transkripsi hasil Tov Worker (${targetJson}) tidak ditemukan`));
      }

      try {
        const content = JSON.parse(fs.readFileSync(targetJson, "utf-8"));
        const segments: Segment[] = [];
        const wordTsList: WordTimestamp[] = [];
        const textParts: string[] = [];

        const rawTranscription = content.transcription || [];
        for (const item of rawTranscription) {
          const segText = (item.text || "").trim();
          if (segText) {
            textParts.push(segText);
            const startMs = item.offsets?.from || 0;
            const endMs = item.offsets?.to || 0;
            segments.push({
              start: startMs / 1000,
              end: endMs / 1000,
              text: segText,
            });

            if (Array.isArray(item.tokens)) {
              for (const tok of item.tokens) {
                if (tok.text && tok.text.trim()) {
                  wordTsList.push({
                    word: tok.text.trim(),
                    start: (tok.timestamps?.from_ms || startMs) / 1000,
                    end: (tok.timestamps?.to_ms || endMs) / 1000,
                  });
                }
              }
            } else if (Array.isArray(item.words)) {
              for (const w of item.words) {
                if (w.word && w.word.trim()) {
                  wordTsList.push({
                    word: w.word.trim(),
                    start: (w.offsets?.from || startMs) / 1000,
                    end: (w.offsets?.to || endMs) / 1000,
                  });
                }
              }
            }
          }
        }

        const rawText = textParts.join(" ");
        const finalText = postprocess(rawText);

        const processedAudioPath = completedPayload?.audioPath || `${inputPath}_tov_combo${combo}.wav`;

        // Probe duration
        const durationS = await new Promise<number>((res) => {
          const probe = spawn("ffprobe", [
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            processedAudioPath,
          ]);
          let out = "";
          probe.stdout.on("data", (d) => { out += d.toString(); });
          probe.on("close", () => {
            const parsed = parseFloat(out.trim());
            res(Number.isFinite(parsed) ? parsed : 0);
          });
          probe.on("error", () => res(0));
        });

        // Cleanup temp json
        try { if (fs.existsSync(targetJson)) fs.unlinkSync(targetJson); } catch {}
        try { if (targetJson !== fallbackJson && fs.existsSync(fallbackJson)) fs.unlinkSync(fallbackJson); } catch {}

        onProgress?.(95, "Tov Worker selesai, teks tervalidasi");

        resolve({
          whisperResult: {
            rawText,
            finalText,
            durationS,
            segments,
            wordTimestamps: wordTimestamps && wordTsList.length > 0 ? wordTsList : undefined,
          },
          processedPath: processedAudioPath,
          durationS,
        });
      } catch (parseErr: any) {
        reject(new Error(`Gagal mem-parsing hasil Tov Worker: ${parseErr.message}`));
      }
    });
  });
}
