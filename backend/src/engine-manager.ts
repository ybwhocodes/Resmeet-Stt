import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config";
import { getWhisperModelPath, findWhisperCliBinary } from "./whisper";

export const PORTS = {
  WHISPER_SERVER: 8178,
  PREPROCESS_DAEMON: 8179,
};

let whisperServerProc: ChildProcess | null = null;
let preprocessDaemonProc: ChildProcess | null = null;
let isShuttingDown = false;

export async function isWhisperServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORTS.WHISPER_SERVER}/`, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    });
    // whisper-server returns 200 or 404 for root path when alive
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function isPreprocessDaemonHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORTS.PREPROCESS_DAEMON}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function findWhisperServerBinary(): string | null {
  const candidates = [
    "/opt/homebrew/bin/whisper-server",
    "/usr/local/bin/whisper-server",
    path.join(__dirname, "..", "bin", "whisper-server"),
    "whisper-server",
  ];
  for (const c of candidates) {
    if (c.startsWith("/")) {
      if (fs.existsSync(c)) return c;
    }
  }
  return "whisper-server";
}

export async function startPersistentEngines(): Promise<void> {
  // 1. Start Preprocessor Daemon
  if (!(await isPreprocessDaemonHealthy())) {
    const daemonScript = path.join(__dirname, "scripts", "preprocess_daemon.py");
    if (fs.existsSync(daemonScript)) {
      console.log("[EngineManager] Memulai Audio Preprocessor Daemon (Pydub + Scipy + NoiseReduce + Silero VAD)...");
      try {
        preprocessDaemonProc = spawn("python3", [daemonScript], {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            PREPROCESS_PORT: String(PORTS.PREPROCESS_DAEMON),
          },
        });

        preprocessDaemonProc.stderr?.on("data", (d) => {
          const s = d.toString().trim();
          if (s) console.log(`[PreprocessDaemon] ${s}`);
        });

        preprocessDaemonProc.on("exit", (code) => {
          if (!isShuttingDown) {
            console.warn(`[EngineManager] PreprocessDaemon keluar dengan kode ${code}`);
          }
        });
      } catch (err: any) {
        console.warn(`[EngineManager] Gagal start PreprocessDaemon: ${err.message}`);
      }
    }
  }

  // 2. Start Persistent Whisper-Server with Beam Search and Metal GPU
  if (!(await isWhisperServerHealthy())) {
    const serverBinary = findWhisperServerBinary();
    let modelPath = "";
    try {
      modelPath = getWhisperModelPath();
    } catch (e: any) {
      console.warn(`[EngineManager] Tidak menemukan model whisper: ${e.message}`);
    }

    if (serverBinary && modelPath && fs.existsSync(modelPath)) {
      console.log(`[EngineManager] Memulai Persistent In-Memory Whisper Engine (${path.basename(modelPath)})...`);
      try {
        const args = [
          "-m", modelPath,
          "--host", "127.0.0.1",
          "--port", String(PORTS.WHISPER_SERVER),
          "-l", "id",
          "-bs", "4",               // Beam Search size 4 (Meetily accuracy standard)
          "-nth", "0.55",           // Balanced speech threshold (Meetily tuning)
          "-sns",                   // Suppress non-speech tokens (anti-hallucination)
          "-fa",                    // Flash Attention (Metal Apple Silicon)
          "-t", String(Math.max(config.cpuThreads, 4)),
        ];

        whisperServerProc = spawn(serverBinary, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });

        whisperServerProc.stderr?.on("data", (d) => {
          const s = d.toString().trim();
          // Filter out verbose internal metal compile messages
          if (s && !s.includes("ggml_metal_library_compile_all") && !s.includes("load_backend")) {
            if (s.includes("listening at") || s.includes("error") || s.includes("Running whisper")) {
              console.log(`[WhisperServer] ${s}`);
            }
          }
        });

        whisperServerProc.on("exit", (code) => {
          if (!isShuttingDown) {
            console.warn(`[EngineManager] WhisperServer keluar dengan kode ${code}`);
          }
        });
      } catch (err: any) {
        console.warn(`[EngineManager] Gagal start WhisperServer: ${err.message}`);
      }
    }
  }

  // Wait briefly for both to be ready (up to 5 seconds)
  const maxAttempts = 25;
  for (let i = 0; i < maxAttempts; i++) {
    const [pReady, wReady] = await Promise.all([
      isPreprocessDaemonHealthy(),
      isWhisperServerHealthy(),
    ]);
    if (pReady && wReady) {
      console.log("[EngineManager] ✓ Seluruh persistent engine (Preprocessor + Whisper Server) siap di RAM!");
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export function stopPersistentEngines(): void {
  isShuttingDown = true;
  if (preprocessDaemonProc) {
    try {
      preprocessDaemonProc.kill("SIGTERM");
    } catch {}
    preprocessDaemonProc = null;
  }
  if (whisperServerProc) {
    try {
      whisperServerProc.kill("SIGTERM");
    } catch {}
    whisperServerProc = null;
  }
}

// Cleanup on process exit
process.on("exit", stopPersistentEngines);
process.on("SIGINT", () => {
  stopPersistentEngines();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopPersistentEngines();
  process.exit(0);
});
