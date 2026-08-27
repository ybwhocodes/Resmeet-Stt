# Backend Setup dan Run

Backend: Flask + Flask-SocketIO + WhisperX + MySQL + optional AI correction/RAG.

## Prasyarat

- Python 3.10+ direkomendasikan.
- MySQL aktif.
- FFmpeg aktif.
- Internet untuk download model pertama kali.

## Aktifkan WhisperX

Buat virtualenv:

```bash
python3 -m venv whisperx-env
source whisperx-env/bin/activate
pip install -r Requirements.txt



Cek FFmpeg:

```bash
ffmpeg -version
ffprobe -version
```

## Setup

Masuk folder backend:

```bash
cd backend
```

Buat virtualenv:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependency:

```bash
pip install -r Requirements.txt
```

Cek WhisperX:

```bash
python -c "import whisperx; print('whisperx ok')"
```

## Konfigurasi `.env`

Contoh minimal:

```env
DB_HOST=localhost
DB_PORT=3307
DB_NAME=stt_db
DB_USER=root
DB_PASSWORD=password

WHISPER_MODEL=large-v3-turbo
MODEL_DIR=/Users/billy/Documents/Server/Resmeet-Stt/backend/models

DEVICE=cpu
COMPUTE_TYPE=int8
CPU_THREADS=2
BATCH_SIZE=1
ENABLE_AUDIO_DENOISE=false

AI_BASE_URL=
AI_API_KEY=
AI_MODEL_ID=
AI_TIMEOUT_S=120
AI_ENABLE_CORRECTION=true
AI_ENABLE_KNOWLEDGE_EXTRACTION=true
AI_ENABLE_RAG=true
```

Catatan:

- `AI_API_KEY` boleh kosong. Backend tetap jalan tanpa koreksi AI.
- Model akan otomatis didownload jika belum ada di `MODEL_DIR`.
- `large-v3-turbo` tetap dipakai sesuai konfigurasi.

## Setup Database

Buat database dan table:

```bash
mysql -u root -p < schema.sql
```

Atau cukup jalankan backend. `init_db()` akan membuat table jika belum ada.

## Run

Aktifkan virtualenv jika belum:

```bash
source .venv/bin/activate
```

Jalankan server:

```bash
python app.py
```

Server jalan di:

```text
http://localhost:8081
```

## Endpoint Penting

Health:

```http
GET http://localhost:8081/api/health
```

Preflight:

```http
GET http://localhost:8081/api/preflight
```

Preflight dengan cek AI config:

```http
GET http://localhost:8081/api/preflight?ai=true
```

Upload transkripsi:

```bash
curl -X POST http://localhost:8081/api/upload-and-transcribe \
  -F "audioFile=@meeting.mp3" \
  -F "ai_correction=true" \
  -F "output_format=md"
```

Status job:

```http
GET http://localhost:8081/api/jobs/<job_id>
```

Download Markdown:

```http
GET http://localhost:8081/api/jobs/<job_id>/download-md
```

Riwayat:

```http
GET http://localhost:8081/api/transcripts
```

## Folder Runtime

```text
backend/uploads/          file upload sementara
backend/models/           model Whisper lokal
backend/knowledge/        knowledge RAG markdown
backend/transcripts_md/   hasil transkrip markdown
```

## Troubleshooting

`ModuleNotFoundError: No module named 'whisperx'`

```bash
source .venv/bin/activate
pip install -r Requirements.txt
```

`FFmpeg gagal`

```bash
ffmpeg -version
ffprobe -version
```

Model tidak ketemu atau download ulang:

- Cek `MODEL_DIR` di `.env`.
- Pastikan path mengarah ke folder project saat ini.

CPU terlalu penuh:

```env
CPU_THREADS=2
BATCH_SIZE=1
```

AI correction tidak jalan:

- Isi `AI_BASE_URL`.
- Isi `AI_API_KEY`.
- Isi `AI_MODEL_ID`.
- Cek `GET /api/preflight?ai=true`.
