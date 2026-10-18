# 🎙️ Resmeet-STT: Enterprise Meeting Notetaker & Speech-to-Text

Resmeet-STT adalah platform transkripsi audio rapat otomatis dan pembuat dokumen **Minutes of Meeting (MoM)** cerdas berbasis **Bun.js + TypeScript**, engine native C++ **whisper.cpp**, ekstraksi topik terarah **Jev-ultrafast Guided Topics**, dan visualisasi pohon pemikiran **Markmap Mindmap**.

Dilengkapi dengan antarmuka web modern, streaming progress realtime via WebSocket Socket.IO, penyimpanan database MySQL, dan ekspor 3 format dokumen rapat lengkap (Markdown, HTML/UI, Mindmap).

---

## 🌟 Fitur Utama

- **⚡ Runtime Bun.js Super Cepat:** Concurrency tinggi, startup instan, konsumsi RAM sangat rendah (<100MB), dan streaming progress WebSocket Socket.IO realtime.
- **🧠 Engine Whisper.cpp (GGML Q5):** Kuantisasi `large-v3-turbo-q5_0` (546MB) dengan akselerasi Apple Silicon Metal / CPU NEON untuk inferensi cepat tanpa lag.
- **🎛️ 3 Pilihan Combo Pipeline Sebelum Running:**
  1. **Combo 1:** Akurasi Tertinggi *(DeepFilter-Net+, NoiseReduce, VAD + Fast-Whisper Turbo)*.
  2. **Combo 2:** Ultra Cepat & Ringan *(DeepFilter-Net+, NoiseReduce, ggml-base.bin <3s)*.
  3. **Combo 3:** Neural VAD ONNX *(Silero-VAD ONNX runtime + Speech Padding 250ms & Comfort Gap)*.
- **📑 3 Format Output Rapat Lengkap:**
  1. **Format .MD (MoM):** Notulen resmi berstandar Markdown lengkap (Unduh `.md`, `.txt`, dan Salin).
  2. **Rangkuman HTML / UI:** Dashboard kartu visual rapat interaktif + tombol **Unduh Rangkuman HTML mandiri**.
  3. **Mindmap Diskusi (Markmap):** Diagram pohon topik interaktif berbasis [Markmap.js.org](https://markmap.js.org/) (zoom, pan, expand/collapse, Unduh HTML mandiri & SVG).
- **✍️ Pilihan Tipe Parafrase AI Berbobot (Pengaturan & Toolbar):**
  - *Poin-poin Penting:* Deskripsi to-the-point, padat, dan cepat dipindai pembaca (**minimal 2 paragraf per poin/topik**) dengan penjelasan konteks yang terarah.
  - *Detail & Deskriptif:* Uraian komprehensif latar belakang, dinamika argumen peserta, rincian teknis aksi (**minimal 4 paragraf panjang**) ditambah insight & analisis deskriptif mendalam agar pembaca yang tidak hadir paham seutuhnya.
  - *Ringkasan Eksekutif:* Format strategis tingkat manajemen pengambil keputusan (**minimal 2 paragraf per poin**) dilengkapi konteks serta analisis pro-kontra dari setiap keputusan.
- **🗃️ Halaman Riwayat Khusus Multi-Kolom:**
  - Tampilan kolom: File Audio/ID, Tanggal, Durasi, Status AI, Cuplikan Notulen, dan Aksi.
  - Klik baris untuk membuka **Halaman Detail Lengkap** dengan 3 tab output.
  - Dilengkapi tombol **Hapus Riwayat** yang aman.
- **📖 Dokumentasi Mandiri:** Tersedia halaman portal dokumentasi lengkap di `docs/index.html` dan `http://localhost:5173/docs/index.html`.

---

## 📋 Kebutuhan Sistem & Dependensi (Prerequisites)

Sebelum menjalankan aplikasi, pastikan sistem Anda telah memiliki dependensi berikut:

| Dependensi | Versi Minimal | Fungsi Utama | Cara Install Singkat |
|---|---|---|---|
| **Git** | Terkini | Clone repository proyek | Bawaan OS / `brew install git` |
| **Bun.js** | >= 1.0 | Runtime backend TypeScript super cepat | `curl -fsSL https://bun.sh/install \| bash` |
| **Node.js & npm** | Node >= 18 | Build dan development frontend Vite | `brew install node` / [nodejs.org](https://nodejs.org) |
| **Docker & Docker Compose** | Terkini *(Opsional/Disarankan)* | Menjalankan MySQL tanpa instalasi manual | [docker.com](https://www.docker.com) |
| **MySQL** | 8.0 (Port 3307/3306) | Menyimpan data transkrip, topik, & notulen | Otomatis via container Docker |
| **FFmpeg** | Terkini | Konversi format dan normalisasi sample rate audio | `brew install ffmpeg` / `apt install ffmpeg` |
| **whisper-cli (whisper.cpp)** | Terkini | Engine transkripsi C++ native berkecepatan tinggi | `brew install whisper-cpp` / build dari sumber |
| **Python** | 3.10+ | Filter preprocessing audio dan Silero-VAD ONNX | `python3 -m pip install numpy scipy soundfile noisereduce onnxruntime torch` |
| **AI LLM Gateway** | OpenAI-compatible | Jev-ultrafast Guided Topics & Parafrase MoM | OpenAI, OpenRouter, DeepSeek, Ollama, atau 9Router lokal |

---

## 🚀 Panduan Setup Lengkap: Dari Nol Hingga Berjalan

### Langkah 1: Clone Repository
Buka terminal Anda dan clone repository menggunakan SSH atau HTTPS:

```bash
# Menggunakan SSH (Rekomendasi)
git clone git@github.com:ybwhocodes/Resmeet-Stt.git

# ATAU menggunakan HTTPS
git clone https://github.com/ybwhocodes/Resmeet-Stt.git

# Masuk ke folder proyek
cd Resmeet-Stt
```

---

### Langkah 2: Unduh Bobot Model Whisper GGML
Aplikasi menggunakan format model GGML yang dioptimasi untuk Whisper.cpp. Buat folder `backend/models` dan unduh model yang dibutuhkan:

```bash
mkdir -p backend/models

# 1. Model Utama: Large-v3-Turbo Q5_0 (~546 MB) - Akurasi Tertinggi (Combo 1 & 3)
curl -L -o backend/models/ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin

# 2. Model Cepat: Base (~141 MB) - Kecepatan Super (<3s) (Combo 2)
curl -L -o backend/models/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

---

### Langkah 3: Siapkan Database MySQL
Aplikasi membutuhkan database MySQL bernama `stt_db` pada port `3307`. Cara termudah adalah menjalankannya menggunakan Docker:

```bash
docker run -d \
  --name mysql_db \
  -p 3307:3306 \
  -e MYSQL_ROOT_PASSWORD=password \
  -e MYSQL_DATABASE=stt_db \
  mysql:8.0
```

> **Catatan:** Backend Bun.js memiliki fitur auto-migration, sehingga tabel `transcripts` beserta seluruh kolom (`directed_topics`, `ai_data`, dll.) akan dibuat secara otomatis saat backend pertama kali dijalankan.

---

### Langkah 4: Konfigurasi Environment Backend
Salin file `.env.example` menjadi `.env`:

```bash
cp backend/.env.example backend/.env
```

Buka file `backend/.env` dan sesuaikan parameter AI Anda (URL & API-Key):
```env
# MySQL Connection
DB_HOST=localhost
DB_PORT=3307
DB_NAME=stt_db
DB_USER=root
DB_PASSWORD=password

# Whisper Model Default
WHISPER_MODEL=large-v3-turbo

# AI LLM Settings (OpenAI-compatible / OpenRouter / Ollama / 9Router)
AI_BASE_URL=http://localhost:20128/v1
AI_API_KEY=sk-ff353870199354cb-rvq507-8ef93405
AI_MODEL_ID=9R-Gemini
AI_TIMEOUT_S=120
AI_ENABLE_CORRECTION=true
```

---

### Langkah 5: Menjalankan Aplikasi

Anda dapat memilih salah satu dari 3 cara berikut:

#### Pilihan A: Menggunakan 1-Click Startup Script (Paling Mudah)
Skrip ini akan otomatis memeriksa dependensi, menghidupkan MySQL, menjalankan backend Bun, dan frontend Vite secara bersamaan:

```bash
# Berikan izin eksekusi
chmod +x start.sh

# Jalankan seluruh stack
./start.sh
```

#### Pilihan B: Menggunakan Docker Compose (Full Container)
Jika Anda ingin seluruh stack (MySQL, Bun Backend, dan Frontend Nginx) berjalan terisolasi di dalam container:

```bash
# Build dan jalankan seluruh container di background
docker compose up -d

# Pantau status log
docker compose logs -f

# Menghentikan layanan
docker compose down
```

#### Pilihan C: Menjalankan Secara Manual (Step-by-Step)
Buka 2 tab terminal terpisah:

**Terminal 1 — Backend (Bun.js):**
```bash
cd backend

# Install dependensi Bun
bun install

# Install pustaka Python untuk filter audio & VAD
pip install numpy scipy soundfile noisereduce onnxruntime torch

# Jalankan server Bun
bun run src/index.ts
# Server akan aktif di http://localhost:8081
```

**Terminal 2 — Frontend (React + Vite):**
```bash
cd frontend

# Install dependensi frontend
npm install

# Jalankan dev server Vite
npm run dev
# Frontend akan aktif di http://localhost:5173
```

---

### Langkah 6: Buka Aplikasi & Verifikasi
1. Buka browser Anda dan akses: **[http://localhost:5173](http://localhost:5173)**.
2. Buka menu **Pengaturan** di bilah navigasi atas:
   - Pastikan indikator **Preflight Status Checklist** semua berwarna hijau (*uploads_writable, knowledge_readable, transcripts_md_writable, ffmpeg, format_mom, whisper_model, database, ai_config*).
   - Masukkan AI URL & API-Key Anda, lalu klik tombol **Uji Koneksi AI**.
3. Kembali ke menu **Transkripsi**:
   - Tarik & lepas file audio/suara rapat Anda (`.mp4`, `.mpeg`, `.m4a`, `.mp3`, `.wav`, `.aac`, dll.).
   - Pilih **Combo Pipeline** (Combo 1 untuk akurasi tertinggi).
   - Klik **Mulai Transkripsi & Analisis**.
4. Setelah selesai, jelajahi **3 Format Output**:
   - **Tab 1: Format .MD (MoM)** — Notulen lengkap format Markdown.
   - **Tab 2: Rangkuman HTML/UI** — Kartu topik, keputusan, checklist aksi tindak lanjut interaktif, dan tombol download HTML mandiri.
   - **Tab 3: Mindmap (Markmap)** — Diagram pohon visual interaktif yang dapat diperbesar/diperkecil dan diunduh sebagai SVG / HTML.

---

## 🎛️ Penjelasan 3 Combo Pipeline

| Combo | Komponen Pipeline | Karakteristik & Kecepatan | Kapan Digunakan |
|---|---|---|---|
| **Combo 1** | DeepFilter-Net+, NoiseReduce, VAD + Fast-Whisper Turbo | **Akurasi Tertinggi (Rekomendasi)**.<br>Bobot Q5 546MB dengan Flash Attention. | Rapat formal direksi, diskusi teknis arsitektur, dan notulen keputusan krusial. |
| **Combo 2** | DeepFilter-Net+, NoiseReduce, ggml-base.bin + VAD | **Ultra Cepat (<3 detik)**.<br>Bobot Base 141MB, sangat hemat RAM (<300MB). | Audio dengan vokal jelas, voice note singkat, atau perangkat server dengan spek minimal. |
| **Combo 3** | DeepFilter-Net, NoiseReduce, Silero-VAD (ONNX) + Comfort Pad | **Neural VAD ONNX**.<br>Segmentasi neural ONNX dengan padding 250ms & comfort gap 150ms. | Rapat berdurasi panjang dengan banyak jeda hening agar kalimat tidak terpotong dan inferensi lebih cepat. |

---

## 📑 3 Format Output Rapat

1. **Format .MD (MoM):**
   - Dokumen Minutes of Meeting resmi format Markdown lengkap (Informasi Umum Rapat, Agenda, Pembahasan, Tabel Keputusan, Tabel Action Items, Jadwal Berikutnya).
   - Dilengkapi tombol Unduh `.md`, Unduh `.txt`, dan Salin Markdown.
2. **Rangkuman HTML / UI:**
   - Visual dashboard interaktif yang merangkum ikhtisar rapat, agenda bahasan, sasaran (Goal), keputusan resmi (hijau), dan checklist aksi tindak lanjut (kuning) yang dapat dicentang langsung.
   - Dilengkapi tombol **Unduh Rangkuman HTML** (`.html` mandiri siap cetak/simpan PDF).
3. **Mindmap Diskusi (Markmap):**
   - Visualisasi grafis pohon topik rapat interaktif berbasis [Markmap.js.org](https://markmap.js.org/).
   - Node dapat diklik untuk melipat atau memperluas cabang diskusi.
   - Dilengkapi tombol zoom in/out, fit view, Unduh Mindmap HTML mandiri, dan Unduh SVG.

---

## 📁 Struktur Direktori

```text
Resmeet-STT/
├── start.sh                      # 1-Click Startup Script (MySQL, Backend Bun, Frontend Vite)
├── docker-compose.yml            # Konfigurasi Docker Compose seluruh stack
├── README.md                     # Dokumentasi panduan komprehensif ini
├── docs/
│   └── index.html                # Portal dokumentasi web interaktif mandiri (GitHub Pages)
├── backend/
│   ├── Dockerfile                # Dockerfile Backend (Bun + Whisper.cpp + Python)
│   ├── package.json              # Konfigurasi dependensi Bun backend
│   ├── tsconfig.json             # Konfigurasi TypeScript
│   ├── schema.sql                # Skema database MySQL
│   ├── .env.example              # Template variabel lingkungan bebas rahasia
│   ├── settings.json             # Konfigurasi AI & Parafrase persisten
│   ├── models/                   # Bobot model GGML (large-v3-turbo, base)
│   ├── knowledge/                # Acuan RAG (format-mom.md, glossary.md, dll)
│   ├── transcripts_md/           # Arsip dokumen notulen Markdown tersimpan
│   └── src/
│       ├── index.ts              # HTTP & Socket.IO server Bun
│       ├── config.ts             # AppSettings & environment loader
│       ├── db.ts                 # MySQL pool & queries (auto-migration & delete)
│       ├── whisper.ts            # whisper-cli launcher & combo runner
│       ├── ai.ts                 # Jev-guided topic extractor & AI paraphrase
│       ├── markdown.ts           # Generator format MoM Markdown resmi
│       └── scripts/
│           └── preprocess_combo.py # Filter audio DeepFilter & ONNX Silero-VAD
└── frontend/
    ├── Dockerfile                # Dockerfile Frontend (Nginx static server)
    ├── package.json              # Dependensi React, Vite, Tailwind, Markmap
    ├── vite.config.js            # Konfigurasi bundler Vite
    ├── public/
    │   └── docs/index.html       # Mirror dokumentasi statis di aplikasi
    └── src/
        ├── App.jsx               # UI Navigasi (Transkripsi, Riwayat, Detail, Pengaturan)
        └── components/
            ├── MarkmapView.jsx   # Komponen visual Mindmap interaktif
            └── UiSummary.jsx     # Komponen dashboard rangkuman HTML/UI & parser MoM
```

---

## 🛠️ Pemecahan Masalah (Troubleshooting)

### 1. `whisper-cli: command not found`
- **macOS:** Jalankan `brew install whisper-cpp`.
- **Linux/Manual:** Clone repo [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) dan jalankan `make`. Salin binary `whisper-cli` ke `/usr/local/bin/` atau `/opt/homebrew/bin/`.

### 2. Gagal koneksi database MySQL (`ECONNREFUSED 127.0.0.1:3307`)
- Pastikan container MySQL sedang berjalan: `docker ps`.
- Jika belum berjalan, jalankan: `docker start mysql_db` atau periksa apakah port `3307` sudah sesuai dengan `DB_PORT` di `backend/.env`.

### 3. Error Python Preprocessing `ModuleNotFoundError`
- Jalankan instalasi modul python di terminal:
  ```bash
  pip install numpy scipy soundfile noisereduce onnxruntime torch
  ```

---

## 📄 Lisensi
Resmeet-STT dikembangkan untuk efisiensi notulensi rapat cerdas, hemat memori, dan berkinerja tinggi. Dilisensikan di bawah [MIT License](LICENSE).
