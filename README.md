# 🎙️ Resmeet-STT: Enterprise Meeting Notetaker & Speech-to-Text

Resmeet-STT adalah sistem transkripsi audio rapat otomatis dan pembuat dokumen **Minutes of Meeting (MoM)** berbasis **Bun.js + TypeScript**, engine C++ **whisper.cpp**, ekstraksi topik terarah **Jev-Guided**, dan visualisasi pohon pemikiran **Markmap Mindmap**.

Dilengkapi dengan antarmuka web modern, streaming progress realtime via WebSocket Socket.IO, penyimpanan database MySQL, dan ekspor 3 format dokumen rapat lengkap.

---

## 🌟 Fitur Utama

- **⚡ Runtime Bun.js Super Cepat:** Concurrency tinggi, konsumsi RAM rendah (<100MB), dan performa I/O instan.
- **🧠 Engine Whisper.cpp (GGML Q5):** Kuantisasi `large-v3-turbo-q5_0` (546MB) dengan akselerasi Apple Silicon Metal / CPU NEON untuk inferensi cepat tanpa lag.
- **🎛️ 3 Pilihan Combo Pipeline Sebelum Running:**
  1. **Combo 1:** Akurasi Tertinggi *(DeepFilter-Net+, NoiseReduce, VAD + Fast-Whisper Turbo)*.
  2. **Combo 2:** Ultra Cepat & Ringan *(DeepFilter-Net+, NoiseReduce, ggml-base.bin <3s)*.
  3. **Combo 3:** Neural VAD ONNX *(Silero-VAD ONNX runtime + Speech Padding 250ms & Comfort Gap)*.
- **📑 3 Format Output Rapat Interaktif:**
  1. **Format .MD (MoM):** Dokumen notulen resmi berstandar Markdown lengkap (Unduh `.md`, `.txt`, dan Salin).
  2. **Rangkuman HTML / UI:** Dashboard kartu visual rapat interaktif + tombol **Unduh Rangkuman HTML mandiri**.
  3. **Mindmap Diskusi (Markmap):** Diagram pohon topik interaktif berbasis [Markmap.js.org](https://markmap.js.org/) (zoom, pan, expand/collapse, Unduh HTML mandiri & SVG).
- **✍️ Pilihan Tipe Parafrase AI di Pengaturan:**
  - *Poin-poin Penting:* Ringkasan poin bernomor yang singkat, padat, dan to-the-point.
  - *Detail & Deskriptif:* Pembahasan komprehensif latar belakang, argumen, dan langkah operasional.
  - *Ringkasan Eksekutif:* Format tingkat manajemen untuk para pengambil keputusan.
- **🗃️ Halaman Riwayat Khusus Multi-Kolom:**
  - Tampilan kolom: File Audio/ID, Tanggal, Durasi, Status AI, Cuplikan Notulen, dan Aksi.
  - Klik baris untuk membuka **Halaman Detail Lengkap**.
  - Dilengkapi tombol **Hapus Riwayat** yang aman.
- **📖 Dokumentasi Mandiri:** Tersedia halaman portal dokumentasi lengkap di `docs/index.html` dan `http://localhost:5173/docs/index.html`.

---

## 🚀 Panduan Setup & Menjalankan

### Cara 1: 1-Click Startup Script (Paling Mudah)
Jalankan satu perintah ini di terminal untuk langsung mengaktifkan MySQL, Backend Bun, dan Frontend Vite secara bersamaan:

```bash
# Berikan izin eksekusi jika pertama kali
chmod +x start.sh

# Jalankan seluruh stack
./start.sh
```

Aplikasi langsung siap diakses pada:
- **Frontend Web:** [http://localhost:5173](http://localhost:5173)
- **Backend API:** [http://localhost:8081](http://localhost:8081)
- **Dokumentasi Interaktif:** [http://localhost:5173/docs/index.html](http://localhost:5173/docs/index.html) (atau buka langsung `docs/index.html`)

*(Tekan `CTRL + C` di terminal untuk menghentikan seluruh layanan secara bersih).*

---

### Cara 2: Docker Compose (Full Container)
Jika ingin menjalankan seluruh sistem di dalam container Docker yang terisolasi:

```bash
# 1. Pastikan model GGML sudah ada di backend/models/
# (ggml-large-v3-turbo-q5_0.bin dan ggml-base.bin)

# 2. Build dan jalankan seluruh container
docker compose up -d

# 3. Pantau log sistem
docker compose logs -f

# 4. Menghentikan container
docker compose down
```

---

### Cara 3: Setup Manual (Native)

#### Prasyarat
- **Bun.js** (`curl -fsSL https://bun.sh/install | bash`)
- **Node.js** (v18+) & **npm**
- **FFmpeg** (`brew install ffmpeg` di Mac)
- **whisper-cli** (`brew install whisper-cpp` atau compile dari sumber)
- **MySQL 8.0** aktif pada port `3307`

#### Langkah-langkah:
1. **Inisialisasi Database MySQL:**
   ```bash
   docker run -d --name mysql_db -p 3307:3306 \
     -e MYSQL_ROOT_PASSWORD=password \
     -e MYSQL_DATABASE=stt_db \
     mysql:8.0
   ```

2. **Jalankan Backend (Bun.js):**
   ```bash
   cd backend
   bun install
   bun run src/index.ts
   # Backend berjalan di http://0.0.0.0:8081
   ```

3. **Jalankan Frontend (React + Vite):**
   ```bash
   cd frontend
   npm install
   npm run dev
   # Frontend berjalan di http://localhost:5173
   ```

---

## 🎛️ Penjelasan 3 Combo Pipeline

| Combo | Komponen Pipeline | Karakteristik | Kapan Digunakan |
|---|---|---|---|
| **Combo 1** | DeepFilter-Net+, NoiseReduce, VAD + Fast-Whisper Turbo | **Akurasi Tertinggi (Rekomendasi)**.<br>Bobot Q5 546MB dengan Flash Attention. | Rapat formal, notulen direksi, evaluasi teknis, dan dokumen MoM detail. |
| **Combo 2** | DeepFilter-Net+, NoiseReduce, ggml-base.bin + VAD | **Ultra Cepat (<3s)**.<br>Bobot Base 141MB, sangat hemat RAM. | Audio jelas, voice memo pendek, atau server dengan spek minimalis. |
| **Combo 3** | DeepFilter-Net, NoiseReduce, Silero-VAD (ONNX) + Comfort Pad | **Neural VAD ONNX**.<br>Segmentasi suara neural via ONNX + padding 250ms & jeda hening alami. | Rapat panjang dengan banyak jeda hening agar kalimat tidak terpotong dan inferensi lebih cepat. |

---

## 📑 3 Format Output Hasil Rapat

1. **Format .MD (MoM):**
   - Dokumen Minutes of Meeting resmi format Markdown lengkap.
   - Dilengkapi tombol Unduh `.md`, Unduh `.txt`, dan Salin Markdown.
2. **Rangkuman HTML / UI:**
   - Visual dashboard interaktif yang merangkum ikhtisar rapat, agenda terarah, sasaran (goal), keputusan kunci (hijau), dan checklist aksi tindak lanjut (kuning).
   - Dilengkapi tombol **Unduh Rangkuman HTML** (`.html` mandiri siap cetak/simpan PDF).
3. **Mindmap Diskusi (Markmap):**
   - Visualisasi grafis pohon topik rapat interaktif berbasis Markmap.js.org.
   - Node dapat diklik untuk melipat atau memperluas cabang diskusi.
   - Dilengkapi tombol zoom in/out, fit view, Unduh Mindmap HTML mandiri, dan Unduh SVG.

---

## ⚙️ Konfigurasi Model AI & Parafrase

Buka menu **Pengaturan** pada antarmuka web untuk mengatur:
- **AI Base URL:** Endpoint OpenAI-compatible (misal: `http://localhost:20128/v1`, `https://api.openai.com/v1`, atau Ollama/vLLM).
- **API-Key:** Token API penyedia LLM Anda.
- **Model ID:** Contoh: `9R-Gemini`, `oc/jev-1.13-free`, `deepseek-chat`, `gpt-4o`.
- **Tipe Parafrase AI Default:**
  - *Poin-poin Penting:* Ringkas, to-the-point, dan berbutir nomor.
  - *Detail & Deskriptif:* Penjelasan mendalam latar belakang dan konteks tiap topik.
  - *Ringkasan Eksekutif:* Format strategis ringkas tingkat manajemen.
- **Preflight Check:** Verifikasi status kesiapan modul sistem secara live (*uploads, knowledge, ffmpeg, format_mom, whisper_model, database, ai_config*).

---

## 📁 Struktur Direktori

```text
Resmeet-STT/
├── start.sh                      # 1-Click Startup Script (MySQL, Backend, Frontend)
├── docker-compose.yml            # Konfigurasi Docker Compose seluruh stack
├── README.md                     # Panduan komprehensif ini
├── docs/
│   └── index.html                # Portal dokumentasi web interaktif mandiri
├── backend/
│   ├── Dockerfile                # Dockerfile Backend (Bun + Whisper.cpp + Python)
│   ├── package.json              # Konfigurasi dependensi Bun backend
│   ├── schema.sql                # Skema inisialisasi tabel MySQL
│   ├── settings.json             # Konfigurasi AI & Parafrase persisten
│   ├── models/                   # Bobot model GGML (large-v3-turbo, base)
│   ├── knowledge/                # Acuan RAG (format-mom.md, glossary.md, dll)
│   ├── transcripts_md/           # Arsip dokumen notulen Markdown tersimpan
│   └── src/
│       ├── index.ts              # HTTP & Socket.IO server Bun
│       ├── config.ts             # AppSettings & environment loader
│       ├── db.ts                 # MySQL pool & queries (termasuk deleteTranscript)
│       ├── whisper.ts            # whisper-cli launcher & combo runner
│       ├── ai.ts                 # Jev-guided topic extractor & AI paraphrase
│       ├── markdown.ts           # Generator format MoM Markdown resmi
│       └── scripts/
│           └── preprocess_combo.py # Filter audio DeepFilter & ONNX Silero-VAD
└── frontend/
    ├── Dockerfile                # Dockerfile Frontend (Nginx static server)
    ├── package.json              # Dependensi React, Vite, Tailwind, Markmap
    └── src/
        ├── App.jsx               # UI Navigasi (Transkripsi, Riwayat, Detail, Pengaturan)
        └── components/
            ├── MarkmapView.jsx   # Komponen visual Mindmap interaktif
            └── UiSummary.jsx     # Komponen dashboard rangkuman HTML/UI
```

---

## 📄 Lisensi
Resmeet-STT dikembangkan untuk efisiensi notulensi rapat cerdas, hemat memori, dan berkinerja tinggi.
