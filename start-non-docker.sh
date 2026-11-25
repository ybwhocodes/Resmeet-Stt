#!/usr/bin/env bash
# ==============================================================================
# Resmeet-STT: Non-Docker / Native Local Startup Script
# ==============================================================================
# Menjalankan seluruh komponen secara lokal tanpa container Resmeet:
#   1. Rust API Server      (APP_ROLE=api, port 8200)
#   2. Transcription Worker (APP_ROLE=worker)
#   3. AI Worker            (APP_ROLE=ai-worker)
#   4. Vite React Frontend  (port 5173)
#
# Jika ada komponen yang belum siap/kurang, script akan menampilkan daftar
# rekomendasi instalasi secara spesifik sebelum menjalankan aplikasi.
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
BACKEND_ENV="$BACKEND_DIR/.env"
BACKEND_ENV_EXAMPLE="$BACKEND_DIR/.env.example"

ERRORS=()
BACKEND_PID=""
WORKER_PID=""
AI_WORKER_PID=""
FRONTEND_PID=""

print_banner() {
  echo -e "${CYAN}==============================================================================${NC}"
  echo -e "${CYAN}           RESMEET-STT: NON-DOCKER (NATIVE LOCAL) LAUNCHER                    ${NC}"
  echo -e "${CYAN}       Rust Native Binary • Vite Dev Server • Local PostgreSQL & Whisper      ${NC}"
  echo -e "${CYAN}==============================================================================${NC}"
}

add_error() {
  local title="$1"
  local recommendation="$2"
  ERRORS+=("${title}|||${recommendation}")
}

cleanup() {
  if [ -n "$BACKEND_PID$WORKER_PID$AI_WORKER_PID$FRONTEND_PID" ]; then
    echo -e "\n${YELLOW}Menghentikan seluruh proses lokal Resmeet-STT...${NC}"
    kill "$BACKEND_PID" "$WORKER_PID" "$AI_WORKER_PID" "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" "$WORKER_PID" "$AI_WORKER_PID" "$FRONTEND_PID" 2>/dev/null || true
    echo -e "${GREEN}✓ Semua proses lokal telah dihentikan.${NC}"
  fi
}
trap cleanup EXIT
trap 'exit 130' SIGINT
trap 'exit 143' SIGTERM

on_unexpected_error() {
  local exit_code=$?
  local line_no=$1
  echo -e "\n${RED}[ERROR] Eksekusi native terhenti pada baris ${line_no} (exit code: ${exit_code}).${NC}"
  echo -e "${YELLOW}Rekomendasi:${NC}"
  echo -e "  1. Pastikan build tools Linux terpasang: sudo apt install -y build-essential pkg-config libssl-dev"
  echo -e "  2. Pastikan PostgreSQL berjalan di host/port sesuai backend/.env"
  echo -e "  3. Cek apakah port 8200 / 5173 bentrok dengan container Docker (hentikan dengan: docker compose down)"
  exit "$exit_code"
}
trap 'on_unexpected_error $LINENO' ERR

print_banner

# ------------------------------------------------------------------------------
# 1. Audit Konfigurasi Environment (backend/.env)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[1/7] Memeriksa backend/.env...${NC}"
if [ ! -f "$BACKEND_ENV" ]; then
  echo -e "${RED}✗ File backend/.env tidak ditemukan.${NC}"
  if [ -f "$BACKEND_ENV_EXAMPLE" ]; then
    add_error "File backend/.env belum tersedia" "Salin template konfigurasi lokal:\n     cp backend/.env.example backend/.env\n     Pastikan DB_HOST=127.0.0.1 dan DB_PORT sesuai PostgreSQL lokal Anda."
  else
    add_error "File backend/.env belum tersedia" "Buat backend/.env dengan variabel DATABASE_URL / DB_HOST / WHISPER_MODEL."
  fi
else
  set -a
  # shellcheck disable=SC1090
  source "$BACKEND_ENV"
  set +a
  echo -e "${GREEN}✓ File backend/.env dimuat.${NC}"
  if [ "${DB_HOST:-}" = "host.docker.internal" ]; then
    echo -e "${RED}✗ DB_HOST bernilai 'host.docker.internal' yang hanya valid di dalam Docker.${NC}"
    add_error "DB_HOST di backend/.env tidak cocok untuk mode non-Docker" "Ubah DB_HOST=127.0.0.1 dan DATABASE_URL ke 127.0.0.1 di backend/.env."
  fi
fi

# ------------------------------------------------------------------------------
# 2. Audit Toolchain (Rust Cargo, Node.js, NPM)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[2/7] Memeriksa toolchain Rust & Node.js...${NC}"
if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Rust toolchain ditemukan ($(rustc --version)).${NC}"
else
  echo -e "${RED}✗ Rust / Cargo tidak ditemukan di sistem.${NC}"
  add_error "Rust (cargo & rustc) belum terpasang" "Install Rust toolchain melalui rustup:\n     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh\n     source \"\$HOME/.cargo/env\""
fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Node.js & npm ditemukan ($(node --version)).${NC}"
else
  echo -e "${RED}✗ Node.js atau npm belum terpasang.${NC}"
  add_error "Node.js / npm belum tersedia" "Install Node.js 20/22 LTS:\n     https://nodejs.org/ atau gunakan nvm: nvm install 22"
fi

# ------------------------------------------------------------------------------
# 3. Audit FFmpeg & Mesin Transkripsi (Whisper)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[3/7] Memeriksa FFmpeg & Mesin Whisper...${NC}"
if command -v ffmpeg >/dev/null 2>&1; then
  echo -e "${GREEN}✓ FFmpeg ditemukan ($(command -v ffmpeg)).${NC}"
else
  echo -e "${RED}✗ FFmpeg tidak ditemukan di PATH.${NC}"
  add_error "FFmpeg belum terpasang" "Install FFmpeg untuk konversi audio 16kHz:\n     sudo apt update && sudo apt install -y ffmpeg"
fi

WHISPER_SERVER_FOUND=false
if [ -n "${WHISPER_SERVER:-}" ] && [ -x "${WHISPER_SERVER}" ]; then
  WHISPER_SERVER_FOUND=true
  echo -e "${GREEN}✓ whisper-server ditemukan di WHISPER_SERVER=${WHISPER_SERVER}.${NC}"
elif [ -x "/usr/local/bin/whisper-server" ]; then
  WHISPER_SERVER_FOUND=true
  echo -e "${GREEN}✓ whisper-server ditemukan di /usr/local/bin/whisper-server.${NC}"
elif command -v whisper-server >/dev/null 2>&1; then
  WHISPER_SERVER_FOUND=true
  echo -e "${GREEN}✓ whisper-server ditemukan di $(command -v whisper-server).${NC}"
fi

FASTER_FOUND=false
for py_candidate in "${FASTER_WHISPER_PYTHON:-}" "/opt/stt-python/bin/python" "$BACKEND_DIR/.venv/bin/python" "$ROOT_DIR/.venv/bin/python" "$(command -v python3 || true)"; do
  if [ -n "$py_candidate" ] && [ -x "$py_candidate" ]; then
    if "$py_candidate" -c "import faster_whisper" >/dev/null 2>&1; then
      FASTER_FOUND=true
      export FASTER_WHISPER_PYTHON="$py_candidate"
      echo -e "${GREEN}✓ Runtime faster-whisper tersedia melalui ${py_candidate}.${NC}"
      break
    fi
  fi
done

if [ "$WHISPER_SERVER_FOUND" = false ] && [ "$FASTER_FOUND" = false ]; then
  echo -e "${RED}✗ Tidak ditemukan engine whisper-server maupun Python faster-whisper.${NC}"
  add_error "Mesin transkripsi (whisper-server / faster-whisper) belum tersedia" "Pilih salah satu langkah berikut:\n     Opsi A (Whisper.cpp Native / Vulkan GPU):\n       git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp\n       cmake -B build -DGGML_VULKAN=1 && cmake --build build -j\$(nproc) --target whisper-server\n       sudo cp build/bin/whisper-server /usr/local/bin/\n     Opsi B (Faster-Whisper CPU INT8 via Python venv):\n       python3 -m venv backend/.venv && backend/.venv/bin/pip install faster-whisper==1.2.1 av==18.1.0\n       Lalu isi FASTER_WHISPER_PYTHON=${BACKEND_DIR}/.venv/bin/python di backend/.env."
fi

# ------------------------------------------------------------------------------
# 4. Audit Model & Izin Direktori
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[4/7] Memeriksa file model Whisper & folder penyimpanan...${NC}"
mkdir -p "$BACKEND_DIR/models" "$BACKEND_DIR/uploads" "$BACKEND_DIR/transcripts_md"

MODEL_BASE_DIR="${MODEL_DIR:-$BACKEND_DIR/models}"
MODEL_FILE="${WHISPER_MODEL:-ggml-large-v3-turbo-q5_0.bin}"
if [[ "$MODEL_FILE" != *.bin ]]; then
  MODEL_FILE="ggml-${MODEL_FILE}-q5_0.bin"
fi
MODEL_PATH="$MODEL_BASE_DIR/$MODEL_FILE"
FASTER_MODEL_DIR_VAL="${FASTER_WHISPER_MODEL_DIR:-$MODEL_BASE_DIR/faster-whisper-large-v3-turbo}"

if [ -s "$MODEL_PATH" ] || [ -s "$FASTER_MODEL_DIR_VAL/model.bin" ]; then
  echo -e "${GREEN}✓ Model Whisper tersedia di ${MODEL_BASE_DIR}.${NC}"
else
  echo -e "${RED}✗ File bobot model belum ditemukan di ${MODEL_BASE_DIR}.${NC}"
  add_error "Bobot model Whisper belum diunduh" "Unduh model large-v3-turbo ke backend/models/:\n     curl -L -o backend/models/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin\n     curl -L -o backend/models/ggml-silero-v6.2.0.bin https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"
fi

if [ ! -w "$BACKEND_DIR/uploads" ]; then
  echo -e "${RED}✗ Direktori backend/uploads tidak dapat ditulis.${NC}"
  add_error "Folder backend/uploads tidak memiliki izin tulis" "Jalankan: chmod -R u+rwX backend/uploads backend/transcripts_md"
else
  echo -e "${GREEN}✓ Direktori upload dapat ditulis.${NC}"
fi

# ------------------------------------------------------------------------------
# 5. Audit Database PostgreSQL & Port Konflik
# ------------------------------------------------------------------------------
DB_HOST_VAL="${DB_HOST:-127.0.0.1}"
DB_PORT_VAL="${DB_PORT:-5433}"
APP_PORT="${PORT:-8200}"

echo -e "\n${BOLD}[5/7] Memeriksa PostgreSQL (${DB_HOST_VAL}:${DB_PORT_VAL}) & ketersediaan port...${NC}"
if (echo >/dev/tcp/"$DB_HOST_VAL"/"$DB_PORT_VAL") >/dev/null 2>&1; then
  echo -e "${GREEN}✓ PostgreSQL dapat dijangkau pada ${DB_HOST_VAL}:${DB_PORT_VAL}.${NC}"
else
  echo -e "${RED}✗ PostgreSQL pada ${DB_HOST_VAL}:${DB_PORT_VAL} tidak merespons.${NC}"
  add_error "Database PostgreSQL tidak aktif di ${DB_HOST_VAL}:${DB_PORT_VAL}" "Install & jalankan PostgreSQL lokal atau sesuaikan DB_PORT di backend/.env:\n     sudo apt install -y postgresql && sudo systemctl start postgresql\n     Buat database 'stt_db' lalu samakan DB_PORT (umumnya 5432 untuk PostgreSQL lokal atau 5433)."
fi

for check_port in "$APP_PORT" "5173"; do
  if (echo >/dev/tcp/127.0.0.1/"$check_port") >/dev/null 2>&1; then
    echo -e "${RED}✗ Port ${check_port} sudah dipakai oleh proses lain (kemungkinan container Docker Resmeet masih aktif).${NC}"
    add_error "Port ${check_port} sedang terpakai" "Hentikan proses/container yang menggunakan port ${check_port}:\n     Jika dari Docker: ./start-docker.sh --down\n     Atau cek pemilik port: ss -tulpn | grep :${check_port}"
  else
    echo -e "${GREEN}✓ Port ${check_port} tersedia.${NC}"
  fi
done

# ------------------------------------------------------------------------------
# Evaluasi Hasil Audit Prasyarat
# ------------------------------------------------------------------------------
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo -e "\n${RED}==============================================================================${NC}"
  echo -e "${RED}  STARTUP NON-DOCKER DIBATALKAN: ${#ERRORS[@]} komponen belum siap${NC}"
  echo -e "${RED}==============================================================================${NC}"
  idx=1
  for item in "${ERRORS[@]}"; do
    title="${item%%|||*}"
    rec="${item#*|||}"
    echo -e "\n${RED}${idx}. ${title}${NC}"
    echo -e "   ${YELLOW}Rekomendasi:${NC} ${rec}"
    idx=$((idx + 1))
  done
  echo -e "\n${CYAN}Catatan: Jika ingin langsung jalan tanpa install Cargo/FFmpeg/Whisper di host,${NC}"
  echo -e "${CYAN}Anda dapat menggunakan mode Docker dengan menjalankan: ./start-docker.sh${NC}\n"
  exit 1
fi

# ------------------------------------------------------------------------------
# 6. Persiapan Dependensi & Build Native
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[6/7] Menyiapkan dependensi frontend & kompilasi Rust backend...${NC}"
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo -e "${YELLOW}Menginstall dependensi npm frontend (npm ci)...${NC}"
  (cd "$FRONTEND_DIR" && npm ci)
fi

export COPYFILE_DISABLE=1
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/resmeet-backend-target}"
PROFILE_FLAG=""
BIN_PATH="$CARGO_TARGET_DIR/debug/resmeet-backend"
if [ "${RESMEET_RELEASE:-0}" = "1" ]; then
  PROFILE_FLAG="--release"
  BIN_PATH="$CARGO_TARGET_DIR/release/resmeet-backend"
fi

echo -e "${YELLOW}Membangun resmeet-backend (${BIN_PATH})...${NC}"
if ! (cd "$BACKEND_DIR" && CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" cargo build --locked $PROFILE_FLAG); then
  echo -e "\n${RED}✗ Kompilasi Rust gagal!${NC}"
  echo -e "${YELLOW}Rekomendasi:${NC} Pastikan dependensi compiler C & OpenSSL header terpasang:\n  sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev"
  exit 1
fi

# ------------------------------------------------------------------------------
# 7. Jalankan Proses API, Worker, AI-Worker & Frontend Vite
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[7/7] Menjalankan service lokal...${NC}"
(cd "$BACKEND_DIR" && APP_ROLE=api exec "$BIN_PATH") &
BACKEND_PID=$!

sleep 2
(cd "$BACKEND_DIR" && APP_ROLE=worker exec "$BIN_PATH") &
WORKER_PID=$!

(cd "$BACKEND_DIR" && APP_ROLE=ai-worker exec "$BIN_PATH") &
AI_WORKER_PID=$!

(cd "$FRONTEND_DIR" && exec npm run dev -- --host) &
FRONTEND_PID=$!

echo -e "${YELLOW}Menunggu readiness check dari http://127.0.0.1:${APP_PORT}/api/preflight...${NC}"
PREFLIGHT_JSON=""
for i in $(seq 1 25); do
  if PREFLIGHT_JSON="$(curl -fsS "http://127.0.0.1:${APP_PORT}/api/preflight" 2>/dev/null)"; then
    if echo "$PREFLIGHT_JSON" | grep -q '"ready":true'; then
      break
    fi
  fi
  sleep 1
done

if [ -n "$PREFLIGHT_JSON" ]; then
  python3 - "$PREFLIGHT_JSON" << 'PYEOF' || true
import json, sys
data = json.loads(sys.argv[1])
checks = data.get("checks", {})
print("\nStatus Preflight Mode Lokal:")
for k, v in checks.items():
    mark = "\033[0;32m[SIAP]\033[0m" if v else "\033[0;31m[BELUM SIAP]\033[0m"
    print(f"  {mark} {k}")
PYEOF
fi

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}  Resmeet-STT Mode Non-Docker AKTIF (Tekan Ctrl+C untuk berhenti)${NC}"
echo -e "${GREEN}  Frontend Vite : http://localhost:5173${NC}"
echo -e "${GREEN}  Backend API   : http://localhost:${APP_PORT}/api/preflight${NC}"
echo -e "${GREEN}==============================================================================${NC}"

wait -n "$BACKEND_PID" "$WORKER_PID" "$AI_WORKER_PID" "$FRONTEND_PID"
