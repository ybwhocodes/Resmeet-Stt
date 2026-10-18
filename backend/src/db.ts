import fs from "node:fs";
import mysql from "mysql2/promise";
import { config } from "./config";

let pool: mysql.Pool | null = null;

export function getDbPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPassword,
      database: config.dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

export async function initDb(): Promise<boolean> {
  try {
    // First, connect without database to ensure database exists
    const adminConn = await mysql.createConnection({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPassword,
    });
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await adminConn.end();

    const p = getDbPool();
    await p.query(`
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

    // Ensure all optional columns exist
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
        await p.query(sql);
      } catch {
        // Ignored if column already exists
      }
    }

    console.log("[DB] MySQL database initialized successfully.");
    return true;
  } catch (err) {
    console.error("[DB] Database initialization error:", err);
    return false;
  }
}

export async function checkDbConnection(): Promise<boolean> {
  try {
    const p = getDbPool();
    await p.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
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
  const p = getDbPool();
  const wordTsJson = params.wordTimestamps ? JSON.stringify(params.wordTimestamps) : null;
  const directedTopicsJson = params.directedTopics ? JSON.stringify(params.directedTopics) : null;
  const aiDataJson = params.aiData ? JSON.stringify(params.aiData) : null;
  const [result] = await p.execute<mysql.ResultSetHeader>(
    `INSERT INTO transcripts 
      (filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data) 
     VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.filename,
      params.finalText,
      Math.round(params.durationS * 100) / 100,
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
  const p = getDbPool();
  const [rows] = await p.query(
    "SELECT id, filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data FROM transcripts ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
  return (rows as any[]).map(formatTranscriptRow);
}

export async function getTranscriptById(id: number): Promise<any | null> {
  const p = getDbPool();
  const [rows] = await p.execute(
    "SELECT id, filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status, directed_topics, ai_data FROM transcripts WHERE id = ?",
    [id]
  );
  const list = rows as any[];
  if (!list.length) return null;
  return formatTranscriptRow(list[0]);
}

export async function deleteTranscript(id: number): Promise<boolean> {
  const p = getDbPool();
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

    const [result] = await p.execute<mysql.ResultSetHeader>("DELETE FROM transcripts WHERE id = ?", [id]);
    return result.affectedRows > 0;
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
  const p = getDbPool();
  try {
    const directedTopicsJson = params.directedTopics ? JSON.stringify(params.directedTopics) : null;
    const aiDataJson = params.aiData ? JSON.stringify(params.aiData) : null;
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
  } catch (err) {
    console.error(`[DB] Gagal update paraphrase transkrip ID ${id}:`, err);
    return false;
  }
}


