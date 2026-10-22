import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { mysqlTable, int, varchar, longtext, datetime, float, json } from "drizzle-orm/mysql-core";
import { pgTable, serial, varchar as pgVarchar, text as pgText, timestamp, real as pgReal, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * SQLite Schema for Bun SQLite
 */
export const sqliteTranscripts = sqliteTable("transcripts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  final_text: text("final_text").notNull(),
  created_at: text("created_at").default(sql`(datetime('now', 'localtime'))`),
  duration_s: real("duration_s"),
  language: text("language").default("id"),
  word_timestamps: text("word_timestamps"),
  raw_text: text("raw_text"),
  ai_corrected_text: text("ai_corrected_text"),
  ai_summary: text("ai_summary"),
  md_path: text("md_path"),
  ai_correction_status: text("ai_correction_status").default("skipped"),
  directed_topics: text("directed_topics"),
  ai_data: text("ai_data"),
});

/**
 * MySQL Schema for mysql2 pool
 */
export const mysqlTranscripts = mysqlTable("transcripts", {
  id: int("id").primaryKey().autoincrement(),
  filename: varchar("filename", { length: 255 }).notNull(),
  final_text: longtext("final_text").notNull(),
  created_at: datetime("created_at").default(sql`CURRENT_TIMESTAMP`),
  duration_s: float("duration_s"),
  language: varchar("language", { length: 10 }).default("id"),
  word_timestamps: json("word_timestamps"),
  raw_text: longtext("raw_text"),
  ai_corrected_text: longtext("ai_corrected_text"),
  ai_summary: longtext("ai_summary"),
  md_path: varchar("md_path", { length: 500 }),
  ai_correction_status: varchar("ai_correction_status", { length: 50 }).default("skipped"),
  directed_topics: json("directed_topics"),
  ai_data: json("ai_data"),
});

/**
 * PostgreSQL Schema for node-postgres (pg) pool
 */
export const pgTranscripts = pgTable("transcripts", {
  id: serial("id").primaryKey(),
  filename: pgVarchar("filename", { length: 255 }).notNull(),
  final_text: pgText("final_text").notNull(),
  created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  duration_s: pgReal("duration_s"),
  language: pgVarchar("language", { length: 10 }).default("id"),
  word_timestamps: jsonb("word_timestamps"),
  raw_text: pgText("raw_text"),
  ai_corrected_text: pgText("ai_corrected_text"),
  ai_summary: pgText("ai_summary"),
  md_path: pgVarchar("md_path", { length: 500 }),
  ai_correction_status: pgVarchar("ai_correction_status", { length: 50 }).default("skipped"),
  directed_topics: jsonb("directed_topics"),
  ai_data: jsonb("ai_data"),
});

export type TranscriptInsert = typeof sqliteTranscripts.$inferInsert;
export type TranscriptSelect = typeof sqliteTranscripts.$inferSelect;
