import fs from "node:fs";
import path from "node:path";
import { config, PATHS } from "./config";
import { readKnowledge, ensureKnowledgeFiles } from "./knowledge";

export interface DirectedTopic {
  topic: string;
  goal: string;
  discussion: string;
  decisions: string;
  action_items?: string[];
}

export interface AiCorrectionResult {
  corrected_text: string;
  markdown: string;
  summary: string;
  entities?: string[];
  directed_topics?: DirectedTopic[];
  terms?: Array<{ term: string; alias?: string[]; meaning: string }>;
  corrections?: Array<{ wrong: string; correct: string; reason: string }>;
  concepts?: Array<{ name: string; description: string }>;
  action_items?: string[];
  notes?: string[];
}

export function isAiConfigured(): boolean {
  return Boolean(config.aiBaseUrl && config.aiApiKey && config.aiModelId);
}

/**
 * Makes an HTTP request to an OpenAI-compatible endpoint.
 * Supports both direct JSON response and chunked SSE (data: {...}) responses.
 */
async function callOpenAiCompatible(
  prompt: string,
  systemPrompt: string,
  overrideConfig?: { baseUrl?: string; apiKey?: string; modelId?: string }
): Promise<string> {
  const baseUrl = (overrideConfig?.baseUrl || config.aiBaseUrl).replace(/\/+$/, "");
  const apiKey = overrideConfig?.apiKey || config.aiApiKey;
  const modelId = overrideConfig?.modelId || config.aiModelId;

  const endpoint = `${baseUrl}/chat/completions`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.aiTimeoutS * 1000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI model provider mengembalikan status ${res.status}: ${errText.slice(0, 300)}`);
    }

    const rawResponse = await res.text();

    // Check if the response is Server-Sent Events (SSE) streaming format
    if (rawResponse.trim().startsWith("data:")) {
      const parts: string[] = [];
      const lines = rawResponse.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            parts.push(delta.content);
          }
        } catch {
          // ignore parsing error for chunk
        }
      }
      return parts.join("").trim();
    }

    // Direct JSON response
    const json = JSON.parse(rawResponse);
    const content = json.choices?.[0]?.message?.content || "";
    return content.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parses JSON output from AI, handling markdown code fences.
 */
function extractJsonFromAiResponse(raw: string): any {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end >= 0) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned);
}

/**
 * Test AI model connection.
 */
export async function testAiConnection(
  baseUrl: string,
  apiKey: string,
  modelId: string
): Promise<{ success: boolean; message: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const reply = await callOpenAiCompatible(
      "Ping connection test. Jawab hanya satu kata: OK",
      "Anda adalah asisten penguji koneksi sistem.",
      { baseUrl, apiKey, modelId }
    );
    const latencyMs = Date.now() - start;
    return {
      success: true,
      message: `Terhubung berhasil. Model menjawab: "${reply.slice(0, 50)}..."`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || "Gagal menghubungi AI model",
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Calls AI for MoM correction and goal-directed topic extraction.
 * Integrates the Jev-ultrafast structured goal-directed topic paradigm.
 */
export async function callAiCorrection(
  rawText: string,
  filename = "Audio Transkrip",
  durationS = 0
): Promise<{ data: AiCorrectionResult | null; status: "completed" | "skipped" | "failed" }> {
  if (!config.aiEnableCorrection || !isAiConfigured()) {
    return { data: null, status: "skipped" };
  }

  ensureKnowledgeFiles();

  let ragInstructions = "";
  try {
    ragInstructions = fs.readFileSync(path.join(PATHS.knowledgeDir, "RAG.md"), "utf-8");
  } catch {
    ragInstructions = "";
  }

  let formatMom = "";
  try {
    formatMom = fs.readFileSync(path.join(PATHS.knowledgeDir, "format-mom.md"), "utf-8");
  } catch {
    formatMom = "";
  }

  const existingKnowledge = readKnowledge(4000);

  const systemPrompt = `Anda adalah Sekretaris Notulis Senior yang bertugas menyusun Minutes of Meeting (MoM) profesional dan terarah (menggunakan paradigma Jev-Guided Topics).

Tugas Utama:
1. Analisis transkrip audio secara cermat, pertahankan fakta dan keputusan rapat.
2. Petakan pembahasan ke dalam 'directed_topics' (Topik Terarah): setiap topik memiliki sasaran (goal), pembahasan terarah (discussion), keputusan (decisions), dan tindak lanjut (action_items).
3. Ekstrak istilah teknis/domain baru ke 'terms' dan koreksi salah dengar STT ke 'corrections'.
4. Buat dokumen MoM lengkap berformat Markdown pada atribut 'markdown'.
5. Output WAJIB JSON murni tanpa markdown fence backticks.`;

  const userPrompt = `Metadata Rapat:
- File: ${filename}
- Durasi Audio: ${Math.round(durationS)} detik
- Model STT: Whisper.cpp (${config.whisperModel})

Knowledge & Referensi Istilah:
${existingKnowledge || "- Belum ada knowledge tersimpan"}

Transkrip Mentah Whisper:
${rawText}

Panduan Struktur Dokumen Markdown 'markdown':
# Minutes of Meeting
## Informasi Umum Rapat (Nama Rapat, Tanggal, Peserta)
## Agenda Rapat
## Pembahasan (per Topik Terarah)
## Keputusan / Kesepakatan (Tabel: No, Keputusan, PIC, Target Waktu)
## Tindak Lanjut (Action Items) (Tabel: No, Aksi, PIC, Deadline)
## Catatan Tambahan & Jadwal Rapat Berikutnya

Kembalikan output JSON dengan schema berikut:
{
  "summary": "Ringkasan eksekutif jalannya rapat 1-2 paragraf",
  "entities": ["Peserta / Pihak yang terdeteksi"],
  "directed_topics": [
    {
      "topic": "Nama topik terarah",
      "goal": "Sasaran pembahasan topik ini",
      "discussion": "Poin pembahasan terarah",
      "decisions": "Keputusan / kesepakatan final",
      "action_items": ["Tindak lanjut spesifik topik ini"]
    }
  ],
  "markdown": "Dokumen Minutes of Meeting (MoM) final lengkap sesuai panduan struktur di atas",
  "terms": [
    {
      "term": "Istilah teknis/domain",
      "alias": ["Singkatan/alias jika ada"],
      "meaning": "Pengertian istilah berdasarkan konteks"
    }
  ],
  "corrections": [
    {
      "wrong": "Kata salah dengar Whisper",
      "correct": "Kata yang benar",
      "reason": "Alasan koreksi"
    }
  ],
  "concepts": [
    {
      "name": "Nama konsep penting",
      "description": "Deskripsi ringkas"
    }
  ],
  "action_items": [
    "Daftar tindak lanjut umum beserta PIC dan tenggat"
  ],
  "notes": [
    "Catatan penting notulis"
  ]
}
`;

  try {
    const rawAiResponse = await callOpenAiCompatible(userPrompt, systemPrompt);
    const parsed = extractJsonFromAiResponse(rawAiResponse);
    if (!parsed.corrected_text) {
      parsed.corrected_text = parsed.markdown || parsed.summary || rawText;
    }
    return { data: parsed, status: "completed" };
  } catch (err) {
    console.warn("[AI] AI correction failed:", err);
    return { data: null, status: "failed" };
  }
}

export const PARAPHRASE_STYLE_PROMPTS: Record<string, string> = {
  detail_deskriptif:
    "sangat detail, komprehensif, dan deskriptif. Jabarkan setiap topik agenda secara mendalam mencakup latar belakang, konteks pembahasan, pertimbangan teknis/operasional, rumusan kesepakatan secara terperinci, dan rincian tindak lanjut (Action Items) lengkap dengan PIC serta tenggat waktu.",
  poin_singkat:
    "terstruktur dalam poin-poin penting bernomor dengan deskripsi singkat, lugas, padat, dan to-the-point. Tonjolkan esensi pokok bahasan, keputusan inti, dan daftar aksi tindak lanjut agar sangat cepat dipindai dan mudah dipahami pembaca.",
  eksekutif:
    "berstandar ringkasan eksekutif (Executive Summary) profesional tingkat manajemen yang menonjolkan poin strategis, dampak organisasi, keputusan final, dan aksi kunci.",
};

export interface ParaphraseResult {
  text: string;
  markdown: string;
  summary: string;
  directed_topics: Array<{
    topic: string;
    goal: string;
    discussion: string;
    decisions: string;
    action_items: string[];
  }>;
  entities?: string[];
  terms?: any[];
  action_items?: any[];
}

/**
 * Paraphrases text into a requested style, returning the full structured MoM output
 * so that all 3 outputs (Markdown MoM, HTML/UI Summary, Markmap) update identically to transcription results.
 */
export async function callAiParaphrase(text: string, style = "poin_singkat"): Promise<ParaphraseResult> {
  if (!isAiConfigured()) {
    throw new Error("Konfigurasi AI belum lengkap (URL, API-Key, atau Model belum diisi).");
  }

  let rag = "";
  try {
    rag = fs.readFileSync(path.join(PATHS.knowledgeDir, "RAG.md"), "utf-8");
  } catch {
    rag = "";
  }

  const resolvedInstruction =
    PARAPHRASE_STYLE_PROMPTS[style] ||
    (style === "detail" ? PARAPHRASE_STYLE_PROMPTS.detail_deskriptif : null) ||
    (style === "poin" ? PARAPHRASE_STYLE_PROMPTS.poin_singkat : null) ||
    style;

  const systemPrompt = `Anda adalah Sekretaris Notulis Eksekutif Senior berpengalaman 20 tahun.
Tugas Anda adalah memparafrase dan menyusun ulang hasil transkrip rapat ke dalam gaya penulisan: ${resolvedInstruction}

ATURAN PENTING:
1. Pertahankan seluruh fakta nyata, nama orang/pimpinan/peserta, tanggal, keputusan, kesepakatan, PIC, deadline, istilah teknis, dan struktur dokumen Minutes of Meeting resmi.
2. Hasil output harus menghasilkan data terstruktur lengkap yang sama persis seperti hasil transkripsi AI awal:
   - Dokumen Markdown Minutes of Meeting (MoM) final lengkap (# Minutes of Meeting, ## Informasi Umum Rapat, ## Agenda Rapat, ## Pembahasan per Topik, ## Keputusan / Kesepakatan tabel, ## Tindak Lanjut tabel, ## Catatan Tambahan)
   - Ringkasan eksekutif 1-2 paragraf ('summary')
   - Ekstraksi topik terarah ('directed_topics') lengkap dengan goal/sasaran, pembahasan yang sudah diparafrase, keputusan, dan action items.

Output WAJIB berupa JSON murni tanpa pembuka Markdown fence (\`\`\`json) dengan schema:
{
  "summary": "Ringkasan eksekutif jalannya rapat 1-2 paragraf sesuai gaya yang diminta",
  "directed_topics": [
    {
      "topic": "Nama topik terarah",
      "goal": "Sasaran pembahasan topik ini",
      "discussion": "Poin pembahasan terarah yang sudah diparafrase sesuai gaya yang diminta",
      "decisions": "Keputusan / kesepakatan final",
      "action_items": ["Tindak lanjut spesifik topik ini"]
    }
  ],
  "markdown": "Dokumen Minutes of Meeting (MoM) final lengkap format Markdown sesuai gaya yang diminta",
  "text": "Sama dengan isi markdown di atas"
}`;

  const userPrompt = `
Instruksi Acuan / RAG:
${rag.slice(0, 8000)}

Dokumen Rapat Asli yang Diparafrase:
${text}
`;

  try {
    const rawAiResponse = await callOpenAiCompatible(userPrompt, systemPrompt);
    const parsed = extractJsonFromAiResponse(rawAiResponse);
    const markdown = parsed.markdown || parsed.text || rawAiResponse;
    const summary = parsed.summary || "";
    const directed_topics = Array.isArray(parsed.directed_topics) ? parsed.directed_topics : [];

    return {
      text: markdown,
      markdown,
      summary,
      directed_topics,
      entities: parsed.entities || [],
      terms: parsed.terms || [],
      action_items: parsed.action_items || [],
    };
  } catch (err: any) {
    console.warn("[AI] AI paraphrase fallback:", err);
    return {
      text,
      markdown: text,
      summary: "",
      directed_topics: [],
    };
  }
}
