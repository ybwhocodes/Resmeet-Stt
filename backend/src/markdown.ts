import fs from "node:fs";
import path from "node:path";
import { config, PATHS } from "./config";
import { ensureKnowledgeFiles } from "./knowledge";
import { AiCorrectionResult } from "./ai";

function formatList(items?: any[] | null): string {
  if (!items || !items.length) return "- Tidak ada";
  return items
    .map((item) => {
      if (typeof item === "string") return `- ${item}`;
      if (typeof item === "object") {
        const label = item.term || item.name || item.correct || item.wrong || "Item";
        const detail = item.meaning || item.description || item.reason || "";
        return detail ? `- **${label}**: ${detail}` : `- **${label}**`;
      }
      return `- ${String(item)}`;
    })
    .join("\n");
}

function formatDirectedTopics(topics?: any[] | null): string {
  if (!topics || !topics.length) return "- Tidak ada topik terarah yang spesifik terdeteksi.";
  return topics
    .map((t, idx) => {
      const title = t.topic || `Topik ${idx + 1}`;
      const goal = t.goal ? `\n> **Sasaran / Goal**: ${t.goal}\n` : "";
      const disc = t.discussion ? `\n**Pembahasan**:\n${t.discussion}\n` : "";
      const dec = t.decisions ? `\n**Keputusan**:\n${t.decisions}\n` : "";
      const actions = t.action_items && t.action_items.length
        ? `\n**Tindak Lanjut**:\n${t.action_items.map((a: string) => `- ${a}`).join("\n")}\n`
        : "";
      return `### ${idx + 1}. ${title}${goal}${disc}${dec}${actions}`;
    })
    .join("\n---\n\n");
}

export function renderMarkdown(
  jobId: string,
  filename: string,
  durationS: number,
  finalText: string,
  aiData: AiCorrectionResult | null,
  aiStatus: string
): string {
  ensureKnowledgeFiles();

  let mdContent = aiData?.markdown;

  if (!mdContent) {
    mdContent = `# Minutes of Meeting

## Informasi Rapat

| Informasi | Keterangan |
|---|---|
| **Nama File** | ${filename} |
| **Tanggal Transkripsi** | ${new Date().toLocaleString("id-ID")} |
| **Durasi Audio** | ${Math.round(durationS * 100) / 100} detik |
| **Model STT** | Whisper.cpp (${config.whisperModel}) |
| **Koreksi AI & Topik Terarah** | ${aiStatus} |

## Ringkasan

${aiData?.summary || "Tidak ada ringkasan"}

## Topik Terarah & Hasil Pembahasan

${formatDirectedTopics(aiData?.directed_topics)}

## Transkrip / Catatan Pembahasan

${finalText || "Tidak ada"}

## Keputusan / Kesepakatan

${aiData?.directed_topics?.map((t) => t.decisions).filter(Boolean).map((d) => `- ${d}`).join("\n") || "Tidak disebutkan"}

## Tindak Lanjut (Action Items)

${formatList(aiData?.action_items)}

## Istilah Penting

${formatList(aiData?.terms)}

## Konsep Baru

${formatList(aiData?.concepts)}

## Koreksi Salah Dengar

${formatList(aiData?.corrections)}

## Catatan Tambahan

${formatList(aiData?.notes)}
`;
  }

  const outputPath = path.join(PATHS.transcriptsMdDir, `${jobId}.md`);
  fs.writeFileSync(outputPath, mdContent, "utf-8");
  return outputPath;
}
