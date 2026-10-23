import fs from "node:fs";
import path from "node:path";
import { config, PATHS } from "./config";
import {
  saveKnowledgeItem,
  getAllKnowledge,
  getGlossaryTitles as dbGetGlossaryTitles,
  countKnowledgeItems,
} from "./db";

/**
 * Migrates existing Markdown files from backend/knowledge to the database table `knowledge`.
 * Once imported, the folder is removed from disk.
 */
export async function migrateKnowledgeFilesToDb(): Promise<void> {
  const kDir = PATHS.knowledgeDir;
  if (!fs.existsSync(kDir)) {
    return;
  }

  console.log("[Knowledge] Memulai migrasi knowledge dari folder ke Database...");

  try {
    // 1. Glossary
    const glossaryPath = path.join(kDir, "glossary.md");
    if (fs.existsSync(glossaryPath)) {
      const content = fs.readFileSync(glossaryPath, "utf-8");
      const sections = content.split(/\n##\s+/).filter(Boolean);
      for (let i = 1; i < sections.length; i++) {
        const lines = sections[i].split("\n");
        const title = lines[0].trim();
        const body = lines.slice(1).join("\n").trim();
        const sourceMatch = body.match(/Sumber:\s*(.+)/i);
        const source = sourceMatch ? sourceMatch[1].trim() : null;
        if (title && body) {
          await saveKnowledgeItem({
            category: "glossary",
            title,
            content: body,
            source,
          });
        }
      }
    }

    // 2. Corrections
    const correctionsPath = path.join(kDir, "corrections.md");
    if (fs.existsSync(correctionsPath)) {
      const content = fs.readFileSync(correctionsPath, "utf-8");
      const sections = content.split(/\n##\s+/).filter(Boolean);
      for (let i = 1; i < sections.length; i++) {
        const lines = sections[i].split("\n");
        const title = lines[0].trim();
        const body = lines.slice(1).join("\n").trim();
        const sourceMatch = body.match(/Sumber:\s*(.+)/i);
        const source = sourceMatch ? sourceMatch[1].trim() : null;
        if (title && body) {
          await saveKnowledgeItem({
            category: "correction",
            title,
            content: body,
            source,
          });
        }
      }
    }

    // 3. Concepts
    const conceptsPath = path.join(kDir, "concepts.md");
    if (fs.existsSync(conceptsPath)) {
      const content = fs.readFileSync(conceptsPath, "utf-8");
      const sections = content.split(/\n##\s+/).filter(Boolean);
      for (let i = 1; i < sections.length; i++) {
        const lines = sections[i].split("\n");
        const title = lines[0].trim();
        const body = lines.slice(1).join("\n").trim();
        const sourceMatch = body.match(/Sumber:\s*(.+)/i);
        const source = sourceMatch ? sourceMatch[1].trim() : null;
        if (title && body) {
          await saveKnowledgeItem({
            category: "concept",
            title,
            content: body,
            source,
          });
        }
      }
    }

    // 4. Transcript Notes
    const notesPath = path.join(kDir, "transcript-notes.md");
    if (fs.existsSync(notesPath)) {
      const content = fs.readFileSync(notesPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().startsWith("-"));
      for (const line of lines) {
        const text = line.replace(/^-+\s*/, "").trim();
        const sourceMatch = text.match(/_\(([^)]+)\)_$/);
        const source = sourceMatch ? sourceMatch[1].trim() : null;
        const cleanText = text.replace(/\s*_\([^)]+\)_$/, "").trim();
        if (cleanText) {
          await saveKnowledgeItem({
            category: "note",
            title: cleanText.slice(0, 100),
            content: cleanText,
            source,
          });
        }
      }
    }

    // 5. format-mom.md
    const momPath = path.join(kDir, "format-mom.md");
    if (fs.existsSync(momPath)) {
      const momContent = fs.readFileSync(momPath, "utf-8");
      await saveKnowledgeItem({
        category: "format_mom",
        title: "format-mom.md",
        content: momContent,
      });
    }

    // 6. RAG.md
    const ragPath = path.join(kDir, "RAG.md");
    if (fs.existsSync(ragPath)) {
      const ragContent = fs.readFileSync(ragPath, "utf-8");
      await saveKnowledgeItem({
        category: "rag_instructions",
        title: "RAG.md",
        content: ragContent,
      });
    }

    const totalCount = await countKnowledgeItems();
    console.log(`[Knowledge] ✓ Sukses memigrasi ${totalCount} entitas knowledge ke Database.`);

    // Remove the knowledge directory from disk
    fs.rmSync(kDir, { recursive: true, force: true });
    console.log("[Knowledge] ✓ Folder 'backend/knowledge' pada disk telah dibersihkan.");
  } catch (err) {
    console.error("[Knowledge] Gagal migrasi file knowledge:", err);
  }
}

/**
 * Backward compatibility stub (all storage is now database-backed).
 */
export function ensureKnowledgeFiles(): void {
  // Knowledge storage is now 100% in database
}

/**
 * Reads knowledge context directly from the database for LLM RAG prompts.
 */
export async function readKnowledge(limit = 20000): Promise<string> {
  if (!config.aiEnableRag) return "";

  try {
    const items = await getAllKnowledge(150);
    if (!items.length) return "";

    const grouped: Record<string, string[]> = {
      glossary: [],
      correction: [],
      concept: [],
      note: [],
    };

    for (const item of items) {
      if (grouped[item.category]) {
        grouped[item.category].push(`### ${item.title}\n${item.content}`);
      }
    }

    const chunks: string[] = [];
    if (grouped.glossary.length) {
      chunks.push(`## Istilah Penting (Glossary)\n${grouped.glossary.join("\n\n")}`);
    }
    if (grouped.correction.length) {
      chunks.push(`## Koreksi Salah Dengar (Corrections)\n${grouped.correction.join("\n\n")}`);
    }
    if (grouped.concept.length) {
      chunks.push(`## Konsep Rapat (Concepts)\n${grouped.concept.join("\n\n")}`);
    }
    if (grouped.note.length) {
      chunks.push(`## Catatan Tambahan (Notes)\n${grouped.note.join("\n\n")}`);
    }

    return chunks.join("\n\n").slice(0, limit);
  } catch (err) {
    console.warn("[Knowledge] Gagal membaca knowledge dari database:", err);
    return "";
  }
}

/**
 * Retrieves glossary titles for Whisper domain prompts directly from database.
 */
export async function getGlossaryPromptTerms(): Promise<string> {
  try {
    const titles = await dbGetGlossaryTitles(35);
    return titles.filter(Boolean).join(", ");
  } catch {
    return "";
  }
}

/**
 * Updates knowledge base directly into the database.
 */
export async function updateKnowledge(jobId: string, aiData: any): Promise<void> {
  if (!config.aiEnableKnowledgeExtraction || !aiData) return;

  // 1. Glossary terms
  if (Array.isArray(aiData.terms)) {
    for (const item of aiData.terms) {
      const term = (item.term || "").trim();
      if (term) {
        const aliases = Array.isArray(item.alias) ? item.alias.join(", ") : "";
        const meaning = item.meaning || "";
        const content = `- Alias: ${aliases}\n- Arti: ${meaning}\n- Sumber: job_id=${jobId}`;
        await saveKnowledgeItem({
          category: "glossary",
          title: term,
          content,
          source: `job_id=${jobId}`,
        });
      }
    }
  }

  // 2. Corrections
  if (Array.isArray(aiData.corrections)) {
    for (const item of aiData.corrections) {
      const wrong = (item.wrong || "").trim();
      const correct = (item.correct || "").trim();
      if (wrong && correct) {
        const reason = item.reason || "";
        const content = `- Salah dengar: ${wrong}\n- Koreksi: ${correct}\n- Alasan: ${reason}\n- Sumber: job_id=${jobId}`;
        await saveKnowledgeItem({
          category: "correction",
          title: `${wrong} -> ${correct}`,
          content,
          source: `job_id=${jobId}`,
        });
      }
    }
  }

  // 3. Concepts
  if (Array.isArray(aiData.concepts)) {
    for (const item of aiData.concepts) {
      const name = (item.name || "").trim();
      if (name) {
        const desc = item.description || "";
        const content = `- Deskripsi: ${desc}\n- Sumber: job_id=${jobId}`;
        await saveKnowledgeItem({
          category: "concept",
          title: name,
          content,
          source: `job_id=${jobId}`,
        });
      }
    }
  }

  // 4. Notes
  if (Array.isArray(aiData.notes)) {
    for (const note of aiData.notes) {
      if (typeof note === "string" && note.trim()) {
        await saveKnowledgeItem({
          category: "note",
          title: note.trim().slice(0, 100),
          content: note.trim(),
          source: `job_id=${jobId}`,
        });
      }
    }
  }
}
