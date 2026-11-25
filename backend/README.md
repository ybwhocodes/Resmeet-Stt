# Backend Rust Resmeet STT

Satu binary menyediakan tiga peran proses: `APP_ROLE=api`, `APP_ROLE=worker`, dan `APP_ROLE=ai-worker`. Docker Compose menjalankan ketiganya sebagai container terpisah. `APP_ROLE=all` tersedia untuk pengembangan satu proses; `./start.sh --local` menjalankan ketiga peran secara terpisah.

API Axum menyimpan unggahan dan job ke PostgreSQL. Worker transkripsi mengambil antrean dengan lease 60 detik dan advisory lock global, lalu menyimpan hasil setiap bagian audio sebagai checkpoint. Worker AI memakai antrean dan checkpoint tahap perapian sendiri. Hasil hanya dapat ditulis pemilik lease aktif. Model CPU/GPU dipertahankan dalam satu child process dan dilepas saat idle atau perangkat berganti.

Koneksi PostgreSQL menggunakan `DB_HOST` dan variabel DB lainnya, `DATABASE_URL`, atau konfigurasi setup tersimpan. API key AI disimpan sebagai hash dan ciphertext AES-256-GCM. Kunci pada `APP_CONFIG_DIR/ai-encryption.key` harus dibagikan ke API dan worker AI serta dicadangkan bersama database. Publikasi kunci bersifat atomik agar proses yang mulai bersamaan memakai kunci yang sama.

Perintah pengembangan dari root repository:

- `npm run backend:api`
- `npm run backend:worker`
- `npm run backend:ai-worker`
- `npm run backend:dev` untuk mode satu proses dengan kedua worker internal

FFmpeg dan model diperlukan pada worker transkripsi. Runtime CPU memakai Python faster-whisper bila tersedia; runtime native memakai `whisper-server`. Lihat `.env.example` untuk `CPU_THREADS`, `STT_BATCH_SIZE`, `STT_CHUNK_SECONDS`, dan `MODEL_IDLE_SECONDS`.

Endpoint pekerjaan:

- `POST /api/upload-and-transcribe?background=true`: HTTP 202 + `jobId`.
- `GET /api/transcription-jobs`: pekerjaan aktif milik akun.
- `GET /api/transcription-jobs/{id}`: status privat, preview revisi terbaru, dan hasil; mendukung ETag/304.
- `POST /api/transcription-jobs/{id}/retry`: melanjutkan job gagal yang inputnya belum kedaluwarsa.
- `POST /api/paraphrase?background=true`: antrean AI untuk transkrip yang sudah tersimpan.
- `GET /api/preflight`: kesiapan mesin, penyimpanan, database, dan kedua heartbeat worker.
- `GET /api/health`: kesehatan API dan koneksi database.

Periksa kode dengan `cargo test --locked` dan `cargo build --locked`. Status worker diperiksa memakai `resmeet-backend --check-worker` dengan `APP_ROLE` sesuai worker. Lihat README utama untuk pemulihan, retensi, dan batas resource.
