# 🎙️ Resmeet-STT: Enterprise Meeting Notetaker & Speech-to-Text

Resmeet-STT adalah platform transkripsi audio rapat otomatis dan pembuat dokumen **Minutes of Meeting (MoM)** cerdas berbasis **Bun.js + TypeScript** (Port default **8200**), engine native C++ **whisper.cpp**, ekstraksi topik terarah **Jev-ultrafast Guided Topics**, dukungan multi-database **SQLite (Default Mandiri), MySQL, & PostgreSQL** dengan tombol migrasi in-app, serta visualisasi pohon pemikiran **Markmap Mindmap**.

---

## ⚡ Unduh Aplikasi Desktop (Langsung Pakai Tanpa Git Clone)

Bagi pengguna yang ingin langsung menggunakan aplikasi tanpa perlu `git clone` atau konfigurasi terminal, silakan unduh versi desktop siap pakai:

| Platform | Format File | Tipe Arsitektur | Tautan Unduhan Langsung |
|---|---|---|---|
| **macOS** | `.dmg` | Apple Silicon (M1/M2/M3/M4) & Intel Universal | 🍏 [**Unduh Resmeet-STT-macOS.dmg**](https://github.com/ybwhocodes/Resmeet-Stt/releases/latest/download/Resmeet-STT-macOS.dmg) |
| **Windows** | `.exe` | Windows 10 / 11 64-bit (Installer & Portable) | 🪟 [**Unduh Resmeet-STT-Windows-Setup.exe**](https://github.com/ybwhocodes/Resmeet-Stt/releases/latest/download/Resmeet-STT-Windows-Setup.exe) |

> 💡 **Informasi Dokumentasi:** Panduan lengkap mulai dari instalasi, fitur, hingga penggunaan dapat diakses di file portal [docs/index.html](file:///Volumes/SSD%20-%20%20Mac/Server/Resmeet-Stt/docs/index.html) atau via browser di `http://localhost:5173/docs/index.html`.

### 🔄 2 Mode Penggunaan Aplikasi:
1. **Mode Program Lokal (Desktop Standalone):**
   - Cukup unduh `.dmg` atau `.exe` dan jalankan.
   - Menggunakan database **SQLite** bawaan (`resmeet.sqlite`) yang **otomatis dibuat** saat aplikasi pertama kali dibuka (Zero Configuration).
   - Tidak memerlukan server MySQL, tidak memerlukan Docker, dan tidak memerlukan terminal command.
2. **Mode Web Server (Enterprise / Tim Kantor):**
   - Menjalankan backend server Bun pada **Port default 8200** dan frontend Vite pada port **5173** (atau via Docker Compose).
   - Mendukung multi-database terpusat (**SQLite, MySQL, atau PostgreSQL**) yang dapat dikonfigurasi melalui menu Pengaturan.

---

## 🌟 Fitur Utama

- **⚡ Runtime Bun.js Super Cepat (Port 8200):** Concurrency tinggi, startup instan, konsumsi RAM sangat rendah (<100MB), dan streaming progress WebSocket Socket.IO realtime.
- **🎙️ Dual Sumber Audio (Unggah Berkas & Rekam Langsung dari Browser):**
  - **Dropdown Pemilih Sumber:** Pengguna dapat beralih antara *📁 Unggah File Audio* dan *🎙️ Rekam Langsung dari Browser*.
  - **Mode Unggah:** Mendukung drag-and-drop file audio (`.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.webm`, `.aac`) dan file video (`.mp4`, `.mpeg`, `.mpg`, `.m4v`).
  - **Mode Rekam Langsung Browser:** Merekam percakapan langsung melalui mikrofon dengan live waveform visualizer, penghitung durasi (timer), kontrol Jeda (Pause) / Lanjutkan (Resume), Batal, Selesai, serta pratinjau player dan opsi rekam ulang.
- **🗄️ Multi-Database Storage, Set Default Driver & Tombol Migrasi In-App:**
  - **Tombol "Set Default Database":** Tersedia tombol 'Set Default' untuk SQLite, MySQL, maupun PostgreSQL dengan indikator badge 'Default Aktif' realtime di header panel dan kartu pilihan.
  - **SQLite (Default Mandiri):** Aktif otomatis out-of-the-box tanpa konfigurasi eksternal. Tabel `transcripts` langsung siap dipakai tanpa tombol migrasi.
  - **MySQL & PostgreSQL:** Dapat dihubungkan ke server kantor. Dilengkapi tombol **Uji Koneksi**, tombol **Migrate Database**, dan tombol **Set Default** untuk menyimpan konfigurasi permanen ke `settings.json`.
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

### Langkah 3: Menyiapkan Database (SQLite Default / MySQL / PostgreSQL)
- **SQLite (Paling Mudah - Default Tanpa Setup):**
  Anda **dapat melewati langkah ini sepenuhnya** jika tidak memiliki MySQL. Resmeet-STT secara otomatis menggunakan database **SQLite lokal** (`backend/resmeet.sqlite`) dan langsung membuat tabel `transcripts` saat backend pertama kali dijalankan.
- **MySQL / PostgreSQL (Penyimpanan Server Terpusat):**
  Jika ingin menggunakan MySQL, jalankan 1 baris container Docker berikut:
  ```bash
  docker run -d \
    --name mysql_db \
    -p 3307:3306 \
    -e MYSQL_ROOT_PASSWORD=password \
    -e MYSQL_DATABASE=stt_db \
    mysql:8.0
  ```
  *Catatan:* Di menu **Pengaturan**, tersedia tombol **Uji Koneksi** dan tombol **Migrate Database** yang otomatis membuat database serta tabel jika driver MySQL/PostgreSQL dipilih.

---

### Langkah 4: Konfigurasi Environment Backend
Salin file `.env.example` menjadi `.env`:

```bash
cp backend/.env.example backend/.env
```

Buka file `backend/.env` dan sesuaikan parameter Anda (Port default adalah **8200**):
```env
# Server Port (Default 8200)
PORT=8200

# Tipe Database: sqlite | mysql | postgres (Default: sqlite)
DB_TYPE=sqlite

# Konfigurasi jika menggunakan MySQL / PostgreSQL
DB_HOST=127.0.0.1
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
Skrip ini otomatis memeriksa dependensi, menyiapkan SQLite/MySQL, menjalankan backend Bun (Port 8200), dan frontend Vite secara bersamaan:

```bash
# Berikan izin eksekusi
chmod +x start.sh

# Jalankan seluruh stack
./start.sh
```

#### Pilihan B: Menggunakan Docker Compose (Full Container)
Jika Anda ingin seluruh stack (MySQL, Bun Backend Port 8200, dan Frontend) berjalan terisolasi di dalam container:

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
# Server akan aktif di http://localhost:8200
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
   - Pastikan indikator **Preflight Status Checklist** semua berwarna hijau.
   - Periksa bagian **Penyimpanan Database**: secara default **SQLite** aktif mandiri. Jika memilih MySQL atau Postgres, masukkan data koneksi lalu klik tombol **Migrate Database**.
   - Masukkan AI URL & API-Key Anda, lalu klik tombol **Uji Koneksi AI**.
3. Kembali ke menu **Transkripsi**:
   - Pilih sumber audio via dropdown: **📁 Unggah File Audio** atau **🎙️ Rekam Langsung dari Browser**.
   - Jika memilih *Unggah File*: Tarik & lepas file audio/video rapat Anda (`.mp4`, `.mpeg`, `.m4a`, `.mp3`, `.wav`, `.aac`, dll.).
   - Jika memilih *Rekam Langsung*: Klik tombol mikrofon merah, rekam percakapan rapat, gunakan tombol Jeda (Pause) jika perlu jeda, lalu klik **Selesai Merekam**.
   - Pilih **Combo Pipeline** (Combo 1 untuk akurasi tertinggi).
   - Klik **Mulai Transkripsi**.
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
├── scripts/
│   └── build-desktop.sh          # Script kompilasi desktop (.dmg, .exe, standalone)
├── desktop/                      # Wrapper native desktop (Electron + electron-builder)
│   ├── package.json              # Konfigurasi target installer DMG & EXE
│   ├── main.cjs                  # Main process Electron window
│   └── preload.cjs               # Script preload konteks aman
├── release/                      # Direktori output installer .dmg, .exe, dan binary
├── backend/
│   ├── Dockerfile                # Dockerfile Backend (Bun + Whisper.cpp + Python)
│   ├── package.json              # Konfigurasi dependensi Bun backend
│   ├── tsconfig.json             # Konfigurasi TypeScript
│   ├── schema.sql                # Skema database MySQL
│   ├── resmeet.sqlite            # Database SQLite mandiri (dibuat otomatis)
│   ├── .env.example              # Template variabel lingkungan bebas rahasia
│   ├── settings.json             # Konfigurasi AI & Parafrase persisten
│   ├── models/                   # Bobot model GGML (large-v3-turbo, base)
│   ├── knowledge/                # Acuan RAG (format-mom.md, glossary.md, dll)
│   ├── transcripts_md/           # Arsip dokumen notulen Markdown tersimpan
│   └── src/
│       ├── index.ts              # HTTP & Socket.IO server Bun (Port 8200)
│       ├── config.ts             # AppSettings & environment loader
│       ├── db.ts                 # Multi-database driver (SQLite, MySQL, Postgres)
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

## 📦 Panduan Build / Packaging Aplikasi Desktop (.DMG & .EXE)

Jika Anda ingin membangun file installer desktop sendiri dari kode sumber:

### Opsi 1: Menggunakan Script Build Otomatis (Rekomendasi)
Tersedia skrip yang mengompilasi frontend Vite, backend standalone, dan installer desktop:

```bash
# Berikan izin eksekusi jika pertama kali
chmod +x scripts/build-desktop.sh

# Jalankan proses build
./scripts/build-desktop.sh
```
File hasil kompilasi akan otomatis tersimpan di dalam folder `release/`:
- **macOS:** `release/resmeet-mac` dan installer `.dmg`
- **Windows:** `release/resmeet-win.exe` dan installer setup `.exe`

### Opsi 2: Kompilasi Standalone Binary via Bun (Super Cepat & Hemat Ukuran)
Tanpa Electron, Anda dapat membuat executable binary mandiri yang langsung mengintegrasikan SQLite lokal:

```bash
# Kompilasi native macOS (Apple Silicon arm64 & Intel x64)
bun build --compile --minify backend/src/index.ts --outfile release/resmeet-mac

# Kompilasi executable native Windows (.exe)
bun build --compile --minify --target=bun-windows-x64 backend/src/index.ts --outfile release/resmeet-win.exe
```

### Opsi 3: Packaging via Electron Builder
```bash
cd desktop

# Install dependensi electron & electron-builder
npm install

# Build installer macOS (.DMG)
npm run dist:mac

# Build installer Windows (.EXE Installer & Portable)
npm run dist:win
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
