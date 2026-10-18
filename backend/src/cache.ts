import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { config, PATHS } from "./config";

export function calculateFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

export function getCacheKey(fileHash: string, wordTimestamps: boolean, aiCorrection: boolean): string {
  const fmtPath = path.join(PATHS.knowledgeDir, "format-mom.md");
  const fmtHash = fs.existsSync(fmtPath) ? calculateFileHash(fmtPath).slice(0, 12) : "noformat";
  return `${fileHash}:${config.whisperModel}:id:int8:word_ts=${wordTimestamps ? 1 : 0}:denoise=${config.enableDenoise ? 1 : 0}:ai=${aiCorrection ? 1 : 0}:${config.aiModelId}:fmt=${fmtHash}`;
}

export function readCache(cacheKey: string): any | null {
  if (!fs.existsSync(PATHS.cacheFile)) return null;
  try {
    const raw = fs.readFileSync(PATHS.cacheFile, "utf-8");
    const json = JSON.parse(raw);
    return json[cacheKey] || null;
  } catch (err) {
    console.warn("[Cache] Read failed:", err);
    return null;
  }
}

export function writeCache(cacheKey: string, data: any): void {
  try {
    let cache: Record<string, any> = {};
    if (fs.existsSync(PATHS.cacheFile)) {
      try {
        cache = JSON.parse(fs.readFileSync(PATHS.cacheFile, "utf-8"));
      } catch {
        cache = {};
      }
    }
    cache[cacheKey] = data;
    const tmp = PATHS.cacheFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
    fs.renameSync(tmp, PATHS.cacheFile);
  } catch (err) {
    console.warn("[Cache] Write failed:", err);
  }
}
