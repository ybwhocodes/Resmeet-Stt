const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let mainWindow = null;
let backendProcess = null;

const PORT = process.env.PORT || 8200;
const IS_DEV = process.env.NODE_ENV === "development";

function startBackend() {
  const rootDir = path.resolve(__dirname, "..");
  const isWin = process.platform === "win32";
  const binaryName = isWin ? "resmeet-backend.exe" : "resmeet-backend";

  // Check potential locations for standalone binary
  const candidates = [
    path.join(process.resourcesPath || "", "bin", binaryName),
    path.join(__dirname, "bin", binaryName),
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
  };

  try {
    if (executable) {
      console.log(`[Desktop] Launching bundled standalone backend: ${executable}`);
      backendProcess = spawn(executable, [], {
        cwd: rootDir,
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
      console.log(`[Backend]: ${data.toString()}`);
    });

    backendProcess.stderr?.on("data", (data) => {
      console.error(`[Backend Err]: ${data.toString()}`);
    });

    backendProcess.on("exit", (code) => {
      console.log(`[Backend] exited with code ${code}`);
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
    // In production, load the built Vite HTML file or localhost server
    const distPath = path.resolve(__dirname, "..", "frontend", "dist", "index.html");
    mainWindow.loadFile(distPath).catch(() => {
      mainWindow.loadURL(`http://localhost:${PORT}`);
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

app.whenReady().then(() => {
  if (!IS_DEV) {
    startBackend();
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
  }
});
