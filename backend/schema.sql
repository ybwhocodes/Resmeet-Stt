-- ============================================================
-- Schema MySQL untuk aplikasi Speech-to-Text
-- Jalankan sekali: mysql -u root -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS stt_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE stt_db;

CREATE TABLE IF NOT EXISTS transcripts (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    filename        VARCHAR(255)    NOT NULL          COMMENT 'Nama file audio asli',
    final_text      LONGTEXT        NOT NULL          COMMENT 'Teks final setelah post-processing',
    created_at      DATETIME        NOT NULL
                    DEFAULT CURRENT_TIMESTAMP         COMMENT 'Waktu proses selesai',
    duration_s      FLOAT           DEFAULT NULL      COMMENT 'Durasi audio dalam detik',
    language        VARCHAR(10)     DEFAULT 'id'      COMMENT 'Kode bahasa (id = Indonesia)',
    word_timestamps JSON            DEFAULT NULL      COMMENT 'Word-level timestamps dari whisperx alignment',
    raw_text        LONGTEXT        DEFAULT NULL      COMMENT 'Teks mentah sebelum koreksi AI',
    ai_corrected_text LONGTEXT      DEFAULT NULL      COMMENT 'Teks hasil koreksi AI',
    ai_summary      LONGTEXT        DEFAULT NULL      COMMENT 'Ringkasan dari AI',
    md_path         VARCHAR(500)    DEFAULT NULL      COMMENT 'Path file Markdown hasil transkrip',
    ai_correction_status VARCHAR(50) DEFAULT 'skipped' COMMENT 'Status koreksi AI'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;