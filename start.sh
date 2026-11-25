#!/usr/bin/env bash
# ==============================================================================
# Resmeet-STT: Web-Base Startup Script
# Modes:
#   1. Default (Docker Mode): Runs PostgreSQL, Rust Axum Backend, & React Frontend in Docker
#   2. Local Mode (--local): Runs PostgreSQL in Docker + Local Rust Backend + Vite Frontend
# ==============================================================================

set -euo pipefail

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
echo -e "${CYAN}            RESMEET-STT: SISTEM TRANSKRIPSI & NOTULEN RAPAT WEB               ${NC}"
echo -e "${CYAN}        Rust (Axum + Tokio) • React 19 • PostgreSQL • Whisper.cpp • Docker    ${NC}"
echo -e "${CYAN}==============================================================================${NC}"

# Cek apakah mode local diminta
if [ "${1:-}" == "--local" ] || [ "${1:-}" == "--native" ]; then
  echo -e "\n${YELLOW}=== MODE: LOCAL / NATIVE EXECUTION ===${NC}"

  # 1. Pastikan PostgreSQL aktif
  echo -e "${YELLOW}[1/3] Memeriksa koneksi database PostgreSQL (port 5433)...${NC}"
  if ! docker ps --format '{{.Names}}' | grep -q "postgres_db"; then
    echo -e "${YELLOW}Peringatan: Container 'postgres_db' tidak ditemukan aktif.${NC}"
    echo -e "${YELLOW}Pastikan container database PostgreSQL Anda sudah berjalan di port 5433.${NC}"
  else
    echo -e "${GREEN}✓ Container postgres_db terdeteksi aktif.${NC}"
  fi

  # 2. Build / Check Rust Backend
  echo -e "${YELLOW}[2/3] Memeriksa Rust Backend...${NC}"
  export COPYFILE_DISABLE=1
  export CARGO_TARGET_DIR="/tmp/resmeet-backend-target"

  BACKEND_PID=""
  FRONTEND_PID=""
  WORKER_PID=""
  AI_WORKER_PID=""
  cleanup() {
    echo -e "\n${YELLOW}Menghentikan background process...${NC}"
    kill "$BACKEND_PID" "$FRONTEND_PID" "$WORKER_PID" "$AI_WORKER_PID" 2>/dev/null || true
    wait "$BACKEND_PID" "$FRONTEND_PID" "$WORKER_PID" "$AI_WORKER_PID" 2>/dev/null || true
    echo -e "${GREEN}✓ Selesai.${NC}"
  }
  trap cleanup EXIT
  trap 'exit 130' SIGINT
  trap 'exit 143' SIGTERM

  (cd "$BACKEND_DIR" && CARGO_BUILD_JOBS=2 cargo build --locked)

  # Jalankan Rust backend
  echo -e "${GREEN}Menjalankan Rust backend (http://127.0.0.1:8200)...${NC}"
  (cd "$BACKEND_DIR" && APP_ROLE=api exec "$CARGO_TARGET_DIR/debug/resmeet-backend") &
  BACKEND_PID=$!
  (cd "$BACKEND_DIR" && APP_ROLE=worker exec "$CARGO_TARGET_DIR/debug/resmeet-backend") &
  WORKER_PID=$!
  (cd "$BACKEND_DIR" && APP_ROLE=ai-worker exec "$CARGO_TARGET_DIR/debug/resmeet-backend") &
  AI_WORKER_PID=$!

  sleep 2

  # 3. Jalankan Vite Frontend
  echo -e "${GREEN}Menjalankan React Frontend (http://localhost:5173)...${NC}"
  (cd "$FRONTEND_DIR" && npm run dev -- --host) &
  FRONTEND_PID=$!

  wait -n "$BACKEND_PID" "$FRONTEND_PID" "$WORKER_PID" "$AI_WORKER_PID"

else
  echo -e "\n${YELLOW}=== MODE: DOCKER COMPOSE ===${NC}"
  echo -e "${GREEN}Membangun dan menjalankan container: Rust Backend, Frontend (DB: postgres_db)...${NC}"

  if ! command -v docker >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker tidak ditemukan di sistem!${NC}"
    echo -e "${YELLOW}Gunakan './start.sh --local' jika ingin menjalankan secara native.${NC}"
    exit 1
  fi

  export BUILDX_BUILDER="${BUILDX_BUILDER:-resmeet-builder}"
  cd "$ROOT_DIR"
  tar --exclude='._*' --exclude='target' --exclude='models' --exclude='uploads' \
    --exclude='transcripts_md' --exclude='src_ts' --exclude='*.db' \
    --exclude='*.sqlite' --exclude='.env' --exclude='.db_secret.key' \
    --exclude='database.json' --exclude='database.json.tmp' --exclude='ai-encryption.key' \
    -C "$BACKEND_DIR" -cf - . | docker build -t resmeet-stt-backend -
  tar --exclude='._*' --exclude='node_modules' --exclude='dist' \
    -C "$FRONTEND_DIR" -cf - . | docker build -t resmeet-stt-frontend -
  compose_options=()
  if [ "${RESMEET_GPU:-auto}" != "off" ] && [ -c /dev/dri/renderD128 ]; then
    compose_options=(-f docker-compose.yml -f docker-compose.gpu.yml)
    echo -e "${GREEN}GPU render tersedia: pilihan CPU/GPU dapat diatur melalui Pengaturan.${NC}"
  fi
  docker compose "${compose_options[@]}" up --no-build "$@"
fi
