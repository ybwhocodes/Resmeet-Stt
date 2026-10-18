import fs from "node:fs";
import path from "node:path";
import { Database as SqliteDatabase } from "bun:sqlite";
import mysql from "mysql2/promise";
import { Pool as PgPool, Client as PgClient } from "pg";
import { config, PATHS, updateDbSettings } from "./config";

let sqliteInstance: SqliteDatabase | null = null;
let mysqlPool: mysql.Pool | null = null;
let pgPool: PgPool | null = null;

export function getSqliteDb(): SqliteDatabase {
  if (!sqliteInstance) {
    const dbPath = PATHS.sqliteFile;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    sqliteInstance = new SqliteDatabase(dbPath);
    sqliteInstance.run("PRAGMA journal_mode = WAL;");
    sqliteInstance.run("PRAGMA foreign_keys = ON;");
  }
  return sqliteInstance;
}

export function getMysqlPool(): mysql.Pool {
  if (!mysqlPool) {
    mysqlPool = mysql.createPool({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPassword,
      database: config.dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 5000,
    });
  }
  return mysqlPool;
}

export function getPgPool(): PgPool {
  if (!pgPool) {
    pgPool = new PgPool({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPassword,
      database: config.dbName,
      connectionTimeoutMillis: 5000,
      max: 10,
    });
  }
  return pgPool;
}

export async function closeDbConnections() {
  if (mysqlPool) {
    try {
      await mysqlPool.end();
    } catch {}
    mysqlPool = null;
  }
  if (pgPool) {
    try {
      await pgPool.end();
    } catch {}
    pgPool = null;
  }
  if (sqliteInstance) {
    try {
      sqliteInstance.close();
    } catch {}
    sqliteInstance = null;
  }
}

/**
 * Initializes database storage.
 * Defaults to SQLite if MySQL/Postgres connection fails or if SQLite is selected.
 */
export async function initDb(): Promise<{ success: boolean; type: string; message: string }> {
  const currentType = config.dbType || "sqlite";

  if (currentType === "sqlite") {
    try {
      const db = getSqliteDb();
      db.run(`
        CREATE TABLE IF NOT EXISTS transcripts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          final_text TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          duration_s REAL DEFAULT NULL,
          language TEXT DEFAULT 'id',
          word_timestamps TEXT DEFAULT NULL,
          raw_text TEXT DEFAULT NULL,
          ai_corrected_text TEXT DEFAULT NULL,
          ai_summary TEXT DEFAULT NULL,
          md_path TEXT DEFAULT NULL,
          ai_correction_status TEXT DEFAULT 'skipped',
          directed_topics TEXT DEFAULT NULL,
          ai_data TEXT DEFAULT NULL
        );
      `);
      console.log(`[DB] SQLite database initialized successfully (${PATHS.sqliteFile}).`);
      return { success: true, type: "sqlite", message: "SQLite aktif." };
    } catch (err: any) {
      console.error("[DB] Gagal inisialisasi SQLite:", err);
      return { success: false, type: "sqlite", message: err.message };
    }
  }

  if (currentType === "mysql") {
    try {
      const pool = getMysqlPool();
      await pool.query("SELECT 1");
      console.log(`[DB] MySQL database connected successfully (${config.dbHost}:${config.dbPort}/${config.dbName}).`);
      return { success: true, type: "mysql", message: "MySQL terhubung." };
    } catch (err: any) {
      console.warn(`[DB] MySQL gagal (${err.message}). Beralih otomatis ke SQLite lokal.`);
      // Fallback to SQLite so server continues running
      config.dbType = "sqlite";
      updateDbSettings({ dbType: "sqlite" });
      return initDb();
    }
  }

  if (currentType === "postgres") {
    try {
      const pool = getPgPool();
      await pool.query("SELECT 1");
      console.log(`[DB] PostgreSQL database connected successfully (${config.dbHost}:${config.dbPort}/${config.dbName}).`);
      return { success: true, type: "postgres", message: "PostgreSQL terhubung." };
    } catch (err: any) {
      console.warn(`[DB] PostgreSQL gagal (${err.message}). Beralih otomatis ke SQLite lokal.`);
      config.dbType = "sqlite";
      updateDbSettings({ dbType: "sqlite" });
      return initDb();
    }
  }

  return { success: false, type: currentType, message: "Tipe database tidak dikenal." };
}

/**
 * Checks connection of the currently active database.
 */
export async function checkDbConnection(): Promise<boolean> {
  const t = config.dbType || "sqlite";
  try {
    if (t === "sqlite") {
      const db = getSqliteDb();
      db.query("SELECT 1").get();
      return true;
    }
    if (t === "mysql") {
      const p = getMysqlPool();
      await p.query("SELECT 1");
      return true;
    }
    if (t === "postgres") {
      const p = getPgPool();
      await p.query("SELECT 1");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Tests connection to a database with specified parameters (without altering active config).
 */
export async function testDbConnection(params: {
  type: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  name?: string;
}): Promise<{ success: boolean; message: string; latencyMs: number }> {
  const start = Date.now();
  const dbType = (params.type || "sqlite").toLowerCase();

  if (dbType === "sqlite") {
    try {
      const testDb = new SqliteDatabase(PATHS.sqliteFile);
      testDb.query("SELECT 1").get();
      testDb.close();
      return {
        success: true,
        message: "SQLite lokal mandiri siap digunakan (resmeet.sqlite).",
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || "Gagal membuka file SQLite lokal.",
        latencyMs: Date.now() - start,
      };
    }
  }

  if (dbType === "mysql") {
    try {
      const conn = await mysql.createConnection({
        host: params.host || config.dbHost,
        port: Number(params.port || config.dbPort || 3306),
        user: params.user || config.dbUser,
        password: params.password !== undefined ? params.password : config.dbPassword,
        connectTimeout: 5000,
      });
      await conn.query("SELECT 1");
      await conn.end();
      return {
        success: true,
        message: `Koneksi ke MySQL (${params.host || config.dbHost}:${params.port || config.dbPort}) berhasil.`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Gagal koneksi ke MySQL: ${err.message}`,
        latencyMs: Date.now() - start,
      };
    }
  }

  if (dbType === "postgres") {
    const client = new PgClient({
      host: params.host || config.dbHost,
      port: Number(params.port || config.dbPort || 5432),
      user: params.user || config.dbUser,
      password: params.password !== undefined ? params.password : config.dbPassword,
      database: params.name || "postgres", // connect to default postgres db for testing
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return {
        success: true,
        message: `Koneksi ke PostgreSQL (${params.host || config.dbHost}:${params.port || config.dbPort}) berhasil.`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Gagal koneksi ke PostgreSQL: ${err.message}`,
        latencyMs: Date.now() - start,
      };
    }
  }

  return {
    success: false,
    message: `Tipe database '${dbType}' tidak didukung.`,
    latencyMs: Date.now() - start,
  };
}

/**
 * Runs table migration on the specified database.
 */
export async function migrateDatabase(params: {
  type: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  name?: string;
}): Promise<{ success: boolean; message: string }> {
  const dbType = (params.type || config.dbType || "sqlite").toLowerCase();

  if (dbType === "sqlite") {
    try {
      const db = getSqliteDb();
      db.run(`
        CREATE TABLE IF NOT EXISTS transcripts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          final_text TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          duration_s REAL DEFAULT NULL,
          language TEXT DEFAULT 'id',
          word_timestamps TEXT DEFAULT NULL,
          raw_text TEXT DEFAULT NULL,
          ai_corrected_text TEXT DEFAULT NULL,
          ai_summary TEXT DEFAULT NULL,
          md_path TEXT DEFAULT NULL,
          ai_correction_status TEXT DEFAULT 'skipped',
          directed_topics TEXT DEFAULT NULL,
          ai_data TEXT DEFAULT NULL
        );
      `);
      return {
        success: true,
        message: "Tabel 'transcripts' pada SQLite lokal berhasil dimigrasi dan siap dipakai.",
      };
    } catch (err: any) {
      return { success: false, message: `Gagal migrasi SQLite: ${err.message}` };
    }
  }

  if (dbType === "mysql") {
    const host = params.host || config.dbHost;
    const port = Number(params.port || config.dbPort || 3306);
    const user = params.user || config.dbUser;
    const password = params.password !== undefined ? params.password : config.dbPassword;
    const dbName = params.name || config.dbName || "stt_db";

    try {
      // Connect without db first to create database
      const adminConn = await mysql.createConnection({
        host,
        port,
        user,
        password,
        connectTimeout: 5000,
      });
      await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
      await adminConn.end();

      // Connect to target db and run table creation
      const conn = await mysql.createConnection({
        host,
        port,
        user,
        password,
        database: dbName,
        connectTimeout: 5000,
      });

      await conn.query(`
        CREATE TABLE IF NOT EXISTS transcripts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          filename VARCHAR(255) NOT NULL,
          final_text LONGTEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          duration_s FLOAT DEFAULT NULL,
          language VARCHAR(10) DEFAULT 'id',
          word_timestamps JSON DEFAULT NULL,
          raw_text LONGTEXT DEFAULT NULL,
          ai_corrected_text LONGTEXT DEFAULT NULL,
          ai_summary LONGTEXT DEFAULT NULL,
          md_path VARCHAR(500) DEFAULT NULL,
          ai_correction_status VARCHAR(50) DEFAULT 'skipped',
          directed_topics JSON DEFAULT NULL,
          ai_data JSON DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      const columns = [
        "ALTER TABLE transcripts ADD COLUMN word_timestamps JSON DEFAULT NULL",
        "ALTER TABLE transcripts ADD COLUMN raw_text LONGTEXT DEFAULT NULL",
        "ALTER TABLE transcripts ADD COLUMN ai_corrected_text LONGTEXT DEFAULT NULL",
        "ALTER TABLE transcripts ADD COLUMN ai_summary LONGTEXT DEFAULT NULL",
        "ALTER TABLE transcripts ADD COLUMN md_path VARCHAR(500) DEFAULT NULL",
        "ALTER TABLE transcripts ADD COLUMN ai_correction_status VARCHAR(50) DEFAULT 'skipped'",
        "ALTER TABLE transcripts ADD COLUMN directed_topics JSON DEFAULT NULL",
        "ALTER TABLE transcripts ADD COLUMN ai_data JSON DEFAULT NULL",
      ];
      for (const sql of columns) {
        try {
          await conn.query(sql);
        } catch {}
      }
      await conn.end();

      // Switch active pool if configuration matches
      await closeDbConnections();
      return {
        success: true,
        message: `Database '${dbName}' & tabel 'transcripts' pada MySQL (${host}:${port}) berhasil dimigrasi!`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Gagal migrasi MySQL: ${err.message}`,
      };
    }
  }

  if (dbType === "postgres") {
    const host = params.host || config.dbHost;
    const port = Number(params.port || config.dbPort || 5432);
    const user = params.user || config.dbUser;
    const password = params.password !== undefined ? params.password : config.dbPassword;
    const dbName = params.name || config.dbName || "stt_db";

    try {
      // Connect to postgres default db to check/create database
      const adminClient = new PgClient({
        host,
        port,
        user,
        password,
        database: "postgres",
        connectionTimeoutMillis: 5000,
      });

      try {
        await adminClient.connect();
        const checkDb = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
        if (checkDb.rows.length === 0) {
          await adminClient.query(`CREATE DATABASE "${dbName}";`);
        }
        await adminClient.end();
      } catch (adminErr) {
        console.warn("[DB] Postgres admin database check skipped:", adminErr);
        try { await adminClient.end(); } catch {}
      }

      // Connect to target db to create table
      const client = new PgClient({
        host,
        port,
        user,
        password,
        database: dbName,
        connectionTimeoutMillis: 5000,
      });

      await client.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS transcripts (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL,
          final_text TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          duration_s REAL DEFAULT NULL,
          language VARCHAR(10) DEFAULT 'id',
          word_timestamps JSONB DEFAULT NULL,
          raw_text TEXT DEFAULT NULL,
          ai_corrected_text TEXT DEFAULT NULL,
          ai_summary TEXT DEFAULT NULL,
          md_path VARCHAR(500) DEFAULT NULL,
          ai_correction_status VARCHAR(50) DEFAULT 'skipped',
          directed_topics JSONB DEFAULT NULL,
          ai_data JSONB DEFAULT NULL
        );
      `);

      const pgColumns = [
        "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS word_timestamps JSONB DEFAULT NULL;",
        "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS raw_text TEXT DEFAULT NULL;",
        "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS ai_corrected_text TEXT DEFAULT NULL;",
        "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS ai_summary TEXT DEFAULT NULL;",
        "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS md_path VARCHAR(500) DEFAULT NULL;",
        "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS ai_correction_status VARCHAR(50) DEFAULT 'skipped';",
        "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS directed_topics JSONB DEFAULT NULL;",
        "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS ai_data JSONB DEFAULT NULL;",
      ];
      for (const sql of pgColumns) {
        try {
          await client.query(sql);
        } catch {}
      }
      await client.end();

      await closeDbConnections();
      return {
        success: true,
        message: `Database '${dbName}' & tabel 'transcripts' pada PostgreSQL (${host}:${port}) berhasil dimigrasi!`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Gagal migrasi PostgreSQL: ${err.message}`,
      };
    }
  }

  return { success: false, message: `Tipe database '${dbType}' tidak didukung untuk migrasi.` };
}

export interface SaveTranscriptParams {
  filename: string;
  finalText: string;
  durationS: number;
  wordTimestamps?: any;
  rawText?: string | null;
  aiText?: string | null;
  aiSummary?: string | null;
  mdPath?: string | null;
  aiStatus?: string;
  directedTopics?: any;
  aiData?: any;
}

export async function saveTranscript(params: SaveTranscriptParams): Promise<number> {
  const activeType = config.dbType || "sqlite";
  const wordTsJson = params.wordTimestamps ? JSON.stringify(params.wordTimestamps) : null;
  const directedTopicsJson = params.directedTopics ? JSON.stringify(params.directedTopics) : null;
  const aiDataJson = params.aiData ? JSON.stringify(params.aiData) : null;
  const duration = Math.round(params.durationS * 100) / 100;

  if (activeType === "sqlite") {
    const db = getSqliteDb();
    const stmt = db.prepare(`
      INSERT INTO transcripts 
        (filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data) 
      VALUES (?, ?, datetime('now', 'localtime'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      params.filename,
      params.finalText,
      duration,
      wordTsJson,
      params.rawText || null,
      params.aiText || null,
      params.aiSummary || null,
      params.mdPath || null,
      params.aiStatus || "skipped",
      directedTopicsJson,
      aiDataJson
    );
    return Number(info.lastInsertRowid);
  }

  if (activeType === "mysql") {
    const p = getMysqlPool();
    const [result] = await p.execute<mysql.ResultSetHeader>(
      `INSERT INTO transcripts 
        (filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data) 
       VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.filename,
        params.finalText,
        duration,
        wordTsJson,
        params.rawText || null,
        params.aiText || null,
        params.aiSummary || null,
        params.mdPath || null,
        params.aiStatus || "skipped",
        directedTopicsJson,
        aiDataJson,
      ]
    );
    return result.insertId;
  }

  if (activeType === "postgres") {
    const p = getPgPool();
    const res = await p.query(
      `INSERT INTO transcripts 
        (filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data) 
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        params.filename,
        params.finalText,
        duration,
        wordTsJson,
        params.rawText || null,
        params.aiText || null,
        params.aiSummary || null,
        params.mdPath || null,
        params.aiStatus || "skipped",
        directedTopicsJson,
        aiDataJson,
      ]
    );
    return res.rows[0].id;
  }

  throw new Error(`Tipe database ${activeType} tidak didukung`);
}

function formatTranscriptRow(row: any) {
  let wordTimestamps = null;
  if (typeof row.word_timestamps === "string") {
    try {
      wordTimestamps = JSON.parse(row.word_timestamps);
    } catch {
      wordTimestamps = row.word_timestamps;
    }
  } else {
    wordTimestamps = row.word_timestamps;
  }

  let directedTopics = null;
  if (typeof row.directed_topics === "string") {
    try {
      directedTopics = JSON.parse(row.directed_topics);
    } catch {
      directedTopics = row.directed_topics;
    }
  } else {
    directedTopics = row.directed_topics;
  }

  let aiData = null;
  if (typeof row.ai_data === "string") {
    try {
      aiData = JSON.parse(row.ai_data);
    } catch {
      aiData = row.ai_data;
    }
  } else {
    aiData = row.ai_data;
  }

  return {
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    word_timestamps: wordTimestamps,
    directed_topics: directedTopics,
    ai_data: aiData,
    markdown_text: row.ai_corrected_text || row.final_text,
    md_url: row.md_path ? `/api/transcripts/${row.id}/download-md` : null,
  };
}

export async function getRecentTranscripts(limit = 50): Promise<any[]> {
  const activeType = config.dbType || "sqlite";

  if (activeType === "sqlite") {
    const db = getSqliteDb();
    const rows = db.query(
      "SELECT id, filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data FROM transcripts ORDER BY id DESC LIMIT ?"
    ).all(limit);
    return (rows as any[]).map(formatTranscriptRow);
  }

  if (activeType === "mysql") {
    const p = getMysqlPool();
    const [rows] = await p.query(
      "SELECT id, filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data FROM transcripts ORDER BY id DESC LIMIT ?",
      [limit]
    );
    return (rows as any[]).map(formatTranscriptRow);
  }

  if (activeType === "postgres") {
    const p = getPgPool();
    const res = await p.query(
      "SELECT id, filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data FROM transcripts ORDER BY id DESC LIMIT $1",
      [limit]
    );
    return res.rows.map(formatTranscriptRow);
  }

  return [];
}

export async function getTranscriptById(id: number): Promise<any | null> {
  const activeType = config.dbType || "sqlite";

  if (activeType === "sqlite") {
    const db = getSqliteDb();
    const row = db.query(
      "SELECT id, filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data FROM transcripts WHERE id = ?"
    ).get(id);
    if (!row) return null;
    return formatTranscriptRow(row);
  }

  if (activeType === "mysql") {
    const p = getMysqlPool();
    const [rows] = await p.execute(
      "SELECT id, filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data FROM transcripts WHERE id = ?",
      [id]
    );
    const list = rows as any[];
    if (!list.length) return null;
    return formatTranscriptRow(list[0]);
  }

  if (activeType === "postgres") {
    const p = getPgPool();
    const res = await p.query(
      "SELECT id, filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data FROM transcripts WHERE id = $1",
      [id]
    );
    if (!res.rows.length) return null;
    return formatTranscriptRow(res.rows[0]);
  }

  return null;
}

export async function deleteTranscript(id: number): Promise<boolean> {
  const activeType = config.dbType || "sqlite";
  try {
    const row = await getTranscriptById(id);
    if (!row) return false;

    // Delete markdown file if it exists
    if (row.md_path && fs.existsSync(row.md_path)) {
      try {
        fs.unlinkSync(row.md_path);
      } catch (err) {
        console.warn(`[DB] Gagal menghapus file markdown ${row.md_path}:`, err);
      }
    }

    if (activeType === "sqlite") {
      const db = getSqliteDb();
      const info = db.prepare("DELETE FROM transcripts WHERE id = ?").run(id);
      return info.changes > 0;
    }

    if (activeType === "mysql") {
      const p = getMysqlPool();
      const [result] = await p.execute<mysql.ResultSetHeader>("DELETE FROM transcripts WHERE id = ?", [id]);
      return result.affectedRows > 0;
    }

    if (activeType === "postgres") {
      const p = getPgPool();
      const res = await p.query("DELETE FROM transcripts WHERE id = $1", [id]);
      return (res.rowCount || 0) > 0;
    }

    return false;
  } catch (err) {
    console.error(`[DB] Gagal menghapus transkrip ID ${id}:`, err);
    return false;
  }
}

export async function updateTranscriptParaphrase(
  id: number,
  params: {
    finalText: string;
    aiSummary?: string | null;
    directedTopics?: any;
    aiData?: any;
  }
): Promise<boolean> {
  const activeType = config.dbType || "sqlite";
  const directedTopicsJson = params.directedTopics ? JSON.stringify(params.directedTopics) : null;
  const aiDataJson = params.aiData ? JSON.stringify(params.aiData) : null;

  try {
    if (activeType === "sqlite") {
      const db = getSqliteDb();
      const info = db.prepare(`
        UPDATE transcripts 
        SET final_text = ?, 
            ai_corrected_text = ?, 
            ai_summary = ?, 
            directed_topics = ?, 
            ai_data = ?, 
            ai_correction_status = 'paraphrased' 
        WHERE id = ?
      `).run(
        params.finalText,
        params.finalText,
        params.aiSummary || null,
        directedTopicsJson,
        aiDataJson,
        id
      );
      return info.changes > 0;
    }

    if (activeType === "mysql") {
      const p = getMysqlPool();
      const [result] = await p.execute<mysql.ResultSetHeader>(
        `UPDATE transcripts 
         SET final_text = ?, 
             ai_corrected_text = ?, 
             ai_summary = ?, 
             directed_topics = ?, 
             ai_data = ?, 
             ai_correction_status = 'paraphrased' 
         WHERE id = ?`,
        [
          params.finalText,
          params.finalText,
          params.aiSummary || null,
          directedTopicsJson,
          aiDataJson,
          id,
        ]
      );
      return result.affectedRows > 0;
    }

    if (activeType === "postgres") {
      const p = getPgPool();
      const res = await p.query(
        `UPDATE transcripts 
         SET final_text = $1, 
             ai_corrected_text = $2, 
             ai_summary = $3, 
             directed_topics = $4, 
             ai_data = $5, 
             ai_correction_status = 'paraphrased' 
         WHERE id = $6`,
        [
          params.finalText,
          params.finalText,
          params.aiSummary || null,
          directedTopicsJson,
          aiDataJson,
          id,
        ]
      );
      return (res.rowCount || 0) > 0;
    }

    return false;
  } catch (err) {
    console.error(`[DB] Gagal update paraphrase transkrip ID ${id}:`, err);
    return false;
  }
}
