# Backend Rust Resmeet STT

Backend Axum memakai SQLx untuk PostgreSQL, FFmpeg untuk konversi audio, dan `whisper-cli` untuk transkripsi. Konfigurasi PostgreSQL disimpan di `database.json` pada `APP_CONFIG_DIR` (volume Docker `/app/config`). Gateway AI disimpan per akun dalam PostgreSQL. `.env` hanya memuat opsi lokal Whisper; lihat `.env.example`.

API key AI tidak disimpan sebagai teks asli: database menyimpan hash bersalt dan ciphertext AES-256-GCM. Kunci dekripsi berada di `APP_CONFIG_DIR/ai-encryption.key` dengan izin file terbatas. Hash dipakai untuk verifikasi; ciphertext dipakai saat backend mengirim permintaan ke penyedia AI. Cadangkan file kunci bersama database.

Jalankan `cargo check` untuk memeriksa kompilasi dan `cargo run` untuk menjalankan API di port 8200. PostgreSQL harus tersedia sebelum backend dimulai. Letakkan file model pada direktori `MODEL_DIR` (default `backend/models`) dan set `WHISPER_MODEL` ke nama file `.bin` atau nama model seperti `large-v3-turbo`.

`GET /api/preflight` mengembalikan objek `checks` untuk PostgreSQL, FFmpeg, Whisper CLI, model aktif, dan direktori upload. `GET /api/health` memeriksa koneksi database.
