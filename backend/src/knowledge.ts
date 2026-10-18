import fs from "node:fs";
import path from "node:path";
import { PATHS, config } from "./config";

export function ensureKnowledgeFiles(): void {
  fs.mkdirSync(PATHS.knowledgeDir, { recursive: true });
  fs.mkdirSync(PATHS.transcriptsMdDir, { recursive: true });
  fs.mkdirSync(PATHS.uploadDir, { recursive: true });

  const defaults: Record<string, string> = {
    "format-mom.md": `# Minutes of Meeting

## Metadata

- File: {{filename}}
- Tanggal: {{created_at}}
- Durasi: {{duration_s}} detik
- Model STT: {{whisper_model}}
- Koreksi AI: {{ai_correction_status}}

## Ringkasan

{{summary}}

## Topik Terarah & Hasil Pembahasan

{{directed_topics}}

## Transkrip Final

{{final_transcript}}

## Istilah Penting

{{terms}}

## Konsep Baru

{{concepts}}

## Koreksi Penting

{{corrections}}

## Action Items

{{action_items}}

## Catatan

{{notes}}
`,
    "glossary.md": "# Glossary\n",
    "corrections.md": "# Corrections\n",
    "concepts.md": "# Concepts\n",
    "transcript-notes.md": "# Transcript Notes\n",
  };

  for (const [name, content] of Object.entries(defaults)) {
    const fullPath = path.join(PATHS.knowledgeDir, name);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, content, "utf-8");
    }
  }
}

export function readKnowledge(limit = 20000): string {
  if (!config.aiEnableRag) return "";
  ensureKnowledgeFiles();

  const names = ["glossary.md", "corrections.md", "concepts.md", "transcript-notes.md"];
  const chunks: string[] = [];

  for (const name of names) {
    const filePath = path.join(PATHS.knowledgeDir, name);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        chunks.push(`## ${name}\n${content}`);
      } catch (err) {
        console.warn(`[Knowledge] Gagal membaca ${name}:`, err);
      }
    }
  }

  return chunks.join("\n\n").slice(0, limit);
}

export function getGlossaryPromptTerms(): string {
  try {
    const glossaryPath = path.join(PATHS.knowledgeDir, "glossary.md");
    if (!fs.existsSync(glossaryPath)) return "";
    const content = fs.readFileSync(glossaryPath, "utf-8");
    const matches = content.match(/^##\s+(.+)$/gm) || [];
    const terms = matches.map((m) => m.replace(/^##\s+/, "").trim()).filter(Boolean);
    return terms.slice(0, 35).join(", ");
  } catch {
    return "";
  }
}

function appendUnique(filePath: string, marker: string, block: string): void {
  let oldContent = "";
  if (fs.existsSync(filePath)) {
    oldContent = fs.readFileSync(filePath, "utf-8");
  }
  if (oldContent.toLowerCase().includes(marker.toLowerCase())) {
    return;
  }
  fs.appendFileSync(filePath, `\n${block.trim()}\n`, "utf-8");
}

export function updateKnowledge(jobId: string, aiData: any): void {
  if (!config.aiEnableKnowledgeExtraction || !aiData) return;
  ensureKnowledgeFiles();

  // 1. Glossary terms
  if (Array.isArray(aiData.terms)) {
    const glossaryPath = path.join(PATHS.knowledgeDir, "glossary.md");
    for (const item of aiData.terms) {
      const term = (item.term || "").trim();
      if (term) {
        const aliases = Array.isArray(item.alias) ? item.alias.join(", ") : "";
        const meaning = item.meaning || "";
        const block = `## ${term}\n\n- Alias: ${aliases}\n- Arti: ${meaning}\n- Sumber: job_id=${jobId}`;
        appendUnique(glossaryPath, `## ${term}`, block);
      }
    }
  }

  // 2. Corrections
  if (Array.isArray(aiData.corrections)) {
    const correctionsPath = path.join(PATHS.knowledgeDir, "corrections.md");
    for (const item of aiData.corrections) {
      const wrong = (item.wrong || "").trim();
      const correct = (item.correct || "").trim();
      if (wrong && correct) {
        const reason = item.reason || "";
        const block = `## ${wrong} -> ${correct}\n\n- Salah dengar: ${wrong}\n- Koreksi: ${correct}\n- Alasan: ${reason}\n- Sumber: job_id=${jobId}`;
        appendUnique(correctionsPath, `## ${wrong} -> ${correct}`, block);
      }
    }
  }

  // 3. Concepts
  if (Array.isArray(aiData.concepts)) {
    const conceptsPath = path.join(PATHS.knowledgeDir, "concepts.md");
    for (const item of aiData.concepts) {
      const name = (item.name || "").trim();
      if (name) {
        const desc = item.description || "";
        const block = `## ${name}\n\n- Deskripsi: ${desc}\n- Sumber: job_id=${jobId}`;
        appendUnique(conceptsPath, `## ${name}`, block);
      }
    }
  }

  // 4. Notes
  if (Array.isArray(aiData.notes)) {
    const notesPath = path.join(PATHS.knowledgeDir, "transcript-notes.md");
    for (const note of aiData.notes) {
      if (typeof note === "string" && note.trim()) {
        const block = `- ${note.trim()} _(job_id=${jobId})_`;
        appendUnique(notesPath, `- ${note.trim()}`, block);
      }
    }
  }
}
