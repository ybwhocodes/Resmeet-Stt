import fs from "node:fs";
import path from "node:path";
import { Database as SqliteDatabase } from "bun:sqlite";
import mysql from "mysql2/promise";
import { Pool as PgPool, Client as PgClient } from "pg";
import { drizzle as drizzleSqlite, BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzleMysql, MySql2Database } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg, NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, desc, sql } from "drizzle-orm";
import { config, PATHS, updateDbSettings } from "./config";
import * as schema from "./schema";

let sqliteInstance: SqliteDatabase | null = null;
let drizzleSqliteInstance: BunSQLiteDatabase<typeof schema> | null = null;

let mysqlPool: mysql.Pool | null = null;
let drizzleMysqlInstance: MySql2Database<typeof schema> | null = null;

let pgPool: PgPool | null = null;
let drizzlePgInstance: NodePgDatabase<typeof schema> | null = null;

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

export function getDrizzleSqliteDb(): BunSQLiteDatabase<typeof schema> {
  if (!drizzleSqliteInstance) {
    const rawSqlite = getSqliteDb();
    drizzleSqliteInstance = drizzleSqlite(rawSqlite, { schema });
  }
  return drizzleSqliteInstance;
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

export function getDrizzleMysqlDb(): MySql2Database<typeof schema> {
  if (!drizzleMysqlInstance) {
    const pool = getMysqlPool();
    drizzleMysqlInstance = drizzleMysql(pool, { schema, mode: "default" });
  }
  return drizzleMysqlInstance;
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

export function getDrizzlePgDb(): NodePgDatabase<typeof schema> {
  if (!drizzlePgInstance) {
    const pool = getPgPool();
    drizzlePgInstance = drizzlePg(pool, { schema });
  }
  return drizzlePgInstance;
}

export async function closeDbConnections() {
  if (mysqlPool) {
    try {
      await mysqlPool.end();
    } catch {}
    mysqlPool = null;
    drizzleMysqlInstance = null;
  }
  if (pgPool) {
    try {
      await pgPool.end();
    } catch {}
    pgPool = null;
    drizzlePgInstance = null;
  }
  if (sqliteInstance) {
    try {
      sqliteInstance.close();
    } catch {}
    sqliteInstance = null;
    drizzleSqliteInstance = null;
  }
}

/**
 * Initializes database storage using Drizzle ORM.
 * Defaults to SQLite if MySQL/Postgres connection fails or if SQLite is selected.
 */
export async function initDb(): Promise<{ success: boolean; type: string; message: string }> {
  const currentType = config.dbType || "sqlite";

  if (currentType === "sqlite") {
    try {
      const raw = getSqliteDb();
      raw.run(`
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
      // Warm up Drizzle ORM instance
      getDrizzleSqliteDb();
      console.log(`[Drizzle ORM] SQLite database initialized successfully (${PATHS.sqliteFile}).`);
      return { success: true, type: "sqlite", message: "SQLite Drizzle ORM aktif." };
    } catch (err: any) {
      console.error("[Drizzle ORM] Gagal inisialisasi SQLite:", err);
      return { success: false, type: "sqlite", message: err.message };
    }
  }

  if (currentType === "mysql") {
    try {
      const orm = getDrizzleMysqlDb();
      await orm.execute(sql`SELECT 1`);
      console.log(`[Drizzle ORM] MySQL database connected successfully (${config.dbHost}:${config.dbPort}/${config.dbName}).`);
      return { success: true, type: "mysql", message: "MySQL Drizzle ORM terhubung." };
    } catch (err: any) {
      console.warn(`[Drizzle ORM] MySQL gagal (${err.message}). Beralih otomatis ke SQLite lokal.`);
      config.dbType = "sqlite";
      updateDbSettings({ dbType: "sqlite" });
      return initDb();
    }
  }

  if (currentType === "postgres") {
    try {
      const orm = getDrizzlePgDb();
      await orm.execute(sql`SELECT 1`);
      console.log(`[Drizzle ORM] PostgreSQL database connected successfully (${config.dbHost}:${config.dbPort}/${config.dbName}).`);
      return { success: true, type: "postgres", message: "PostgreSQL Drizzle ORM terhubung." };
    } catch (err: any) {
      console.warn(`[Drizzle ORM] PostgreSQL gagal (${err.message}). Beralih otomatis ke SQLite lokal.`);
      config.dbType = "sqlite";
      updateDbSettings({ dbType: "sqlite" });
      return initDb();
    }
  }

  return { success: false, type: currentType, message: "Tipe database tidak dikenal." };
}

/**
 * Checks connection of the currently active database using Drizzle ORM.
 */
export async function checkDbConnection(): Promise<boolean> {
  const t = config.dbType || "sqlite";
  try {
    if (t === "sqlite") {
      const orm = getDrizzleSqliteDb();
      orm.run(sql`SELECT 1`);
      return true;
    }
    if (t === "mysql") {
      const orm = getDrizzleMysqlDb();
      await orm.execute(sql`SELECT 1`);
      return true;
    }
    if (t === "postgres") {
      const orm = getDrizzlePgDb();
      await orm.execute(sql`SELECT 1`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Tests connection to a database with specified parameters using Drizzle ORM / driver.
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
      const testOrm = drizzleSqlite(testDb, { schema });
      testOrm.select({ val: sql`1` }).from(schema.sqliteTranscripts).limit(1).all();
      testDb.close();
      return {
        success: true,
        message: "SQLite lokal mandiri siap digunakan (resmeet.sqlite) via Drizzle ORM.",
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
      const testOrm = drizzleMysql(conn as any, { schema, mode: "default" });
      await testOrm.execute(sql`SELECT 1`);
      await conn.end();
      return {
        success: true,
        message: `Koneksi ke MySQL (${params.host || config.dbHost}:${params.port || config.dbPort}) berhasil via Drizzle ORM.`,
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
      database: params.name || "postgres",
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      const testOrm = drizzlePg(client, { schema });
      await testOrm.execute(sql`SELECT 1`);
      await client.end();
      return {
        success: true,
        message: `Koneksi ke PostgreSQL (${params.host || config.dbHost}:${params.port || config.dbPort}) berhasil via Drizzle ORM.`,
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
        message: "Tabel 'transcripts' pada SQLite lokal berhasil dimigrasi (Drizzle ORM siap).",
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
      const adminConn = await mysql.createConnection({
        host,
        port,
        user,
        password,
        connectTimeout: 5000,
      });
      await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
      await adminConn.end();

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
      for (const colSql of columns) {
        try {
          await conn.query(colSql);
        } catch {}
      }
      await conn.end();

      await closeDbConnections();
      return {
        success: true,
        message: `Database '${dbName}' & tabel 'transcripts' pada MySQL (${host}:${port}) berhasil dimigrasi (Drizzle ORM siap)!`,
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
        try { await adminClient.end(); } catch {}
      }

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
      for (const colSql of pgColumns) {
        try {
          await client.query(colSql);
        } catch {}
      }
      await client.end();

      await closeDbConnections();
      return {
        success: true,
        message: `Database '${dbName}' & tabel 'transcripts' pada PostgreSQL (${host}:${port}) berhasil dimigrasi (Drizzle ORM siap)!`,
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

/**
 * Saves transcript using Drizzle ORM (Zero raw SQL strings).
 */
export async function saveTranscript(params: SaveTranscriptParams): Promise<number> {
  const activeType = config.dbType || "sqlite";
  const wordTsJson = params.wordTimestamps ? JSON.stringify(params.wordTimestamps) : null;
  const directedTopicsJson = params.directedTopics ? JSON.stringify(params.directedTopics) : null;
  const aiDataJson = params.aiData ? JSON.stringify(params.aiData) : null;
  const duration = Math.round(params.durationS * 100) / 100;

  if (activeType === "sqlite") {
    const orm = getDrizzleSqliteDb();
    const inserted = orm.insert(schema.sqliteTranscripts).values({
      filename: params.filename,
      final_text: params.finalText,
      duration_s: duration,
      word_timestamps: wordTsJson,
      raw_text: params.rawText || null,
      ai_corrected_text: params.aiText || null,
      ai_summary: params.aiSummary || null,
      md_path: params.mdPath || null,
      ai_correction_status: params.aiStatus || "skipped",
      directed_topics: directedTopicsJson,
      ai_data: aiDataJson,
    }).returning({ id: schema.sqliteTranscripts.id }).get();
    return Number(inserted.id);
  }

  if (activeType === "mysql") {
    const orm = getDrizzleMysqlDb();
    const [result] = await orm.insert(schema.mysqlTranscripts).values({
      filename: params.filename,
      final_text: params.finalText,
      duration_s: duration,
      word_timestamps: params.wordTimestamps || null,
      raw_text: params.rawText || null,
      ai_corrected_text: params.aiText || null,
      ai_summary: params.aiSummary || null,
      md_path: params.mdPath || null,
      ai_correction_status: params.aiStatus || "skipped",
      directed_topics: params.directedTopics || null,
      ai_data: params.aiData || null,
    });
    return result.insertId;
  }

  if (activeType === "postgres") {
    const orm = getDrizzlePgDb();
    const [res] = await orm.insert(schema.pgTranscripts).values({
      filename: params.filename,
      final_text: params.finalText,
      duration_s: duration,
      word_timestamps: params.wordTimestamps || null,
      raw_text: params.rawText || null,
      ai_corrected_text: params.aiText || null,
      ai_summary: params.aiSummary || null,
      md_path: params.mdPath || null,
      ai_correction_status: params.aiStatus || "skipped",
      directed_topics: params.directedTopics || null,
      ai_data: params.aiData || null,
    }).returning({ id: schema.pgTranscripts.id });
    return res.id;
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

/**
 * Retrieves recent transcripts using Drizzle ORM query builder.
 */
export async function getRecentTranscripts(limit = 50): Promise<any[]> {
  const activeType = config.dbType || "sqlite";

  if (activeType === "sqlite") {
    const orm = getDrizzleSqliteDb();
    const rows = orm
      .select()
      .from(schema.sqliteTranscripts)
      .orderBy(desc(schema.sqliteTranscripts.id))
      .limit(limit)
      .all();
    return (rows as any[]).map(formatTranscriptRow);
  }

  if (activeType === "mysql") {
    const orm = getDrizzleMysqlDb();
    const rows = await orm
      .select()
      .from(schema.mysqlTranscripts)
      .orderBy(desc(schema.mysqlTranscripts.id))
      .limit(limit);
    return (rows as any[]).map(formatTranscriptRow);
  }

  if (activeType === "postgres") {
    const orm = getDrizzlePgDb();
    const rows = await orm
      .select()
      .from(schema.pgTranscripts)
      .orderBy(desc(schema.pgTranscripts.id))
      .limit(limit);
    return (rows as any[]).map(formatTranscriptRow);
  }

  return [];
}

/**
 * Retrieves a single transcript by ID using Drizzle ORM eq() filter.
 */
export async function getTranscriptById(id: number): Promise<any | null> {
  const activeType = config.dbType || "sqlite";

  if (activeType === "sqlite") {
    const orm = getDrizzleSqliteDb();
    const rows = orm
      .select()
      .from(schema.sqliteTranscripts)
      .where(eq(schema.sqliteTranscripts.id, id))
      .all();
    if (!rows.length) return null;
    return formatTranscriptRow(rows[0]);
  }

  if (activeType === "mysql") {
    const orm = getDrizzleMysqlDb();
    const rows = await orm
      .select()
      .from(schema.mysqlTranscripts)
      .where(eq(schema.mysqlTranscripts.id, id));
    if (!rows.length) return null;
    return formatTranscriptRow(rows[0]);
  }

  if (activeType === "postgres") {
    const orm = getDrizzlePgDb();
    const rows = await orm
      .select()
      .from(schema.pgTranscripts)
      .where(eq(schema.pgTranscripts.id, id));
    if (!rows.length) return null;
    return formatTranscriptRow(rows[0]);
  }

  return null;
}

/**
 * Deletes a transcript by ID using Drizzle ORM delete() builder.
 */
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
        console.warn(`[Drizzle ORM] Gagal menghapus file markdown ${row.md_path}:`, err);
      }
    }

    if (activeType === "sqlite") {
      const orm = getDrizzleSqliteDb();
      orm.delete(schema.sqliteTranscripts).where(eq(schema.sqliteTranscripts.id, id)).run();
      return true;
    }

    if (activeType === "mysql") {
      const orm = getDrizzleMysqlDb();
      const [result] = await orm.delete(schema.mysqlTranscripts).where(eq(schema.mysqlTranscripts.id, id));
      return result.affectedRows > 0;
    }

    if (activeType === "postgres") {
      const orm = getDrizzlePgDb();
      await orm.delete(schema.pgTranscripts).where(eq(schema.pgTranscripts.id, id));
      return true;
    }

    return false;
  } catch (err) {
    console.error(`[Drizzle ORM] Gagal menghapus transkrip ID ${id}:`, err);
    return false;
  }
}

/**
 * Updates paraphrase data using Drizzle ORM update() builder.
 */
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
      const orm = getDrizzleSqliteDb();
      orm.update(schema.sqliteTranscripts).set({
        final_text: params.finalText,
        ai_corrected_text: params.finalText,
        ai_summary: params.aiSummary || null,
        directed_topics: directedTopicsJson,
        ai_data: aiDataJson,
        ai_correction_status: "paraphrased",
      }).where(eq(schema.sqliteTranscripts.id, id)).run();
      return true;
    }

    if (activeType === "mysql") {
      const orm = getDrizzleMysqlDb();
      const [result] = await orm.update(schema.mysqlTranscripts).set({
        final_text: params.finalText,
        ai_corrected_text: params.finalText,
        ai_summary: params.aiSummary || null,
        directed_topics: params.directedTopics || null,
        ai_data: params.aiData || null,
        ai_correction_status: "paraphrased",
      }).where(eq(schema.mysqlTranscripts.id, id));
      return result.affectedRows > 0;
    }

    if (activeType === "postgres") {
      const orm = getDrizzlePgDb();
      await orm.update(schema.pgTranscripts).set({
        final_text: params.finalText,
        ai_corrected_text: params.finalText,
        ai_summary: params.aiSummary || null,
        directed_topics: params.directedTopics || null,
        ai_data: params.aiData || null,
        ai_correction_status: "paraphrased",
      }).where(eq(schema.pgTranscripts.id, id));
      return true;
    }

    return false;
  } catch (err) {
    console.error(`[Drizzle ORM] Gagal update paraphrase transkrip ID ${id}:`, err);
    return false;
  }
}
