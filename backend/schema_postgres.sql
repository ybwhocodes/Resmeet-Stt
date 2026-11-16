-- =========================================================================
-- Resmeet-STT PostgreSQL Initial Schema & Index Optimization
-- Default Database: PostgreSQL 14+ / 16 (UUID v7 / UUID native)
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. User AI Models Table
CREATE TABLE IF NOT EXISTS user_ai_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id VARCHAR(255) NOT NULL,
  model_name VARCHAR(255) DEFAULT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_ai_models_user ON user_ai_models(user_id);

-- Gateway AI per akun. API key tidak disimpan sebagai teks asli.
CREATE TABLE IF NOT EXISTS user_ai_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  api_key_hash TEXT NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  remember_me BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- 4. Transcripts Table
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  final_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_s REAL DEFAULT NULL,
  generation_time_s REAL DEFAULT NULL,
  language VARCHAR(10) DEFAULT 'id',
  word_timestamps JSONB DEFAULT NULL,
  raw_text TEXT DEFAULT NULL,
  ai_corrected_text TEXT DEFAULT NULL,
  ai_summary TEXT DEFAULT NULL,
  md_path VARCHAR(500) DEFAULT NULL,
  ai_correction_status VARCHAR(50) DEFAULT 'skipped',
  directed_topics JSONB DEFAULT NULL,
  ai_data JSONB DEFAULT NULL,
  share_slug VARCHAR(150) UNIQUE DEFAULT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_transcripts_user ON transcripts(user_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_created ON transcripts(created_at);
CREATE INDEX IF NOT EXISTS idx_transcripts_share_slug ON transcripts(share_slug);

-- 5. Knowledge Base Table
CREATE TABLE IF NOT EXISTS knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  source VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_knowledge_cat_title UNIQUE (category, title)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
