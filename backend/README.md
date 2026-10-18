# Resmeet-STT Backend (Bun.js + TypeScript)

Backend transkripsi suara mandiri (STT) berbasis **Bun.js** + **TypeScript**, **whisper.cpp**, **MySQL**, serta **Goal-Directed Topics Analysis** terinspirasi dari arsitektur [Jev Ultrafast](https://github.com/browser-use/browser-use).

---

## ⚡ Fitur Utama

- **Runtime Cepat & Ringan**: Dibangun dengan Bun.js + TypeScript murni, menggantikan dependensi Python yang berat.
- **Engine STT Whisper.cpp**: Menggunakan port C/C++ performa tinggi dengan akselerasi Metal (Apple Silicon) dan CPU multi-threading.
- **Topik Terarah (Jev-Guided Topics)**: Menghasilkan notulen rapat (Minutes of Meeting) terarah dengan pembagian sasaran (goal), inti diskusi, keputusan konkret, dan action items per topik.
- **Pengaturan AI Dinamis**: Konfigurasi URL Base, API-Key, dan Nama Model dapat diatur langsung melalui antarmuka (Settings Modal) dan otomatis tersimpan.
- **Continuous Knowledge Learning (RAG)**: Secara otomatis mengekstrak istilah baru (`glossary.md`), konsep (`concepts.md`), dan koreksi salah dengar (`corrections.md`).
- **Realtime WebSocket**: Mengirim progres transkripsi secara langsung ke antarmuka frontend via Socket.IO.

---

## 📋 Prasyarat

1. **Bun.js** (v1.1+):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
2. **whisper.cpp**:
   ```bash
   brew install whisper-cpp
   ```
3. **FFmpeg**:
   ```bash
   brew install ffmpeg
   ```
4. **MySQL** (Docker atau lokal, default port 3307):
   ```bash
   docker start mysql_db
   ```

---

## 🚀 Cara Menjalankan

### 1. Masuk ke Folder Backend
```bash
cd backend
```

### 2. Install Dependensi
```bash
bun install
```

### 3. Model GGML Whisper
Letakkan model GGML whisper.cpp (`ggml-large-v3-turbo.bin` atau `ggml-base.bin`) di folder `backend/models/`.

Download model rekomendasi:
```bash
curl -L -o backend/models/ggml-large-v3-turbo.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

### 4. Menjalankan Server
Mode pengembangan (watch mode):
```bash
bun run dev
```

Mode produksi:
```bash
bun start
```

Server akan aktif pada: `http://localhost:8081`

---

## ⚙️ Konfigurasi Environment & Pengaturan AI

Konfigurasi disimpan di `backend/.env` dan dapat diperbarui secara dinamis melalui UI settings (`settings.json`):

```env
# ─── MySQL ───
DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=stt_db
DB_USER=root
DB_PASSWORD=password

# ─── Whisper STT (whisper.cpp) ───
WHISPER_MODEL=large-v3-turbo
MODEL_DIR=
CPU_THREADS=4

# ─── AI Model / Jev Directed Topics ───
AI_BASE_URL=http://localhost:20128/v1
AI_API_KEY=sk-ff353870199354cb-rvq507-8ef93405
AI_MODEL_ID=9R-Gemini
AI_TIMEOUT_S=120
AI_ENABLE_CORRECTION=true
AI_ENABLE_KNOWLEDGE_EXTRACTION=true
AI_ENABLE_RAG=true
```

---

## 📡 Daftar Endpoint API

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/health` | Status server, engine STT, dan model AI |
| `GET` | `/api/preflight` | Pengecekan kesiapan sistem (FFmpeg, DB, Whisper, AI) |
| `POST` | `/api/upload-and-transcribe` | Upload audio dan mulai transkripsi |
| `GET` | `/api/jobs/:id` | Status pengerjaan job |
| `GET` | `/api/jobs/:id/download-md` | Download hasil notulen Markdown per job |
| `GET` | `/api/transcripts` | Daftar riwayat transkrip |
| `GET` | `/api/transcripts/:id/download-md` | Download hasil notulen Markdown per record DB |
| `POST` | `/api/paraphrase` | Parafrase teks notulen menggunakan AI |
| `GET` | `/api/settings` | Mendapatkan konfigurasi AI aktif |
| `POST` | `/api/settings` | Mengubah dan menyimpan konfigurasi AI (URL, API-Key, Model) |
| `POST` | `/api/settings/test` | Menguji konektivitas endpoint dan model AI |
