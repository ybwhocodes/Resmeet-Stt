#!/usr/bin/env bash
# ==============================================================================
# Resmeet-STT: Unified 1-Click Startup Script (Manual / Native Runner)
# Menjalankan Database, Backend Bun.js, dan Frontend Vite secara bersamaan.
# ==============================================================================

set -e

# Warna Terminal
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo -e "${CYAN}==============================================================================${NC}"
echo -e "${CYAN}             RESMEET-STT: SISTEM NOTULEN & TRANSKRIPSI RAPAT                 ${NC}"
echo -e "${CYAN}   Bun.js • Whisper.cpp • Silero-VAD • Jev-Guided Topics • Markmap Mindmap    ${NC}"
echo -e "${CYAN}==============================================================================${NC}"

# 1. Cek Dependensi Dasar
echo -e "\n${YELLOW}[1/4] Memeriksa dependensi sistem...${NC}"

command -v bun >/dev/null 2>&1 || {
  echo -e "${RED}Error: Bun.js tidak ditemukan! Silakan install: curl -fsSL https://bun.sh/install | bash${NC}"
  exit 1
}

command -v ffmpeg >/dev/null 2>&1 || {
  echo -e "${RED}Error: FFmpeg tidak ditemukan! Silakan install via brew: brew install ffmpeg${NC}"
  exit 1
}

command -v node >/dev/null 2>&1 || {
  echo -e "${RED}Error: Node.js tidak ditemukan!${NC}"
  exit 1
}

echo -e "${GREEN}✓ Bun.js, Node.js, dan FFmpeg terverifikasi.${NC}"

# 2. Cek Driver Database (Default SQLite, Opsional MySQL / PostgreSQL)
echo -e "\n${YELLOW}[2/4] Memeriksa driver database...${NC}"
if nc -z 127.0.0.1 3307 2>/dev/null; then
  echo -e "${GREEN}✓ MySQL terdeteksi aktif pada port 3307.${NC}"
elif [ -f "$BACKEND_DIR/resmeet.sqlite" ] || [ ! -f "$BACKEND_DIR/settings.json" ]; then
  echo -e "${GREEN}✓ Menggunakan SQLite lokal mandiri (Zero-Setup: backend/resmeet.sqlite).${NC}"
elif command -v docker >/dev/null 2>&1; then
  echo -e "${YELLOW}Port 3307 belum aktif. Menjalankan container MySQL via Docker jika diperlukan...${NC}"
  if docker ps -a --format '{{.Names}}' | grep -Eq "^(mysql_db|resmeet_mysql)$"; then
    CONTAINER_NAME=$(docker ps -a --format '{{.Names}}' | grep -E "^(mysql_db|resmeet_mysql)$" | head -n 1)
    docker start "$CONTAINER_NAME" >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ Container $CONTAINER_NAME dijalankan.${NC}"
  fi
else
  echo -e "${GREEN}✓ Default SQLite aktif secara otomatis. Pengaturan MySQL/Postgres dapat diatur di UI Pengaturan.${NC}"
fi

# 3. Pastikan Dependensi Frontend & Backend Terinstall
echo -e "\n${YELLOW}[3/4] Menyiapkan dependensi package...${NC}"
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "Menginstall dependensi backend..."
  (cd "$BACKEND_DIR" && bun install)
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Menginstall dependensi frontend..."
  (cd "$FRONTEND_DIR" && npm install)
fi
echo -e "${GREEN}✓ Dependensi package siap.${NC}"

# 4. Jalankan Backend & Frontend
echo -e "\n${YELLOW}[4/4] Menjalankan Backend & Frontend...${NC}"

# Trap untuk membersihkan background proses saat script dihentikan (CTRL+C)
cleanup() {
  echo -e "\n${YELLOW}Menghentikan seluruh layanan Resmeet-STT...${NC}"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo -e "${GREEN}✓ Layanan dihentikan dengan aman. Sampai jumpa!${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Start Bun Backend
(cd "$BACKEND_DIR" && bun run src/index.ts) &
BACKEND_PID=$!

# Tunggu backend siap
sleep 1.5

# Start Vite Frontend
(cd "$FRONTEND_DIR" && npm run dev -- --host) &
FRONTEND_PID=$!

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}                      RESMEET-STT BERHASIL DIJALANKAN!                        ${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo -e "  🌐 Aplikasi Web Frontend : ${CYAN}http://localhost:5173${NC}"
echo -e "  🚀 Backend API & Socket  : ${CYAN}http://localhost:8200${NC}"
echo -e "  📖 Dokumentasi Interaktif: ${CYAN}http://localhost:5173/docs/index.html${NC}"
echo -e "                             ${CYAN}(atau buka file docs/index.html)${NC}"
echo -e "------------------------------------------------------------------------------"
echo -e "  Tekan ${RED}[CTRL + C]${NC} di terminal ini untuk menghentikan seluruh layanan."
echo -e "==============================================================================\n"

# Menahan proses agar tetap hidup
wait
