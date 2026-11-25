#!/usr/bin/env bash
# ==============================================================================
# Resmeet-STT: Docker Startup Script (dengan Audit Kesiapan & Error Handling)
# ==============================================================================
# Penggunaan:
#   ./start-docker.sh            -> Audit prasyarat, build jika perlu, jalankan & cek preflight
#   ./start-docker.sh --build    -> Paksa rebuild image backend & frontend lalu jalankan
#   ./start-docker.sh --logs     -> Jalankan lalu ikuti log container
#   ./start-docker.sh --down     -> Hentikan seluruh container Resmeet-STT
#   ./start-docker.sh --help     -> Tampilkan bantuan
# ==============================================================================

set -Eeuo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"

FORCE_BUILD=false
FOLLOW_LOGS=false
DO_DOWN=false
ERRORS=()

print_banner() {
  echo -e "${CYAN}==============================================================================${NC}"
  echo -e "${CYAN}             RESMEET-STT: DOCKER LAUNCHER & READINESS CHECK                   ${NC}"
  echo -e "${CYAN}       Rust Axum + Tokio • React 19 • PostgreSQL • Whisper.cpp • Docker       ${NC}"
  echo -e "${CYAN}==============================================================================${NC}"
}

add_error() {
  local title="$1"
  local recommendation="$2"
  ERRORS+=("${title}|||${recommendation}")
}

on_unexpected_error() {
  local exit_code=$?
  local line_no=$1
  echo -e "\n${RED}[ERROR] Proses terhenti mendadak di baris ${line_no} (exit code: ${exit_code}).${NC}"
  echo -e "${YELLOW}Rekomendasi diagnosa:${NC}"
  echo -e "  1. Periksa status container   : docker compose ps"
  echo -e "  2. Periksa log backend/worker : docker logs resmeet_backend --tail 40 && docker logs resmeet_worker --tail 40"
  echo -e "  3. Pastikan port 8200 & 5173 tidak dipakai proses non-Docker."
  exit "$exit_code"
}
trap 'on_unexpected_error $LINENO' ERR

for arg in "$@"; do
  case "$arg" in
    --build|--rebuild) FORCE_BUILD=true ;;
    --logs|-f) FOLLOW_LOGS=true ;;
    --down|down) DO_DOWN=true ;;
    --help|-h)
      print_banner
      echo "Opsi:"
      echo "  (default)   Cek prasyarat, build image jika belum ada, jalankan Docker Compose & audit /api/preflight"
      echo "  --build     Build ulang image resmeet-stt-backend dan resmeet-stt-frontend"
      echo "  --logs      Setelah aktif, ikuti log service secara live"
      echo "  --down      Hentikan container Resmeet-STT (docker compose down)"
      exit 0
      ;;
    *)
      echo -e "${RED}Opsi tidak dikenal: ${arg}${NC}"
      echo "Jalankan './start-docker.sh --help' untuk melihat opsi yang tersedia."
      exit 1
      ;;
  esac
done

print_banner
cd "$ROOT_DIR"

if [ "$DO_DOWN" = true ]; then
  echo -e "${YELLOW}Menghentikan container Resmeet-STT...${NC}"
  docker compose down
  echo -e "${GREEN}✓ Container Resmeet-STT dihentikan.${NC}"
  exit 0
fi

# ------------------------------------------------------------------------------
# 1. Audit Environment (.env)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[1/6] Memeriksa konfigurasi .env...${NC}"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}✗ File .env tidak ditemukan di root proyek.${NC}"
  if [ -f "$ENV_EXAMPLE" ]; then
    add_error "File .env belum ada" "Salin template terlebih dahulu:\n     cp .env.example .env\n     Lalu sesuaikan DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, dan DB_NAME."
  else
    add_error "File .env tidak ditemukan" "Buat file .env di root proyek sesuai konfigurasi PostgreSQL dan Whisper."
  fi
else
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo -e "${GREEN}✓ File .env ditemukan (PORT=${PORT:-8200}, WHISPER_MODEL=${WHISPER_MODEL:-ggml-large-v3-turbo-q5_0.bin}).${NC}"
fi

# ------------------------------------------------------------------------------
# 2. Audit Docker & Docker Compose
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[2/6] Memeriksa Docker Engine & Compose...${NC}"
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker CLI tidak ditemukan.${NC}"
  add_error "Docker belum terpasang" "Install Docker Engine & Compose Plugin:\n     https://docs.docker.com/engine/install/\n     Atau gunakan mode native: ./start-non-docker.sh"
elif ! docker info >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker daemon tidak aktif atau user belum memiliki izin akses socket Docker.${NC}"
  add_error "Docker daemon tidak dapat diakses" "Jalankan daemon & tambahkan user ke grup docker:\n     sudo systemctl start docker\n     sudo usermod -aG docker \$USER && newgrp docker"
elif ! docker compose version >/dev/null 2>&1; then
  echo -e "${RED}✗ Plugin 'docker compose' v2 tidak ditemukan.${NC}"
  add_error "Docker Compose v2 tidak tersedia" "Install plugin compose:\n     sudo apt update && sudo apt install -y docker-compose-plugin"
else
  echo -e "${GREEN}✓ Docker Engine dan Docker Compose v2 aktif.${NC}"
fi

# ------------------------------------------------------------------------------
# 3. Audit Database PostgreSQL
# ------------------------------------------------------------------------------
DB_HOST_VAL="${DB_HOST:-host.docker.internal}"
DB_PORT_VAL="${DB_PORT:-5433}"
echo -e "\n${BOLD}[3/6] Memeriksa konektivitas PostgreSQL (${DB_HOST_VAL}:${DB_PORT_VAL})...${NC}"

CHECK_HOST="$DB_HOST_VAL"
if [ "$CHECK_HOST" = "host.docker.internal" ]; then
  CHECK_HOST="127.0.0.1"
fi

if (echo >/dev/tcp/"$CHECK_HOST"/"$DB_PORT_VAL") >/dev/null 2>&1; then
  echo -e "${GREEN}✓ PostgreSQL dapat dijangkau pada ${CHECK_HOST}:${DB_PORT_VAL}.${NC}"
else
  echo -e "${RED}✗ Port PostgreSQL ${CHECK_HOST}:${DB_PORT_VAL} belum merespons.${NC}"
  if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q '^postgres_db$'; then
    add_error "Container postgres_db belum berjalan" "Nyalakan container database yang sudah ada:\n     docker start postgres_db"
  else
    add_error "PostgreSQL di port ${DB_PORT_VAL} belum aktif" "Jalankan PostgreSQL atau buat container database:\n     docker run -d --name postgres_db -e POSTGRES_PASSWORD=password -e POSTGRES_DB=stt_db -p ${DB_PORT_VAL}:5432 postgres:16"
  fi
fi

# ------------------------------------------------------------------------------
# 4. Audit Model Whisper & Direktori Penyimpanan
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[4/6] Memeriksa file model Whisper & folder penyimpanan...${NC}"
mkdir -p "$BACKEND_DIR/models" "$BACKEND_DIR/uploads" "$BACKEND_DIR/transcripts_md"

MODEL_FILE="${WHISPER_MODEL:-ggml-large-v3-turbo-q5_0.bin}"
if [[ "$MODEL_FILE" != *.bin ]]; then
  MODEL_FILE="ggml-${MODEL_FILE}-q5_0.bin"
fi
MODEL_PATH="$BACKEND_DIR/models/$MODEL_FILE"
FASTER_MODEL_BIN="$BACKEND_DIR/models/faster-whisper-large-v3-turbo/model.bin"
VAD_PATH="$BACKEND_DIR/models/${WHISPER_VAD_MODEL:-ggml-silero-v6.2.0.bin}"

if [ -s "$MODEL_PATH" ]; then
  echo -e "${GREEN}✓ Model GGML tersedia: backend/models/${MODEL_FILE}${NC}"
elif [ -s "$FASTER_MODEL_BIN" ]; then
  echo -e "${YELLOW}! Model GGML native belum ada, menggunakan fallback faster-whisper INT8.${NC}"
else
  echo -e "${RED}✗ Model Whisper (${MODEL_FILE}) belum ditemukan di backend/models/.${NC}"
  add_error "Bobot model Whisper belum tersedia" "Unduh model ke backend/models/:\n     curl -L -o backend/models/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin\n     curl -L -o backend/models/ggml-silero-v6.2.0.bin https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"
fi

if [ ! -s "$VAD_PATH" ]; then
  echo -e "${YELLOW}! Model Silero VAD belum ada di backend/models/. Pemangkasan hening otomatis akan memakai fallback.${NC}"
  echo -e "  Opsional unduh VAD: curl -L -o backend/models/ggml-silero-v6.2.0.bin https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"
else
  echo -e "${GREEN}✓ Model Silero VAD tersedia.${NC}"
fi

# ------------------------------------------------------------------------------
# 5. Evaluasi Hasil Audit Prasyarat
# ------------------------------------------------------------------------------
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo -e "\n${RED}==============================================================================${NC}"
  echo -e "${RED}  STARTUP DIBATALKAN: Ditemukan ${#ERRORS[@]} prasyarat yang belum siap${NC}"
  echo -e "${RED}==============================================================================${NC}"
  idx=1
  for item in "${ERRORS[@]}"; do
    title="${item%%|||*}"
    rec="${item#*|||}"
    echo -e "\n${RED}${idx}. ${title}${NC}"
    echo -e "   ${YELLOW}Rekomendasi:${NC} ${rec}"
    idx=$((idx + 1))
  done
  echo -e "\n${CYAN}Perbaiki item di atas lalu jalankan kembali ./start-docker.sh${NC}\n"
  exit 1
fi

# ------------------------------------------------------------------------------
# 6. Build (jika diperlukan) & Jalankan Container
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[5/6] Memeriksa image & memulai container Resmeet-STT...${NC}"

NEED_BACKEND_BUILD=false
NEED_FRONTEND_BUILD=false
if [ "$FORCE_BUILD" = true ]; then
  NEED_BACKEND_BUILD=true
  NEED_FRONTEND_BUILD=true
else
  docker image inspect resmeet-stt-backend >/dev/null 2>&1 || NEED_BACKEND_BUILD=true
  docker image inspect resmeet-stt-frontend >/dev/null 2>&1 || NEED_FRONTEND_BUILD=true
fi

BUILD_ARGS=(--network host)
if docker buildx ls 2>/dev/null | grep -q 'resmeet-builder'; then
  BUILD_ARGS=(--builder resmeet-builder --network host --load)
fi

if [ "$NEED_BACKEND_BUILD" = true ]; then
  echo -e "${YELLOW}Membangun image resmeet-stt-backend (konteks bersih)...${NC}"
  tar --exclude='._*' --exclude='target' --exclude='models' --exclude='uploads' \
    --exclude='transcripts_md' --exclude='src_ts' --exclude='*.db' \
    --exclude='*.sqlite' --exclude='.env' --exclude='.db_secret.key' \
    --exclude='database.json' --exclude='database.json.tmp' --exclude='ai-encryption.key' \
    -C "$BACKEND_DIR" -cf - . | docker buildx build "${BUILD_ARGS[@]}" -t resmeet-stt-backend -
fi

if [ "$NEED_FRONTEND_BUILD" = true ]; then
  echo -e "${YELLOW}Membangun image resmeet-stt-frontend...${NC}"
  tar --exclude='._*' --exclude='node_modules' --exclude='dist' \
    -C "$FRONTEND_DIR" -cf - . | docker buildx build "${BUILD_ARGS[@]}" -t resmeet-stt-frontend -
fi

COMPOSE_FILES=(-f docker-compose.yml)
if [ "${RESMEET_GPU:-auto}" != "off" ] && [ -c /dev/dri/renderD128 ]; then
  COMPOSE_FILES+=(-f docker-compose.gpu.yml)
  echo -e "${GREEN}✓ Perangkat GPU /dev/dri/renderD128 terdeteksi (akselerasi Vulkan siap).${NC}"
else
  echo -e "${YELLOW}! GPU render node tidak terdeteksi / dimatikan (RESMEET_GPU=off), berjalan di mode CPU.${NC}"
fi

docker compose "${COMPOSE_FILES[@]}" up -d --no-build

# ------------------------------------------------------------------------------
# 7. Verifikasi Preflight Readiness Pasca-Start
# ------------------------------------------------------------------------------
APP_PORT="${PORT:-8200}"
echo -e "\n${BOLD}[6/6] Memverifikasi kesiapan layanan melalui http://127.0.0.1:${APP_PORT}/api/preflight...${NC}"

PREFLIGHT_JSON=""
for i in $(seq 1 30); do
  if PREFLIGHT_JSON="$(curl -fsS "http://127.0.0.1:${APP_PORT}/api/preflight" 2>/dev/null)"; then
    if echo "$PREFLIGHT_JSON" | grep -q '"ready":true'; then
      break
    fi
  fi
  sleep 2
done

if [ -z "$PREFLIGHT_JSON" ]; then
  echo -e "${RED}✗ Backend tidak merespons setelah 60 detik.${NC}"
  echo -e "${YELLOW}Rekomendasi:${NC}"
  echo -e "  1. Cek log backend : docker logs resmeet_backend --tail 50"
  echo -e "  2. Cek status      : docker compose ps"
  exit 1
fi

python3 - "$PREFLIGHT_JSON" << 'PYEOF'
import json, sys

data = json.loads(sys.argv[1])
checks = data.get("checks", {})
ready = data.get("ready", False)
gpu_ok = data.get("gpuAvailable", False)

labels = [
    ("database", "PostgreSQL Database", "Pastikan container postgres_db berjalan & konfigurasi .env benar."),
    ("ffmpeg", "FFmpeg Converter", "Rebuild backend image dengan ./start-docker.sh --build."),
    ("whisperCli", "Mesin Transkripsi (Whisper)", "Periksa whisper-server atau faster-whisper di container backend."),
    ("whisperModel", "Model Whisper", "Pastikan file ggml-large-v3-turbo-q5_0.bin ada di backend/models/."),
    ("uploadsWritable", "Penyimpanan Upload", "Periksa volume resmeet_backend_uploads dan izin folder."),
    ("transcriptionWorker", "Worker Transkripsi", "Cek log worker: docker logs resmeet_worker --tail 40"),
    ("aiWorker", "Worker AI (Opsional)", "Cek log ai-worker: docker logs resmeet_ai_worker --tail 40"),
    ("aiGateway", "AI Gateway (Opsional)", "Konfigurasikan Gateway & API Key AI pada menu Pengaturan web."),
]

print("\nRingkasan Preflight Check:")
for key, label, hint in labels:
    ok = checks.get(key, False)
    mark = "\033[0;32m[SIAP]\033[0m" if ok else "\033[0;31m[BELUM SIAP]\033[0m"
    print(f"  {mark} {label}")
    if not ok:
        print(f"         -> Rekomendasi: {hint}")

gpu_text = "\033[0;32mAktif (Vulkan)\033[0m" if gpu_ok else "\033[1;33mTidak aktif (Mode CPU)\033[0m"
print(f"\n  Akselerasi GPU : {gpu_text}")
print(f"  Model Default  : {data.get('defaultModel', '-')}")

if not ready:
    sys.exit(2)
PYEOF

STATUS_CODE=$?
if [ "$STATUS_CODE" -ne 0 ]; then
  echo -e "\n${RED}✗ Sistem belum sepenuhnya siap untuk transkripsi. Perbaiki komponen bertanda [BELUM SIAP] di atas.${NC}"
  exit 1
fi

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}  Resmeet-STT Docker Mode AKTIF & SIAP DIGUNAKAN!${NC}"
echo -e "${GREEN}  Web UI     : http://localhost:5173${NC}"
echo -e "${GREEN}  API Health : http://localhost:${APP_PORT}/api/preflight${NC}"
echo -e "${GREEN}==============================================================================${NC}"

if [ "$FOLLOW_LOGS" = true ]; then
  docker compose logs -f
fi
