# Frontend Setup dan Run

Frontend: React + Vite + Socket.IO client.

## Prasyarat

- Node.js 20.19+ atau 22.13+ direkomendasikan.
- Backend sudah jalan di `http://localhost:8081`.

Cek Node:

```bash
node -v
npm -v
```

## Setup

Masuk folder frontend:

```bash
cd frontend
```

Install dependency:

```bash
npm install
```

## Konfigurasi API

Frontend membaca backend URL dari environment Vite.

Buat file `.env.local` di folder `frontend` jika ingin override:

```env
VITE_API_BASE_URL=http://localhost:8081/api
```

Jika tidak ada `.env.local`, default tetap:

```text
http://localhost:8081/api
```

Untuk ngrok/contoh server remote:

```env
VITE_API_BASE_URL=https://example.ngrok-free.app/api
```

## Run Development

```bash
npm run dev
```

Buka URL yang muncul, biasanya:

```text
http://localhost:5173
```

## Build Production

```bash
npm run build
```

Preview hasil build:

```bash
npm run preview
```

## Fitur Yang Terhubung Ke Backend

- Upload file audio ke `POST /api/upload-and-transcribe`.
- Toggle `Koreksi AI` mengirim `ai_correction=true/false`.
- Toggle `Output Markdown` mengirim `output_format=md/json`.
- Progress realtime via Socket.IO.
- Preflight check via `GET /api/preflight`.
- Riwayat transkrip via `GET /api/transcripts`.
- Download `.txt` lokal dari teks final.
- Download `.md` dari `GET /api/jobs/<job_id>/download-md`.

## Urutan Run Full App

Terminal 1:

```bash
cd backend
source .venv/bin/activate
python app.py
```

Terminal 2:

```bash
cd frontend
npm run dev
```

## Troubleshooting

Frontend tidak connect backend:

- Pastikan backend jalan di `http://localhost:8081`.
- Cek `VITE_API_BASE_URL`.
- Refresh browser setelah ubah `.env.local`.

Socket disconnected:

- Backend belum jalan.
- URL backend salah.
- Ngrok URL berubah.

Build gagal native binding Vite:

```bash
npm install
npm run build
```

Warning engine Node:

- Upgrade Node ke versi yang diminta dependency.
- Build bisa tetap sukses, tapi versi Node lama bisa bikin masalah install.
