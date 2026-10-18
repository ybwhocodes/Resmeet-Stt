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
  targetSr = 16000
): Promise<{ outputPath: string; durationS: number }> {
  const intermediatePath = inputPath.replace(/\.[^/.]+$/, "") + "_raw.wav";
  const outputPath = inputPath.replace(/\.[^/.]+$/, "") + `_combo${combo}.wav`;

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

  // Step 2: Apply Combo-specific audio preprocessing (DeepFilter-Net, NoiseReduce, Silero-VAD)
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
        py.on("close", (code) => {
          if (code === 0 && fs.existsSync(outputPath)) {
            try { fs.unlinkSync(intermediatePath); } catch {}
            resolve();
          } else {
            // Fallback to intermediate if python filter had an issue
            fs.copyFileSync(intermediatePath, outputPath);
            try { fs.unlinkSync(intermediatePath); } catch {}
            resolve();
          }
        });
        py.on("error", () => {
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

export function getWhisperModelPath(combo = "1"): string {
  const modelDir = config.modelDir;

  // Combo 2 specifically requests ggml-base.bin
  if (combo === "2") {
    const basePath = path.join(modelDir, "ggml-base.bin");
    if (fs.existsSync(basePath)) return basePath;
  }

  const requested = config.whisperModel;
  const candidates = [
    path.join(modelDir, `ggml-${requested}-q5_0.bin`),
    path.join(modelDir, `ggml-${requested}.bin`),
    path.join(modelDir, `${requested}.bin`),
    path.join(modelDir, requested),
    path.join(modelDir, "ggml-large-v3-turbo-q5_0.bin"),
    path.join(modelDir, "ggml-large-v3-turbo.bin"),
    path.join(modelDir, "ggml-base.bin"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }

  throw new Error(`Model GGML whisper.cpp tidak ditemukan di ${modelDir}. Harap download ggml-large-v3-turbo.bin atau ggml-base.bin`);
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
  const modelPath = getWhisperModelPath(combo);
  const cliBinary = findWhisperCliBinary();
  const outputPrefix = audioPath.replace(/\.[^/.]+$/, "") + "_out";
  const outputJsonPath = outputPrefix + ".json";

  const comboLabels: Record<string, string> = {
    "1": "Combo 1: DeepFilter-Net+, NoiseReduce, VAD + Fast-Whisper Turbo",
    "2": "Combo 2: DeepFilter-Net+, NoiseReduce, ggml-base + VAD + Fast-Whisper",
    "3": "Combo 3: DeepFilter-Net, NoiseReduce, Silero-VAD & Sherpa-ONNX",
  };

  onProgress?.(0, `Memulai ${comboLabels[combo] || "Transkripsi"}...`);

  // Import dynamic glossary terms for domain prompt injection
  const { getGlossaryPromptTerms } = await import("./knowledge");
  const glossaryTerms = getGlossaryPromptTerms();
  const initialPrompt = glossaryTerms
    ? `Transkripsi rapat resmi, notulen, agenda terarah, istilah: ${glossaryTerms}.`
    : "Transkripsi rapat resmi bahasa Indonesia, notulen, agenda, keputusan, dan tindak lanjut.";

  // Highly optimized parameters for Apple Silicon M1 (Greedy decoding, Flash Attention, 4 threads)
  const args = [
    "-m", modelPath,
    "-f", audioPath,
    "-l", "id",
    "-t", String(Math.max(config.cpuThreads, 4)),
    "-bs", "1",
    "-bo", "1",
    "--no-fallback",
    "-fa",
    "--prompt", initialPrompt,
    "-oj",
    "-of", outputPrefix,
    "-pp",
  ];

  if (wordTimestamps) {
    args.push("-wt", "0.01");
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cliBinary, args);

    let stderr = "";
    let lastPercent = 0;

    const parseOutput = (data: Buffer) => {
      const text = data.toString();
      stderr += text;

      // Match timestamp lines like: [00:01:23.000 --> 00:01:30.000] text
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

          let pct = totalDuration > 0 ? (currentAudioSec / totalDuration) * 95 : lastPercent + 5;
          pct = Math.min(Math.max(pct, lastPercent), 95);
          lastPercent = pct;

          onProgress?.(Math.round(pct * 10) / 10, `Memproses audio (${Math.round(pct)}%)`, segText);
        }
      }

      // Check progress percentage if printed directly (e.g. "whisper_print_progress: progress = 30%")
      const progMatch = text.match(/progress\s*=\s*(\d+)%/i);
      if (progMatch) {
        const pct = Math.min(parseInt(progMatch[1], 10), 95);
        if (pct > lastPercent) {
          lastPercent = pct;
          onProgress?.(pct, `Transcribing ${pct}%`);
        }
      }
    };

    proc.stdout.on("data", parseOutput);
    proc.stderr.on("data", parseOutput);

    proc.on("error", (err) => {
      reject(new Error(`Gagal menjalankan whisper-cli: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`whisper-cli exit code ${code}: ${stderr.slice(-1000)}`));
      }
    });
  });

  if (!fs.existsSync(outputJsonPath)) {
    throw new Error("whisper-cli tidak menghasilkan file JSON transkripsi.");
  }

  const jsonContent = JSON.parse(fs.readFileSync(outputJsonPath, "utf-8"));
  try {
    fs.unlinkSync(outputJsonPath);
  } catch {
    // Ignore cleanup error
  }

  const segments: Segment[] = [];
  const wordTsList: WordTimestamp[] = [];
  const textParts: string[] = [];

  const rawTranscription = jsonContent.transcription || [];
  for (const item of rawTranscription) {
    const text = (item.text || "").trim();
    if (text) {
      textParts.push(text);
      const startMs = item.offsets?.from || 0;
      const endMs = item.offsets?.to || 0;
      segments.push({
        start: startMs / 1000,
        end: endMs / 1000,
        text,
      });

      // Words if available in item tokens or words
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
      }
    }
  }

  const rawText = textParts.join(" ");
  const finalText = postprocess(rawText);

  onProgress?.(100, "Transkripsi Whisper selesai");

  return {
    rawText,
    finalText,
    durationS: totalDuration,
    segments,
    wordTimestamps: wordTimestamps && wordTsList.length > 0 ? wordTsList : undefined,
  };
}
