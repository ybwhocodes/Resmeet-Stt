# Konsep RAG Koreksi Transkrip

## Tujuan

Sistem ini menambahkan lapisan koreksi AI setelah transkripsi selesai. Hasil transkrip mentah dari Whisper tetap disimpan, lalu AI digunakan untuk:

- Mengoreksi ejaan dan tanda baca.
- Memperbaiki istilah teknis yang salah dengar.
- Mengenali istilah baru, konsep baru, nama produk, nama orang, nama tempat, singkatan, dan istilah domain.
- Menyimpan pengetahuan baru ke folder `knowledge`.
- Menggunakan pengetahuan lama untuk membantu koreksi transkrip berikutnya.
- Menghasilkan file Markdown akhir yang bisa diunduh.

Sistem tidak boleh mengubah makna utama pembicaraan. AI hanya boleh memperbaiki teks berdasarkan konteks transkrip dan knowledge yang tersedia.

## Konfigurasi Environment

Tambahkan konfigurasi AI provider di `.env`:

```env
AI_BASE_URL=https://api.example.com/v1
AI_API_KEY=isi_api_key_di_sini
AI_MODEL_ID=model-id-di-sini
AI_TIMEOUT_S=120
AI_ENABLE_CORRECTION=true
AI_ENABLE_KNOWLEDGE_EXTRACTION=true
AI_ENABLE_RAG=true
```

Catatan keamanan:

- `AI_API_KEY` wajib hanya disimpan di `.env`.
- Jangan pernah menyimpan API key di database, frontend, log, atau file Markdown.
- `.env` harus masuk `.gitignore`.
- Jika API key kosong, sistem harus tetap bisa berjalan tanpa koreksi AI.

## Struktur Folder Knowledge

Direktori yang disarankan:

```text
backend/
  knowledge/
    RAG.md
    format-mom.md
    glossary.md
    corrections.md
    concepts.md
    transcript-notes.md
  transcripts_md/
    <job_id>.md
```

Penjelasan:

- `RAG.md`: instruksi utama sistem RAG dan koreksi AI.
- `format-mom.md`: template format hasil transkrip akhir.
- `glossary.md`: daftar istilah penting dan ejaan benar.
- `corrections.md`: daftar pola salah dengar dan koreksi.
- `concepts.md`: konsep baru yang ditemukan dari transkrip.
- `transcript-notes.md`: catatan ringkas dari hasil transkrip sebelumnya.
- `transcripts_md/`: hasil akhir transkrip dalam format `.md` yang bisa diunduh.

## Format `format-mom.md`

File `backend/knowledge/format-mom.md` berisi template Markdown hasil akhir.

Contoh isi:

```markdown
# Minutes of Meeting

## Metadata

- File: {{filename}}
- Tanggal: {{created_at}}
- Durasi: {{duration_s}} detik
- Model STT: {{whisper_model}}
- Koreksi AI: {{ai_correction_status}}

## Ringkasan

{{summary}}

## Peserta / Entitas Terdeteksi

{{entities}}

## Transkrip Final

{{final_transcript}}

## Istilah Penting

{{terms}}

## Konsep Baru

{{concepts}}

## Koreksi Penting

{{corrections}}

## Action Items

{{action_items}}

## Catatan

{{notes}}
```

Jika field tidak tersedia, isi dengan `- Tidak ada`.

## Alur Proses

### 1. Upload Audio

User upload audio ke endpoint transkripsi.

Input minimal:

- `audioFile`
- optional `word_timestamps`
- optional `ai_correction`
- optional `output_format=md`

Contoh request:

```bash
curl -X POST http://localhost:8081/api/upload-and-transcribe \
  -F "audioFile=@meeting.mp3" \
  -F "ai_correction=true" \
  -F "output_format=md"
```

### 2. Preflight Check Sebelum Running

Sebelum transkripsi dijalankan, sistem wajib mengecek kesiapan.

Checklist:

- Folder `uploads/` tersedia dan bisa ditulis.
- Folder `knowledge/` tersedia dan bisa dibaca.
- Folder `transcripts_md/` tersedia dan bisa ditulis.
- FFmpeg tersedia jika preprocessing memakai FFmpeg.
- Database bisa terkoneksi.
- Model Whisper bisa diload atau didownload.
- Jika koreksi AI aktif:
  - `AI_BASE_URL` tersedia.
  - `AI_API_KEY` tersedia.
  - `AI_MODEL_ID` tersedia.
  - API provider bisa dihubungi.
  - Timeout disetel.
- Jika RAG aktif:
  - `format-mom.md` tersedia.
  - `glossary.md`, `corrections.md`, `concepts.md` boleh kosong tapi file/folder harus siap.

Jika preflight gagal:

- Job tidak lanjut ke transkripsi.
- Status job menjadi `failed`.
- Error ditampilkan jelas.
- File upload sementara dibersihkan.

Contoh response gagal:

```json
{
  "job_id": "abc123",
  "status": "failed",
  "error": "AI_API_KEY belum tersedia di .env"
}
```

### 3. Transkripsi Mentah

Whisper menghasilkan transkrip mentah.

Data yang disimpan:

- `raw_text`
- `segments`
- `duration_s`
- `language`
- `word_timestamps` jika diminta

Raw text harus tetap disimpan untuk audit dan perbandingan.

### 4. Ambil Knowledge Untuk RAG

Sebelum koreksi AI, sistem membaca file knowledge:

- `glossary.md`
- `corrections.md`
- `concepts.md`
- `transcript-notes.md`
- `format-mom.md`

Knowledge dipakai sebagai konteks prompt AI.

Batasan:

- Jangan kirim file terlalu besar langsung.
- Jika file knowledge besar, ambil bagian paling relevan saja.
- Untuk versi awal, cukup kirim seluruh file jika total masih kecil.
- Jika sudah besar, gunakan chunking + retrieval sederhana.

### 5. Koreksi AI

AI menerima:

- Transkrip mentah.
- Knowledge yang tersedia.
- Aturan koreksi.
- Format output yang diinginkan.

AI harus menghasilkan JSON terstruktur, bukan teks bebas.

Contoh output AI:

```json
{
  "corrected_text": "...",
  "summary": "...",
  "terms": [
    {
      "term": "Retrieval Augmented Generation",
      "alias": ["RAG"],
      "meaning": "Metode menggunakan knowledge eksternal untuk membantu model AI."
    }
  ],
  "corrections": [
    {
      "wrong": "rack",
      "correct": "RAG",
      "reason": "Konteks membahas retrieval augmented generation."
    }
  ],
  "concepts": [
    {
      "name": "Preflight check",
      "description": "Pengecekan kesiapan sistem sebelum job berjalan."
    }
  ],
  "action_items": [
    "Tambahkan endpoint download Markdown."
  ],
  "notes": [
    "Beberapa istilah teknis perlu dimasukkan ke glossary."
  ]
}
```

Jika AI gagal:

- Gunakan hasil transkrip mentah sebagai fallback.
- Status koreksi: `failed`.
- Jangan gagal total jika transkripsi sudah berhasil.
- Jangan simpan knowledge baru dari hasil AI yang gagal.

### 6. Update Knowledge

Setelah koreksi berhasil, sistem bisa memperbarui file knowledge.

Aturan update:

- Tambah istilah baru ke `glossary.md`.
- Tambah pola salah dengar ke `corrections.md`.
- Tambah konsep baru ke `concepts.md`.
- Tambah catatan ringkas ke `transcript-notes.md`.
- Jangan duplikasi istilah yang sudah ada.
- Jangan overwrite seluruh file tanpa backup/merge aman.
- Simpan perubahan secara append-only untuk versi awal.

Format `glossary.md`:

```markdown
# Glossary

## RAG

- Ejaan benar: RAG
- Nama lengkap: Retrieval Augmented Generation
- Arti: Metode menggunakan knowledge eksternal untuk membantu model AI.
- Sumber: job_id={{job_id}}
```

Format `corrections.md`:

```markdown
# Corrections

## rack -> RAG

- Salah dengar: rack
- Koreksi: RAG
- Alasan: Konteks membahas Retrieval Augmented Generation.
- Sumber: job_id={{job_id}}
```

Format `concepts.md`:

```markdown
# Concepts

## Preflight Check

- Deskripsi: Pengecekan kesiapan sistem sebelum job berjalan.
- Sumber: job_id={{job_id}}
```

### 7. Generate Markdown Final

Sistem membaca `format-mom.md`, lalu mengisi placeholder.

Output disimpan ke:

```text
backend/transcripts_md/<job_id>.md
```

Isi minimal:

- Metadata.
- Ringkasan.
- Transkrip final.
- Istilah penting.
- Konsep baru.
- Koreksi penting.
- Action items.
- Catatan.

Endpoint download:

```http
GET /api/transcripts/{id}/download-md
```

Atau berdasarkan job:

```http
GET /api/jobs/{job_id}/download-md
```

Response:

```http
Content-Type: text/markdown
Content-Disposition: attachment; filename="transcript-<job_id>.md"
```

## Prompt Sistem AI

Gunakan prompt seperti ini:

```text
Anda adalah AI korektor transkrip bahasa Indonesia.

Tugas:
1. Koreksi ejaan, tanda baca, kapitalisasi, istilah teknis, dan salah dengar.
2. Pertahankan makna asli pembicara.
3. Jangan menambah informasi yang tidak ada di transkrip.
4. Gunakan knowledge sebagai referensi koreksi.
5. Jika ragu, pertahankan teks asli.
6. Ekstrak istilah baru, konsep baru, koreksi penting, action items, dan catatan.
7. Output wajib JSON valid.

Larangan:
- Jangan mengarang fakta.
- Jangan menghapus bagian penting.
- Jangan mengganti istilah tanpa alasan dari konteks.
- Jangan menampilkan API key atau data rahasia.
- Jangan output Markdown pada tahap koreksi JSON.

Knowledge:
{{knowledge_context}}

Transkrip mentah:
{{raw_transcript}}

Output JSON schema:
{
  "corrected_text": "string",
  "summary": "string",
  "terms": [{"term": "string", "alias": ["string"], "meaning": "string"}],
  "corrections": [{"wrong": "string", "correct": "string", "reason": "string"}],
  "concepts": [{"name": "string", "description": "string"}],
  "action_items": ["string"],
  "notes": ["string"]
}
```

## Endpoint Yang Disarankan

### Health Check

```http
GET /api/health
```

Tambahkan status:

```json
{
  "status": "ok",
  "ai_correction_enabled": true,
  "rag_enabled": true,
  "knowledge_ready": true
}
```

### Preflight Check

```http
GET /api/preflight
```

Response sukses:

```json
{
  "status": "ok",
  "checks": {
    "uploads_writable": true,
    "knowledge_readable": true,
    "transcripts_md_writable": true,
    "database": true,
    "ffmpeg": true,
    "whisper_model": true,
    "ai_config": true
  }
}
```

### Upload dan Transkripsi

```http
POST /api/upload-and-transcribe
```

Form data:

```text
audioFile=<file>
ai_correction=true
word_timestamps=false
output_format=md
```

Response:

```json
{
  "job_id": "abc123",
  "filename": "meeting.mp3",
  "status": "queued",
  "ai_correction": true,
  "output_format": "md"
}
```

### Job Status

```http
GET /api/jobs/{job_id}
```

Response:

```json
{
  "job_id": "abc123",
  "status": "completed",
  "queue_s": 0.4,
  "preprocess_s": 2.1,
  "transcribe_s": 55.3,
  "ai_correction_s": 8.2,
  "md_url": "/api/jobs/abc123/download-md"
}
```

### Download Markdown

```http
GET /api/jobs/{job_id}/download-md
```

## Status Job

Gunakan status berikut:

```text
queued
preflight
processing
transcribing
correcting
updating_knowledge
generating_markdown
completed
failed
```

Progress stage yang disarankan:

- `Queued`
- `Checking system readiness`
- `Preprocessing audio`
- `Transcribing audio`
- `Correcting transcript with AI`
- `Updating knowledge`
- `Generating Markdown`
- `Completed`
- `Failed`

## Strategi RAG Sederhana

Versi awal cukup file-based:

1. Baca semua file `.md` di `backend/knowledge` kecuali `RAG.md` jika terlalu panjang.
2. Gabungkan sebagai `knowledge_context`.
3. Batasi total karakter, misalnya 20.000 karakter.
4. Kirim bersama transkrip ke AI.
5. Simpan hasil ekstraksi baru secara append-only.

Upgrade jika knowledge membesar:

- Pecah knowledge menjadi chunk.
- Hitung embedding.
- Simpan di SQLite/FAISS/Chroma.
- Ambil top-k chunk paling relevan berdasarkan transkrip.

Untuk versi awal, jangan pakai vector DB dulu. File Markdown cukup.

## Penyimpanan Database

Tambahan kolom yang disarankan:

```sql
ALTER TABLE transcripts
  ADD COLUMN raw_text LONGTEXT NULL,
  ADD COLUMN ai_corrected_text LONGTEXT NULL,
  ADD COLUMN ai_summary LONGTEXT NULL,
  ADD COLUMN md_path VARCHAR(500) NULL,
  ADD COLUMN ai_correction_status VARCHAR(50) DEFAULT 'skipped';
```

Jika tidak ingin migrasi DB dulu, simpan metadata Markdown di `JOB_STATUS` dan file `.md` saja.

## Error Handling

Jika AI API gagal:

- Transkripsi tetap selesai.
- Markdown tetap dibuat dari transkrip mentah.
- `ai_correction_status=failed`.
- Error dicatat di log.
- User diberi tahu koreksi AI gagal, bukan transkripsi gagal.

Jika Markdown gagal dibuat:

- Transkripsi tetap selesai.
- Status job boleh `completed_with_warning`.
- Error dicatat.

Jika knowledge gagal update:

- Jangan gagal total.
- Simpan warning.
- Markdown tetap dibuat.

## Logging

Log yang boleh:

- Job ID.
- Durasi AI correction.
- Jumlah istilah baru.
- Jumlah koreksi.
- Path file Markdown.
- Status cache.

Jangan log:

- API key.
- Full transcript sensitif.
- Full prompt jika berisi data rahasia.

## Kriteria Berhasil

Fitur dianggap berhasil jika:

- Sistem bisa mengecek kesiapan lewat preflight.
- Transkripsi tetap bisa berjalan tanpa AI jika konfigurasi AI belum siap.
- AI bisa mengoreksi transkrip tanpa mengubah makna.
- Knowledge bertambah dari hasil transkrip.
- Transkrip berikutnya memakai knowledge lama.
- Hasil akhir bisa diunduh sebagai Markdown.
- API key hanya ada di `.env`.
- Tidak ada rewrite besar pada backend.

## Urutan Implementasi Minimal

1. Tambah konfigurasi AI di `.env`.
2. Tambah folder `backend/knowledge` dan `backend/transcripts_md`.
3. Tambah `format-mom.md`.
4. Tambah endpoint `GET /api/preflight`.
5. Tambah fungsi baca knowledge Markdown.
6. Tambah fungsi panggil AI correction via `AI_BASE_URL`.
7. Tambah fungsi validasi JSON output AI.
8. Tambah fungsi append knowledge.
9. Tambah fungsi render Markdown dari template.
10. Tambah endpoint download Markdown.

## Batasan Versi Awal

- Gunakan file Markdown sebagai knowledge store.
- Jangan pakai vector database dulu.
- Jangan ubah pipeline Whisper.
- Jangan memaksa AI correction jika `.env` belum siap.
- Jangan update knowledge dari output AI yang invalid.
- Jangan menulis ulang seluruh aplikasi.

## Upgrade Nanti

Tambahkan hanya jika benar-benar dibutuhkan:

- SQLite untuk metadata knowledge.
- Vector search untuk knowledge besar.
- Review manual sebelum knowledge disimpan permanen.
- Multi-provider AI fallback.
- Role-based access untuk download transkrip.
- Enkripsi file Markdown sensitif.
