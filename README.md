# Resmeet STT

Aplikasi web transkripsi rapat dengan backend Rust (Axum), frontend React (Vite), PostgreSQL, FFmpeg, dan whisper.cpp. Ringkasan AI tersedia jika gateway AI dikonfigurasi.

## Menjalankan dengan Docker

1. Pastikan model `ggml-large-v3-turbo-q5_0.bin` tersedia pada volume Docker `resmeet_backend_models` (atau ubah `WHISPER_MODEL` dan volume model sesuai kebutuhan).
2. Jalankan `npm run docker:up` atau `./start.sh -d`.
3. Buka `http://localhost:5173`. API tersedia di `http://localhost:8200/api`.
4. Pada instalasi pertama, isi koneksi PostgreSQL dan akun superadmin di pop-up setup. Setelah login, koneksi dapat diubah di menu **Database**; gateway AI dan beberapa ID model diatur di menu **Model AI**.

Skrip startup membangun image dari konteks bersih sehingga berkas metadata macOS `._*` tidak mengganggu Docker.

API key AI disimpan di PostgreSQL sebagai hash bersalt dan ciphertext AES-256-GCM. Kunci enkripsi aplikasi berada pada volume `resmeet_backend_config`, terpisah dari database. Cadangkan volume ini bersama database agar API key tetap dapat dipakai setelah pemulihan.

## Pengembangan lokal

Jalankan `./start.sh --local`. Mode ini menjalankan PostgreSQL melalui Docker, backend dengan `cargo run`, dan frontend dengan Vite. FFmpeg, `whisper-cli`, dan file model harus tersedia pada mesin lokal. Variabel lokal untuk Whisper dapat dibaca dari `backend/.env`; koneksi database dan AI disimpan oleh aplikasi, bukan di `.env`.

## Pemeriksaan

- `cargo check --manifest-path backend/Cargo.toml`
- `npm run build --prefix frontend`
- `curl http://localhost:8200/api/health`
- `curl http://localhost:8200/api/preflight`

Halaman **Status Sistem & Kesiapan** menampilkan hasil pemeriksaan koneksi PostgreSQL, FFmpeg, Whisper CLI, model aktif, dan kemampuan menulis ke direktori upload. Indikator siap hanya muncul jika kelimanya lulus. Konfigurasi AI disimpan per akun melalui menu **Model AI** dan tidak menjadi syarat transkripsi.
