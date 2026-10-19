#!/usr/bin/env bash
# ==============================================================================
# Script Build Aplikasi Desktop Resmeet-STT (.DMG & .EXE)
# ==============================================================================

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
DESKTOP_DIR="$ROOT_DIR/desktop"
BACKEND_DIR="$ROOT_DIR/backend"
RELEASE_DIR="$ROOT_DIR/release"

mkdir -p "$RELEASE_DIR"

echo "=================================================="
echo "    BUILD APLIKASI DESKTOP RESMEET-STT"
echo "=================================================="

# 1. Build Frontend Static Assets
echo -e "\n[1/3] Membangun Frontend (Vite Build)..."
(cd "$FRONTEND_DIR" && npm run build)

# 2. Compile Standalone Bun Binary (Lokal Mandiri dengan SQLite)
echo -e "\n[2/3] Mengompilasi Binary Standalone Bun Server..."
mkdir -p "$DESKTOP_DIR/bin"

if command -v bun >/dev/null 2>&1; then
  echo "Mengompilasi binary macOS (arm64)..."
  bun build --compile --minify "$BACKEND_DIR/src/index.ts" --outfile "$RELEASE_DIR/resmeet-mac" || true
  cp -f "$RELEASE_DIR/resmeet-mac" "$DESKTOP_DIR/bin/resmeet-backend" 2>/dev/null || true
  chmod +x "$DESKTOP_DIR/bin/resmeet-backend" 2>/dev/null || true
  
  echo "Mengompilasi binary Windows (x64 exe)..."
  bun build --compile --minify --target=bun-windows-x64 "$BACKEND_DIR/src/index.ts" --outfile "$RELEASE_DIR/resmeet-win.exe" || true
  cp -f "$RELEASE_DIR/resmeet-win.exe" "$DESKTOP_DIR/bin/resmeet-backend.exe" 2>/dev/null || true
fi

# 3. Build Electron DMG / EXE Installer
echo -e "\n[3/3] Menyiapkan Paket Installer Desktop..."
if [ -d "$DESKTOP_DIR" ]; then
  cd "$DESKTOP_DIR"
  if [ ! -d "node_modules" ]; then
    echo "Menginstall dependensi desktop packaging..."
    npm install --silent
  fi

  echo "Membangun installer macOS (.DMG)..."
  npx electron-builder --mac dmg --publish never || true

  echo "Membangun installer Windows (.EXE)..."
  npx electron-builder --win portable nsis --publish never || true
fi

echo -e "\n=================================================="
echo "   BUILD SELESAI! Hasil tersedia di folder: release/"
echo "=================================================="
ls -lh "$RELEASE_DIR"
