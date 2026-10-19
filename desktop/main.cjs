const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

let mainWindow = null;
let backendProcess = null;

const PORT = Number(process.env.PORT || 8200);
const IS_DEV = process.env.NODE_ENV === "development";

function getBundledDistDir() {
  const candidates = [
    path.join(__dirname, "dist"),
    path.join(process.resourcesPath || "", "dist"),
    path.join(process.resourcesPath || "", "app", "dist"),
    path.resolve(__dirname, "..", "frontend", "dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, "index.html"))) {
      return c;
    }
  }
  return null;
}

function checkBackendHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(port, maxWaitMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const isHealthy = await checkBackendHealth(port);
    if (isHealthy) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function startBackend() {
  // If backend is already running (e.g. from terminal or previous session), reuse it
  const alreadyRunning = await checkBackendHealth(PORT);
  if (alreadyRunning) {
    console.log(`[Desktop] Backend already running and healthy on port ${PORT}.`);
    return;
  }

  const rootDir = path.resolve(__dirname, "..");
  const isWin = process.platform === "win32";
  const binaryName = isWin ? "resmeet-backend.exe" : "resmeet-backend";

  // Writable user data folder for SQLite, uploads, and knowledge base
  const userDataDir = app.getPath("userData");
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
  } catch {}

  const distDir = getBundledDistDir();

  // Check potential locations for standalone binary
  const candidates = [
    path.join(process.resourcesPath || "", "bin", binaryName),
    path.join(__dirname, "bin", binaryName),
    path.join(rootDir, "desktop", "bin", binaryName),
    path.join(rootDir, "release", isWin ? "resmeet-win.exe" : "resmeet-mac"),
    path.join(rootDir, "release", isWin ? "resmeet-backend-win.exe" : "resmeet-backend-mac"),
  ];

  let executable = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      executable = c;
      try { fs.chmodSync(c, 0o755); } catch {}
      break;
    }
  }

  const env = {
    ...process.env,
    PORT: String(PORT),
    DB_TYPE: "sqlite",
    RESMEET_DATA_DIR: userDataDir,
    FRONTEND_DIST_DIR: distDir || "",
  };

  try {
    if (executable) {
      console.log(`[Desktop] Launching bundled standalone backend: ${executable}`);
      backendProcess = spawn(executable, [], {
        cwd: userDataDir,
        env,
        stdio: "pipe",
      });
    } else {
      console.log("[Desktop] Launching backend via Bun development runner...");
      const backendDir = path.join(rootDir, "backend");
      backendProcess = spawn("bun", ["run", "src/index.ts"], {
        cwd: backendDir,
        env,
        stdio: "pipe",
      });
    }

    backendProcess.stdout?.on("data", (data) => {
      console.log(`[Backend]: ${data.toString().trim()}`);
    });

    backendProcess.stderr?.on("data", (data) => {
      console.error(`[Backend Err]: ${data.toString().trim()}`);
    });

    backendProcess.on("exit", (code) => {
      console.log(`[Backend] exited with code ${code}`);
      backendProcess = null;
    });
  } catch (err) {
    console.warn("Could not launch backend automatically:", err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Resmeet STT - Enterprise Meeting Notetaker",
    backgroundColor: "#0c0e14",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (IS_DEV) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    // Show responsive dark splash screen while backend server initializes
    const splashHtml = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Resmeet STT</title>
  <style>
    body {
      margin: 0; background: #0c0e14; color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 100vh; user-select: none;
    }
    .card {
      background: #151821; border: 1px solid #1e2330; border-radius: 20px;
      padding: 36px 44px; text-align: center; max-width: 440px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.6);
    }
    .spinner {
      width: 44px; height: 44px; border: 3px solid rgba(99, 102, 241, 0.2);
      border-top-color: #6366f1; border-radius: 50%;
      animation: spin 0.8s linear infinite; margin: 0 auto 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { font-size: 20px; font-weight: 700; margin: 0 0 8px; color: #fff; }
    p { font-size: 13px; color: #94a3b8; margin: 0; line-height: 1.5; }
    .badge {
      display: inline-block; background: rgba(99, 102, 241, 0.15); color: #818cf8;
      font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 9999px;
      margin-bottom: 14px; letter-spacing: 0.5px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <div class="badge">RESMEET STT v1.0.0</div>
    <h2>Memulai Resmeet STT Engine...</h2>
    <p>Menyiapkan database lokal SQLite dan inisialisasi pipeline audio.</p>
  </div>
</body>
</html>`;

    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);

    waitForBackend(PORT, 25000).then((ready) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (ready) {
          mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
        } else {
          const distDir = getBundledDistDir();
          const fallbackDist = distDir ? path.join(distDir, "index.html") : "";
          if (fallbackDist && fs.existsSync(fallbackDist)) {
            mainWindow.loadFile(fallbackDist);
          } else {
            mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
          }
        }
      }
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!IS_DEV) {
    await startBackend();
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch {}
    backendProcess = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch {}
    backendProcess = null;
  }
});
