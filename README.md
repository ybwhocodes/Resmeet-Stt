# Resmeet STT

Aplikasi web transkripsi rapat dan penyusunan notulen (Minutes of Meeting / MoM) dengan backend **Rust (Axum + Tokio)**, frontend **React 19 (Vite)**, **PostgreSQL**, **FFmpeg**, dan **Whisper `large-v3-turbo`** (`whisper.cpp` Vulkan GPU / `faster-whisper` INT8 CPU).

Untuk tampilan dokumentasi interaktif beserta diagram topologi arsitektur dan panduan instalasi lengkap, buka berkas [`index.html`](index.html) langsung di browser.

---

## Persiapan Berkas di Luar Git (`.gitignore`)

Repositori ini sengaja mengecualikan berkas rahasia, database lokal, rekaman media, dan file bobot model berukuran besar di `.gitignore`. Setelah melakukan `git clone`, siapkan berkas berikut secara mandiri:

| Path Lokal (Tidak Masuk Git) | Kegunaan | Langkah Persiapan |
| --- | --- | --- |
| `.env` | Konfigurasi utama Docker Compose | `cp .env.example .env` lalu sesuaikan kredensial PostgreSQL |
| `backend/.env` | Konfigurasi lokal untuk mode non-Docker | `cp backend/.env.example backend/.env` (pastikan `DB_HOST=127.0.0.1`) |
| `frontend/.env` | Override `VITE_API_BASE_URL` (opsional) | `cp frontend/.env.example frontend/.env` |
| `backend/models/ggml-large-v3-turbo-q5_0.bin` | Bobot model utama Whisper `large-v3-turbo` (548 MB) | Unduh ke `backend/models/` (lihat perintah di bawah) |
| `backend/models/ggml-silero-v6.2.0.bin` | Model Silero VAD untuk pemangkasan keheningan | Unduh ke `backend/models/` (lihat perintah di bawah) |
| `backend/uploads/` & `backend/transcripts_md/` | Penyimpanan audio & ekspor Markdown sementara | Direktori sudah tersedia lewat `.gitkeep`; pastikan memiliki izin tulis |
| `backend/.db_secret.key` / volume `resmeet_backend_config` | Kunci enkripsi AES-256-GCM API Key AI | Dibuat otomatis saat pertama berjalan; cadangkan bersama database |

### Mengunduh Bobot Model Whisper & Silero VAD

```sh
mkdir -p backend/models
curl -L -o backend/models/ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
curl -L -o backend/models/ggml-silero-v6.2.0.bin \
  https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin
```

Opsional, untuk menyiapkan model CTranslate2 CPU INT8 (`faster-whisper-large-v3-turbo`):

```sh
docker compose run --rm --no-deps backend /opt/stt-python/bin/python scripts/download_models.py
```

---

## Menjalankan dengan Docker (`./start-docker.sh`)

Skrip `./start-docker.sh` mengaudit `.env`, Docker Engine & Compose, koneksi PostgreSQL, ketersediaan model di `backend/models/`, dan GPU render node (`/dev/dri/renderD128`) sebelum menyalakan container, lalu memverifikasi `/api/preflight` secara otomatis. Jika ada yang belum siap, skrip menampilkan rekomendasi perbaikan yang spesifik.

1. Siapkan environment & PostgreSQL (port default `5433`, database `stt_db`):
   ```sh
   cp .env.example .env
   docker run -d --name postgres_db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=stt_db -p 5433:5432 postgres:16
   ```
2. Jalankan skrip startup Docker:
   ```sh
   chmod +x start-docker.sh
   ./start-docker.sh --build
   ```
   Opsi lain:
   - `./start-docker.sh` : audit prasyarat, jalankan container, dan cek `/api/preflight`
   - `./start-docker.sh --logs` : ikuti log container secara live
   - `./start-docker.sh --down` : hentikan seluruh container Resmeet-STT
   - `RESMEET_GPU=off ./start-docker.sh` : jalankan tanpa passthrough GPU Vulkan
3. Buka `http://localhost:5173`. API diproksikan melalui `http://localhost:5173/api` dan tersedia langsung di `http://localhost:8200/api`.
4. Pada database kosong, buat akun superadmin melalui pop-up setup awal (password minimal 12 karakter). Gateway AI dan ID model dapat diatur di menu **Pengaturan**.

---

## Menjalankan Lokal Tanpa Docker (`./start-non-docker.sh`)

Skrip `./start-non-docker.sh` menjalankan backend API, worker transkripsi, worker AI, dan Vite React frontend secara native tanpa container Resmeet. Sebelum memulai proses, skrip memverifikasi `backend/.env`, Rust (`cargo`/`rustc`), Node.js & npm, `ffmpeg`, `whisper-server` atau `faster-whisper`, file model, koneksi PostgreSQL lokal, serta konflik port `8200`/`5173`. Jika ada dependensi yang belum tersedia, skrip menghentikan startup dan menampilkan daftar langkah instalasinya.

1. Siapkan prasyarat host (Rust, Node.js >= 20, FFmpeg, PostgreSQL lokal, serta `whisper-server` atau venv `faster-whisper`):
   ```sh
   sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev ffmpeg
   cp backend/.env.example backend/.env
   # Pastikan DB_HOST=127.0.0.1 di backend/.env
   ```
2. Jalankan skrip startup lokal:
   ```sh
   chmod +x start-non-docker.sh
   ./start-non-docker.sh
   ```

---

## Pemeriksaan & Verifikasi

- `cargo check --manifest-path backend/Cargo.toml`
- `cargo test --locked --manifest-path backend/Cargo.toml`
- `npm run build --prefix frontend`
- `npm run lint --prefix frontend`
- `npm test --prefix frontend`
- `curl http://localhost:8200/api/health`
- `curl http://localhost:8200/api/preflight`

Halaman **Status Sistem & Kesiapan** dan banner peringatan preflight di UI memeriksa koneksi PostgreSQL, FFmpeg, mesin transkripsi, model aktif, izin tulis folder upload, dan heartbeat worker transkripsi secara real-time. Jika ada komponen yang belum siap, tombol transkripsi dikunci dan UI menampilkan komponen yang gagal beserta langkah perbaikannya.

---

## Arsitektur Pemrosesan & Optimasi Kecepatan

| Service Container | Peran (`APP_ROLE`) | Konfigurasi Bawaan |
| --- | --- | --- |
| `resmeet_backend` | API Autentikasi PBKDF2, upload streaming, antrean, DOCX API, preflight | `APP_ROLE=api`, `0.5` CPU, port `8200` |
| `resmeet_worker` | Normalisasi FFmpeg, VAD, chunking 45 detik, `EnginePool` paralel | `APP_ROLE=worker`, `4.0` CPU, GPU `/dev/dri/renderD128` |
| `resmeet_ai_worker` | Perapian transkrip & penyusunan MoM terpisah (opsional) | `APP_ROLE=ai-worker`, `0.5` CPU |
| `resmeet_frontend` | React 19 + `@docx-editor.dev` + Markmap via Nginx reverse proxy | Port `5173` |

Optimasi performa diterapkan tanpa menurunkan kualitas bobot model **`large-v3-turbo`**:
- **Silero VAD (`ggml-silero-v6.2.0.bin`)**: pemangkasan segmen hening agresif (`-vt 0.50`, `-vspd 250`, `-vsd 100`, `-vp 50`, `-vo 0.10`).
- **Non-fallback decoding**: `-nf` dan `temperature=0.0` meniadakan re-decoding loop saat jeda kalimat/batuk.
- **Chunking 45 detik berbasis jeda napas**: `STT_CHUNK_SECONDS=45` memakai `silencedetect=noise=-35dB:d=0.3` dengan overlap aman +-0.5 detik.
- **Filter audio FFmpeg**: `-af "highpass=f=80,lowpass=f=7500,afftdn=nf=-25"` membersihkan dengung rendah dan desis statis.
- **GPU Vulkan default & paralelisasi**: otomatis memprioritaskan GPU Vulkan (`/dev/dri/renderD128`) dengan CPU INT8 sebagai cadangan, serta memproses `STT_CONCURRENCY=2` chunk sekaligus lewat `EnginePool` di `pipeline.rs`.

Unggahan memakai `POST /api/upload-and-transcribe?background=true` (HTTP 202) dengan checkpoint atomik di tabel `transcription_chunks` dan penguncian worker di PostgreSQL (`FOR UPDATE SKIP LOCKED` + heartbeat kontinu).
