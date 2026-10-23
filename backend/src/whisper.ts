import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config, PATHS } from "./config";

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  rawText: string;
  finalText: string;
  durationS: number;
  segments: Segment[];
  wordTimestamps?: WordTimestamp[];
}

export function cleanText(text: string): string {
  let res = text.trim();
  res = res.replace(/\s+/g, " ");
  res = res.replace(/\s+([,.!?;:])/g, "$1");
  res = res.replace(/([,.!?;:])([^\s])/g, "$1 $2");
  res = res.replace(/([,.!?])\1+/g, "$1");
  res = res.replace(/\b(\w+)( \1\b)+/gi, "$1");
  return res;
}

export function addSentenceBreaks(text: string): string {
  let cleaned = cleanText(text);
  const conjunctions = [
    " kemudian ", " lalu ", " setelah itu ", " selanjutnya ",
    " jadi ", " namun ", " tetapi ", " karena ", " sehingga ",
  ];
  for (const c of conjunctions) {
    cleaned = cleaned.split(c).join(`. ${c.trim()} `);
  }
  return cleaned.replace(/\.\s*\./g, ".");
}

export function sentenceCase(text: string): string {
  const parts = addSentenceBreaks(text).split(/([.!?])/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = parts[i].trim();
    const p = i + 1 < parts.length ? parts[i + 1] : ".";
    if (s) {
      out.push(s.charAt(0).toUpperCase() + s.slice(1) + p);
    }
  }
  return out.join(" ").trim();
}

export function postprocess(text: string): string {
  return sentenceCase(cleanText(text));
}

export async function convertWithFfmpeg(
  inputPath: string,
  combo = "1",
  targetSr = 16000,
  onProgress?: (percent: number, stage: string) => void
): Promise<{ outputPath: string; durationS: number }> {
  const intermediatePath = inputPath.replace(/\.[^/.]+$/, "") + "_raw.wav";
  const outputPath = inputPath.replace(/\.[^/.]+$/, "") + `_combo${combo}.wav`;

  onProgress?.(2, "Standardisasi audio dengan FFmpeg (16kHz Mono)...");

  // Step 1: Standardize with FFmpeg (16kHz mono PCM)
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-threads", "4",
      "-i", inputPath,
      "-vn", "-sn", "-dn",
      "-ac", "1",
      "-ar", String(targetSr),
      "-c:a", "pcm_s16le",
      intermediatePath,
    ]);

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg gagal (code ${code}): ${stderr.slice(-500)}`));
    });
  });

  onProgress?.(4, "Normalisasi Loudness (Pydub/Scipy)...");

  let daemonSucceeded = false;
  try {
    const res = await fetch("http://127.0.0.1:8179/preprocess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input_path: intermediatePath,
        output_path: outputPath,
        combo,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const diag = await res.json();
      if (diag.success && fs.existsSync(outputPath)) {
        try { fs.unlinkSync(intermediatePath); } catch {}
        daemonSucceeded = true;
        onProgress?.(11, `Preprocessing audio selesai (${diag.processing_time_s}s, ${diag.vad_segment_count || 0} VAD segments).`);
      }
    }
  } catch {
    // Daemon not reachable, fallback to direct script
  }

  // Step 2: Fallback to Combo-specific audio preprocessing if daemon was unavailable
  if (!daemonSucceeded) {
    const scriptPath = path.join(__dirname, "scripts", "preprocess_combo.py");
    if (fs.existsSync(scriptPath)) {
      try {
        await new Promise<void>((resolve) => {
          const py = spawn("python3", [
            scriptPath,
            "--input", intermediatePath,
            "--output", outputPath,
            "--combo", combo,
          ]);

          let pyStdout = "";
          let pyStderr = "";
          py.stdout.on("data", (d: Buffer) => { pyStdout += d.toString(); });
          py.stderr.on("data", (d: Buffer) => {
            const text = d.toString();
            pyStderr += text;
            if (text.includes("Step 1")) {
              onProgress?.(5, "Bandpass Vocal & Normalisasi Loudness (Pydub/Scipy)...");
            } else if (text.includes("Step 2")) {
              onProgress?.(7, "Reduksi Noise (Spectral Gating NoiseReduce)...");
            } else if (text.includes("Step 3") || text.includes("Silero VAD")) {
              onProgress?.(9, "Deteksi Segmen Ucapan Aktif (Silero VAD)...");
            }
          });

          py.on("close", (code) => {
            // Parse and log diagnostics JSON from Python script
            try {
              const diagLine = pyStdout.trim().split("\n").find((l) => l.startsWith("{"));
              if (diagLine) {
                const diag = JSON.parse(diagLine);
                if (diag.warnings && diag.warnings.length > 0) {
                  console.warn(`[preprocess_combo] Combo ${combo} warnings:`, diag.warnings);
                }
                if (diag.vad_segments !== undefined) {
                  console.log(`[preprocess_combo] Combo ${combo}: ${diag.vad_segments} VAD segments, duration=${diag.duration_s?.toFixed(2)}s`);
                }
              }
            } catch {
              // Ignore JSON parse errors from diagnostics
            }

            if (code === 0 && fs.existsSync(outputPath)) {
              try { fs.unlinkSync(intermediatePath); } catch {}
              onProgress?.(11, "Preprocessing audio selesai.");
              resolve();
            } else {
              // Log error details for debugging
              if (pyStderr) {
                console.error(`[preprocess_combo] Combo ${combo} stderr (last 500 chars):`, pyStderr.slice(-500));
              }
              // Fallback to intermediate if python filter had an issue
              fs.copyFileSync(intermediatePath, outputPath);
              try { fs.unlinkSync(intermediatePath); } catch {}
              resolve();
            }
          });
          py.on("error", (err: Error) => {
            console.error(`[preprocess_combo] Failed to spawn python3: ${err.message}`);
            fs.copyFileSync(intermediatePath, outputPath);
            try { fs.unlinkSync(intermediatePath); } catch {}
            resolve();
          });
        });
      } catch {
        fs.copyFileSync(intermediatePath, outputPath);
      }
    } else {
      fs.copyFileSync(intermediatePath, outputPath);
    }
  }

  const durationS = await new Promise<number>((resolve) => {
    const probe = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      outputPath,
    ]);
    let out = "";
    probe.stdout.on("data", (d) => { out += d.toString(); });
    probe.on("close", () => {
      const parsed = parseFloat(out.trim());
      resolve(Number.isFinite(parsed) ? parsed : 0);
    });
    probe.on("error", () => resolve(0));
  });

  return { outputPath, durationS };
}

export function getWhisperModelPath(): string {
  const modelDir = config.modelDir;
  const candidates = [
    path.join(modelDir, "ggml-large-v3-turbo-q5_0.bin"),
    path.join(modelDir, "ggml-large-v3-turbo.bin"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }

  throw new Error(`Model GGML whisper.cpp tidak ditemukan di ${modelDir}. Harap sediakan ggml-large-v3-turbo-q5_0.bin atau ggml-large-v3-turbo.bin`);
}

export function findWhisperCliBinary(): string {
  const potentialPaths = [
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
    "whisper-cli",
  ];
  for (const p of potentialPaths) {
    try {
      if (p.startsWith("/")) {
        if (fs.existsSync(p)) return p;
      }
    } catch {
      // Ignore
    }
  }
  return "whisper-cli";
}

export async function transcribeWithProgress(
  audioPath: string,
  totalDuration: number,
  wordTimestamps: boolean,
  combo = "1",
  onProgress?: (percent: number, stage: string, currentText?: string) => void
): Promise<TranscriptionResult> {
  const outputPrefix = audioPath.replace(/\.[^/.]+$/, "") + "_out";
  const outputJsonPath = outputPrefix + ".json";

  const comboLabels: Record<string, string> = {
    "1": "Model 1: Fast-Whisper + Silero VAD (ggml-large-v3-turbo.bin)",
    "2": "Model 2: Faster-Whisper Turbo (faster-whisper-large-v3-turbo)",
  };

  onProgress?.(12, `Inisialisasi Whisper Engine & Model (${combo === "2" ? "Faster-Whisper" : "Whisper C++"})...`);

  // Import dynamic glossary terms for domain prompt injection
  const { getGlossaryPromptTerms } = await import("./knowledge");
  const glossaryTerms = getGlossaryPromptTerms();
  const initialPrompt = glossaryTerms
    ? `Transkripsi rapat resmi, notulen, agenda terarah, istilah: ${glossaryTerms}.`
    : "Transkripsi rapat resmi bahasa Indonesia, notulen, agenda, keputusan, dan tindak lanjut.";

  // Model 1 (Whisper.cpp native C++ engine with ggml-large-v3-turbo)
  const modelPath = combo === "2" ? "" : getWhisperModelPath();
  const cliBinary = findWhisperCliBinary();

  const buildArgs = (extraTemp?: number): string[] => {
    const a = [
      "-m", modelPath,
      "-f", audioPath,
      "-l", "id",
      "-t", String(Math.max(config.cpuThreads, 4)),
      "-fa",                  // Flash Attention
      "-bs", "4",             // Beam Search size 4 (Meetily accuracy standard)
      "-nth", "0.55",         // Balanced speech threshold (Meetily tuning)
      "-sns",                 // Suppress non-speech tokens
      "-et", "2.4",           // entropy threshold
      "-lpt", "-1.0",         // logprob threshold
      "-tpi", "0.2",          // temperature increment for fallback
      "-mc", "64",            // context tokens
      "--prompt", initialPrompt,
      "-oj",
      "-of", outputPrefix,
      "-pp",
    ];
    if (extraTemp !== undefined) {
      a.push("-tp", String(extraTemp));
    }
    if (wordTimestamps) {
      a.push("-wt", "0.01");
    }
    return a;
  };

  const runTranscriptionEngine = async (extraTemp?: number): Promise<string> => {
    if (combo === "1") {
      // First attempt: Persistent In-Memory Whisper Server (0ms model loading, Beam Search 4)
      try {
        const ping = await fetch("http://127.0.0.1:8178/", { signal: AbortSignal.timeout(600) });
        if (ping.status < 500) {
          onProgress?.(30, "Mentranskripsi dengan Persistent Whisper Server (Beam Search 4)...");
          const form = new FormData();
          const fileBuf = fs.readFileSync(audioPath);
          form.append("file", new Blob([fileBuf]), path.basename(audioPath));
          form.append("response_format", "verbose_json");
          form.append("language", "id");
          if (initialPrompt) form.append("prompt", initialPrompt);
          if (extraTemp !== undefined) form.append("temperature", String(extraTemp));

          const res = await fetch("http://127.0.0.1:8178/inference", {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(180000),
          });

          if (res.ok) {
            const data = await res.json();
            fs.writeFileSync(outputJsonPath, JSON.stringify(data), "utf-8");
            onProgress?.(92, "Transkripsi selesai, memvalidasi Post-ASR...");
            return JSON.stringify(data);
          }
        }
      } catch (err: any) {
        console.warn(`[WhisperEngine] Whisper-Server tidak merespons, beralih ke whisper-cli: ${err.message}`);
      }
    }

    if (combo === "2") {
      // Model 2: Faster-Whisper Turbo (CTranslate2)
      const scriptPath = path.join(__dirname, "scripts", "transcribe_model2.py");
      const args = [
        scriptPath,
        "--audio", audioPath,
        "--output", outputPrefix,
        "--lang", "id",
      ];
      if (wordTimestamps) args.push("--word-timestamps");
      if (extraTemp !== undefined) args.push("--temperature", String(extraTemp));

      return new Promise<string>((resolve, reject) => {
        const proc = spawn("python3", args);
        let stderr = "";
        let lastPercent = 0;

        const parseOutput = (data: Buffer) => {
          const text = data.toString();
          stderr += text;

          const timeMatches = text.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)/g);
          if (timeMatches && timeMatches.length > 0) {
            const lastLine = timeMatches[timeMatches.length - 1];
            const m = lastLine.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)/);
            if (m) {
              const hours = parseInt(m[5], 10);
              const mins = parseInt(m[6], 10);
              const secs = parseInt(m[7], 10);
              const currentAudioSec = hours * 3600 + mins * 60 + secs;
              const segText = m[9]?.trim() || "";

              let pct = totalDuration > 0 ? 12 + (currentAudioSec / totalDuration) * 82 : lastPercent + 2;
              pct = Math.min(Math.max(pct, lastPercent), 94);
              lastPercent = pct;

              onProgress?.(Math.round(pct * 10) / 10, `Mentranskripsi (${Math.round(pct)}%)`, segText);
            }
          }
        };

        proc.stdout.on("data", parseOutput);
        proc.stderr.on("data", parseOutput);

        proc.on("error", (err) => {
          reject(new Error(`Gagal menjalankan Model 2 (faster-whisper): ${err.message}`));
        });

        proc.on("close", (code) => {
          if (code === 0) resolve(stderr);
          else reject(new Error(`Model 2 (faster-whisper) exit code ${code}: ${stderr.slice(-1000)}`));
        });
      });
    } else {
      // Fallback: whisper-cli native C++ with Beam Search
      return new Promise<string>((resolve, reject) => {
        const proc = spawn(cliBinary, buildArgs(extraTemp));
        let stderr = "";
        let lastPercent = 0;

        const parseOutput = (data: Buffer) => {
          const text = data.toString();
          stderr += text;

          const timeMatches = text.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)/g);
          if (timeMatches && timeMatches.length > 0) {
            const lastLine = timeMatches[timeMatches.length - 1];
            const m = lastLine.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)/);
            if (m) {
              const hours = parseInt(m[5], 10);
              const mins = parseInt(m[6], 10);
              const secs = parseInt(m[7], 10);
              const currentAudioSec = hours * 3600 + mins * 60 + secs;
              const segText = m[9]?.trim() || "";

              let pct = totalDuration > 0 ? 12 + (currentAudioSec / totalDuration) * 82 : lastPercent + 2;
              pct = Math.min(Math.max(pct, lastPercent), 94);
              lastPercent = pct;

              onProgress?.(Math.round(pct * 10) / 10, `Mentranskripsi (${Math.round(pct)}%)`, segText);
            }
          }

          const progMatch = text.match(/progress\s*=\s*(\d+)%/i);
          if (progMatch) {
            const whisperPct = parseInt(progMatch[1], 10);
            const pct = Math.min(12 + Math.round((whisperPct * 82) / 100), 94);
            if (pct > lastPercent) {
              lastPercent = pct;
              onProgress?.(pct, `Mentranskripsi (${pct}%)`);
            }
          }
        };

        proc.stdout.on("data", parseOutput);
        proc.stderr.on("data", parseOutput);

        proc.on("error", (err) => {
          reject(new Error(`Gagal menjalankan whisper-cli (Model 1): ${err.message}`));
        });

        proc.on("close", (code) => {
          if (code === 0) resolve(stderr);
          else reject(new Error(`whisper-cli exit code ${code}: ${stderr.slice(-1000)}`));
        });
      });
    }
  };

  // Run first pass
  await runTranscriptionEngine();

  if (!fs.existsSync(outputJsonPath)) {
    throw new Error(`Engine ${comboLabels[combo] || "transkripsi"} tidak menghasilkan file JSON.`);
  }

  // Post-ASR validation via validate_transcript.py
  const validateScriptPath = path.join(__dirname, "scripts", "validate_transcript.py");
  let validatedJsonPath = outputJsonPath;
  let validationStatus = "skipped";

  if (fs.existsSync(validateScriptPath)) {
    const validatedOutputPath = outputPrefix + "_validated.json";
    try {
      const validationResult = await new Promise<{ status: string; returncode: number }>((resolve) => {
        const vp = spawn("python3", [
          validateScriptPath,
          "--input", outputJsonPath,
          "--output", validatedOutputPath,
        ]);
        let vStdout = "";
        let vStderr = "";
        vp.stdout.on("data", (d: Buffer) => { vStdout += d.toString(); });
        vp.stderr.on("data", (d: Buffer) => { vStderr += d.toString(); });
        vp.on("close", (code) => {
          try {
            const result = JSON.parse(vStdout.trim().split("\n").find((l) => l.startsWith("{")) || "{}");
            resolve({ status: result.overall_status || "unknown", returncode: code || 0 });
          } catch {
            if (vStderr) console.warn("[validate_transcript] stderr:", vStderr.slice(-300));
            resolve({ status: "error", returncode: code || 99 });
          }
        });
        vp.on("error", (err: Error) => {
          console.warn(`[validate_transcript] Failed to spawn: ${err.message}`);
          resolve({ status: "error", returncode: 99 });
        });
      });

      validationStatus = validationResult.status;

      if (validationResult.status === "high_confidence_anomaly") {
        console.warn(`[whisper] high_confidence_anomaly detected — retrying with temperature=0.4`);
        onProgress?.(50, "Mendeteksi anomali — mencoba ulang dengan parameter berbeda...");

        try { fs.unlinkSync(outputJsonPath); } catch {}
        try { if (fs.existsSync(validatedOutputPath)) fs.unlinkSync(validatedOutputPath); } catch {}

        await runTranscriptionEngine(0.4);

        if (!fs.existsSync(outputJsonPath)) {
          throw new Error("whisper-cli retry tidak menghasilkan file JSON transkripsi.");
        }

        // Re-validate after retry
        const retryValidation = await new Promise<{ status: string }>((resolve) => {
          const vp2 = spawn("python3", [
            validateScriptPath,
            "--input", outputJsonPath,
            "--output", validatedOutputPath,
          ]);
          let vStdout2 = "";
          vp2.stdout.on("data", (d: Buffer) => { vStdout2 += d.toString(); });
          vp2.on("close", () => {
            try {
              const r = JSON.parse(vStdout2.trim().split("\n").find((l) => l.startsWith("{")) || "{}");
              resolve({ status: r.overall_status || "unknown" });
            } catch {
              resolve({ status: "unknown" });
            }
          });
          vp2.on("error", () => resolve({ status: "error" }));
        });
        validationStatus = retryValidation.status;
        console.log(`[whisper] Retry validation status: ${validationStatus}`);

      } else if (validationResult.status === "suspicious") {
        console.warn(`[whisper] Suspicious transcript detected (status=suspicious) — proceeding without retry`);
      }

      // Use validated output if it exists
      if (fs.existsSync(validatedOutputPath)) {
        validatedJsonPath = validatedOutputPath;
      }

    } catch (validErr) {
      console.warn(`[validate_transcript] Validation error (non-fatal): ${validErr}`);
    }
  }

  const jsonContent = JSON.parse(fs.readFileSync(validatedJsonPath, "utf-8"));
  // Cleanup
  try { if (validatedJsonPath !== outputJsonPath && fs.existsSync(outputJsonPath)) fs.unlinkSync(outputJsonPath); } catch {}
  try { fs.unlinkSync(validatedJsonPath); } catch {}

  const segments: Segment[] = [];
  const wordTsList: WordTimestamp[] = [];
  const textParts: string[] = [];

  const rawTranscription = jsonContent.transcription || jsonContent.segments || [];
  for (const item of rawTranscription) {
    const text = (item.text || "").trim();
    if (text) {
      textParts.push(text);
      const startMs = item.offsets?.from !== undefined ? item.offsets.from : (item.start !== undefined ? Math.round(item.start * 1000) : 0);
      const endMs = item.offsets?.to !== undefined ? item.offsets.to : (item.end !== undefined ? Math.round(item.end * 1000) : 0);
      segments.push({
        start: startMs / 1000,
        end: endMs / 1000,
        text,
      });

      // Words if available in item words or tokens
      if (Array.isArray(item.words)) {
        for (const w of item.words) {
          if (w.word && w.word.trim()) {
            wordTsList.push({
              word: w.word.trim(),
              start: w.start || 0,
              end: w.end || 0,
            });
          }
        }
      } else if (Array.isArray(item.tokens)) {
        for (const tok of item.tokens) {
          if (tok.text && tok.text.trim()) {
            wordTsList.push({
              word: tok.text.trim(),
              start: (tok.timestamps?.from_ms || startMs) / 1000,
              end: (tok.timestamps?.to_ms || endMs) / 1000,
            });
          }
        }
      }
    }
  }

  const rawText = textParts.join(" ");
  const finalText = postprocess(rawText);

  if (validationStatus !== "skipped") {
    console.log(`[whisper] Transcription complete. Validation status: ${validationStatus}`);
  }
  onProgress?.(100, "Transkripsi Whisper selesai");

  return {
    rawText,
    finalText,
    durationS: totalDuration,
    segments,
    wordTimestamps: wordTimestamps && wordTsList.length > 0 ? wordTsList : undefined,
  };
}
