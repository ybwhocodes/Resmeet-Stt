# Resmeet-STT

Aplikasi transkripsi meeting berbasis speech-to-text dengan koreksi AI dan RAG.
Terdiri dari backend (Flask + WhisperX) dan frontend (React + Vite).

## Arsitektur

- **Backend**: Flask + Flask-SocketIO + WhisperX + MySQL, dengan optional AI correction/RAG.
  Berjalan di `http://localhost:8081`.
- **Frontend**: React + Vite + Socket.IO client. Berjalan di `http://localhost:5173`.

## Prasyarat

- Python 3.10+
- Node.js 20.19+ atau 22.13+
- MySQL aktif
- FFmpeg aktif (`ffmpeg -version`, `ffprobe -version`)
- Internet untuk download model Whisper pertama kali

## Cara Menjalankan

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r Requirements.txt

# buat file .env (lihat contoh lengkap di backend/README.md)
# minimal: DB_*, WHISPER_MODEL, MODEL_DIR, dan optional AI_*

# siapkan database
mysql -u root -p < schema.sql

python app.py
```

Server jalan di `http://localhost:8081`.

### 2. Frontend

```bash
cd frontend
npm install

# optional: override URL backend
# echo "VITE_API_BASE_URL=http://localhost:8081/api" > .env.local

npm run dev
```

Buka `http://localhost:5173`.

## Konfigurasi Backend (`.env`)

| Variabel | Keterangan |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Koneksi MySQL |
| `WHISPER_MODEL`, `MODEL_DIR` | Model WhisperX dan folder lokal |
| `DEVICE`, `COMPUTE_TYPE`, `CPU_THREADS`, `BATCH_SIZE` | Performa inference |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL_ID` | Optional koreksi AI & RAG |

`AI_API_KEY` boleh kosong — backend tetap jalan tanpa koreksi AI.

## Endpoint Penting

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET | `/api/preflight` | Cek kesiapan (`?ai=true` cek config AI) |
| POST | `/api/upload-and-transcribe` | Upload audio + transkripsi |
| GET | `/api/jobs/<job_id>` | Status job |
| GET | `/api/jobs/<job_id>/download-md` | Download hasil Markdown |
| GET | `/api/transcripts` | Riwayat transkrip |

Contoh upload:

```bash
curl -X POST http://localhost:8081/api/upload-and-transcribe \
  -F "audioFile=@meeting.mp3" \
  -F "ai_correction=true" \
  -F "output_format=md"
```

## Build Frontend Production

```bash
cd frontend
npm run build
npm run preview
```

## Catatan Repo

Folder berat yang bukan core aplikasi sudah di-ignore:

- `backend/whisperx-env/` — virtual environment (venv)
- `backend/models/` — model Whisper lokal (di-download otomatis)
- `backend/.env` — menyimpan secret/kredential
- `.DS_Store`

Panduan mendetail ada di `backend/README.md` dan `frontend/README.md`.
