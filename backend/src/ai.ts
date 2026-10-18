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

export interface ParaphraseStyleDetails {
  key: string;
  name: string;
  description: string;
  promptInstruction: string;
  discussionRequirement: string;
  summaryRequirement: string;
  markdownRequirement: string;
}

export const PARAPHRASE_STYLES: Record<string, ParaphraseStyleDetails> = {
  poin_singkat: {
    key: "poin_singkat",
    name: "Poin-poin Penting",
    description:
      "Deskripsi singkat (minimal 2 paragraf), to the point, padat, dan cepat dipindai pembaca (minimal 2 paragraf per poin dan ada penjelasan konteks yang terarah).",
    promptInstruction: `TIPE PARAFRASE: POIN-POIN PENTING (DENGAN PENJELASAN KONTEKS TERARAH)
Aturan Penulisan Wajib:
1. Deskripsi singkat, to the point, padat, lugas, dan cepat dipindai pembaca.
2. Pembahasan (discussion) untuk setiap topik/poin WAJIB ditulis MINIMAL 2 PARAGRAF LENGKAP dengan penjelasan konteks yang terarah (DILARANG hanya 1 paragraf atau hanya daftar bullet pendek).
   - Paragraf 1: Penjelasan konteks terarah, latar belakang masalah, dan urgensi pembahasan to-the-point.
   - Paragraf 2: Substansi dinamika pembahasan, rumusan solusi inti, dan arah kesepakatan secara padat.
3. Ringkasan Eksekutif (summary) WAJIB minimal 2 paragraf padat dan cepat dipindai.
4. Pada Dokumen Markdown (markdown): uraikan setiap topik bahasan minimal 2 paragraf padat dan berkonteks terarah.`,
    discussionRequirement:
      "WAJIB MINIMAL 2 PARAGRAF LENGKAP per poin/topik: Paragraf 1 menjelaskan konteks terarah dan esensi masalah, Paragraf 2 menjelaskan dinamika pembahasan serta rumusan solusi to-the-point secara padat dan mudah dipindai pembaca.",
    summaryRequirement: "Minimal 2 paragraf padat, to the point, dan cepat dipindai pembaca.",
    markdownRequirement:
      "Setiap topik bahasan wajib dijabarkan minimal 2 paragraf padat berkonteks terarah.",
  },
  detail_deskriptif: {
    key: "detail_deskriptif",
    name: "Detail & Deskriptif",
    description:
      "Penjelasan komprehensif latar belakang, argumen peserta, dan rincian aksi penjelasannya lengkap dengan konteks dengan minimalnya 4 paragraf panjang dan penuh pengetahuan dari hasil meeting dan juga tambahkan insight dan jelaskan juga yang deskriptif agar pembaca mengetahui meskipun tidak ikut meeting.",
    promptInstruction: `TIPE PARAFRASE: DETAIL & DESKRIPTIF (KOMPREHENSIF DENGAN PENGETAHUAN & INSIGHT MENDALAM)
Aturan Penulisan Wajib:
1. Penjelasan komprehensif mengenai latar belakang masalah, dinamika argumen peserta rapat, serta rincian teknis/operasional aksi secara utuh.
2. Pembahasan (discussion) untuk setiap topik/poin WAJIB ditulis MINIMAL 4 PARAGRAF PANJANG yang penuh pengetahuan dan konteks nyata dari hasil rapat (DILARANG SINGKAT/DILARANG HANYA 1-2 PARAGRAF).
   - Paragraf 1: Latar belakang masalah secara komprehensif, konteks industri/organisasi, dan akar persoalan yang mendasari rapat.
   - Paragraf 2: Dinamika diskusi, argumen dan pertimbangan yang diajukan para peserta rapat, serta alternatif yang sempat diperdebatkan.
   - Paragraf 3: Rincian teknis/operasional solusi, mekanisme eksekusi, pembagian tanggung jawab, dan rincian aksi tindak lanjut secara detail.
   - Paragraf 4 (Insight & Analisis Deskriptif): Uraian insight strategis dan penjelasan deskriptif yang mendalam sehingga siapapun yang TIDAK HADIR dalam rapat dapat memahami konteks, alasan keputusan, dan substansi meeting seutuhnya.
3. Ringkasan Eksekutif (summary) WAJIB minimal 3-4 paragraf panjang komprehensif dengan cakupan menyeluruh dan insight kunci.
4. Pada Dokumen Markdown (markdown): setiap topik agenda wajib memuat uraian mendalam minimal 4 paragraf panjang dan memuat sub-bagian Insight & Analisis Deskriptif.`,
    discussionRequirement:
      "WAJIB MINIMAL 4 PARAGRAF PANJANG per topik/poin: (1) Latar belakang & urgensi masalah, (2) Dinamika argumen & sudut pandang peserta, (3) Rincian teknis solusi & rencana aksi, (4) Insight strategis deskriptif yang sangat jelas agar pembaca yang tidak hadir rapat paham seutuhnya.",
    summaryRequirement:
      "Minimal 3-4 paragraf komprehensif mencakup latar belakang, dinamika rapat, keputusan, dan insight strategis.",
    markdownRequirement:
      "Setiap topik pembahasan wajib dijabarkan minimal 4 paragraf panjang mendalam dilengkapi latar belakang, argumen peserta, rincian teknis, dan insight deskriptif.",
  },
  eksekutif: {
    key: "eksekutif",
    name: "Ringkasan Eksekutif",
    description:
      "Deskripsi singkat (minimal 2 paragraf), to the point, padat, dan cepat dipindai pembaca (minimal 2 paragraf per poin dan ada penjelasan konteks yang terarah) dengan format strategis tingkat manajemen untuk pengambil keputusan beserta konteks dan analisis pro-kontra setiap keputusannya.",
    promptInstruction: `TIPE PARAFRASE: RINGKASAN EKSEKUTIF (FORMAT STRATEGIS TINGKAT MANAJEMEN & ANALISIS PRO-KONTRA)
Aturan Penulisan Wajib:
1. Format strategis tingkat manajemen tinggi untuk pengambil keputusan (C-Level / Board of Directors / Stakeholders).
2. Pembahasan (discussion) untuk setiap topik WAJIB ditulis MINIMAL 2 PARAGRAF TERARAH dengan fokus implikasi strategis, dampak organisasi, efisiensi sumber daya, dan mitigasi risiko.
3. WAJIB menyertakan ANALISIS PRO & KONTRA (pertimbangan keuntungan vs risiko/tantangan) secara eksplisit untuk setiap keputusan atau opsi yang disepakati.
4. Ringkasan Eksekutif (summary) WAJIB minimal 2-3 paragraf strategis padat berorientasi keputusan, implikasi bisnis, dan prioritas implementasi.
5. Pada Dokumen Markdown (markdown): setiap topik pembahasan wajib memuat uraian strategis minimal 2 paragraf plus analisis Pro & Kontra setiap keputusan.`,
    discussionRequirement:
      "WAJIB MINIMAL 2 PARAGRAF TERARAH berfokus strategis manajerial (dampak organisasi & mitigasi risiko), ditambah WAJIB menyertakan Analisis Pro & Kontra dari setiap keputusan yang disepakati.",
    summaryRequirement:
      "Minimal 2-3 paragraf strategis berstandar eksekutif manajemen, menonjolkan arah strategis, trade-offs, dan keputusan kunci.",
    markdownRequirement:
      "Setiap topik pembahasan wajib memuat minimal 2 paragraf terarah strategis dilengkapi analisis Pro-Kontra untuk pengambil keputusan.",
  },
};

export function resolveParaphraseStyle(styleInput?: string): ParaphraseStyleDetails {
  const norm = (styleInput || "").trim().toLowerCase();
  if (norm === "detail_deskriptif" || norm === "detail" || norm.includes("detail") || norm.includes("deskriptif")) {
    return PARAPHRASE_STYLES.detail_deskriptif;
  }
  if (norm === "eksekutif" || norm === "executive" || norm.includes("eksekutif") || norm.includes("manajemen")) {
    return PARAPHRASE_STYLES.eksekutif;
  }
  if (norm === "poin_singkat" || norm === "poin" || norm.includes("singkat") || norm.includes("poin")) {
    return PARAPHRASE_STYLES.poin_singkat;
  }
  if (styleInput && styleInput.trim().length > 0) {
    return {
      key: "kustom",
      name: `Kustom (${styleInput.trim()})`,
      description: styleInput.trim(),
      promptInstruction: `GAYA PENULISAN KUSTOM: ${styleInput.trim()}
Pastikan setiap topik bahasan diuraikan minimal 2 paragraf mendalam dengan penjelasan konteks yang terarah, serta menyertakan keputusan dan tindak lanjut yang jelas.`,
      discussionRequirement: `Wajib diuraikan minimal 2 paragraf mendalam sesuai instruksi kustom: "${styleInput.trim()}", mencakup konteks terarah dan penjelasan detail.`,
      summaryRequirement: `Minimal 2 paragraf padat sesuai instruksi: "${styleInput.trim()}".`,
      markdownRequirement: `Setiap topik pembahasan wajib dijabarkan minimal 2 paragraf mendalam sesuai instruksi: "${styleInput.trim()}".`,
    };
  }
  return PARAPHRASE_STYLES.poin_singkat;
}

export const PARAPHRASE_STYLE_PROMPTS: Record<string, string> = {
  poin_singkat: PARAPHRASE_STYLES.poin_singkat.description,
  detail_deskriptif: PARAPHRASE_STYLES.detail_deskriptif.description,
  eksekutif: PARAPHRASE_STYLES.eksekutif.description,
};

/**
 * Calls AI for MoM correction and goal-directed topic extraction.
 * Integrates the Jev-ultrafast structured goal-directed topic paradigm with rich style-based paraphrasing.
 */
export async function callAiCorrection(
  rawText: string,
  filename = "Audio Transkrip",
  durationS = 0,
  styleInput?: string
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

  const existingKnowledge = readKnowledge(4000);
  const activeStyle = resolveParaphraseStyle(styleInput || config.aiParaphraseStyle);

  const systemPrompt = `Anda adalah Sekretaris Notulis Eksekutif Senior berpengalaman 20 tahun yang bertugas menyusun Minutes of Meeting (MoM) profesional, mendalam, dan terarah (menggunakan paradigma Jev-Guided Topics).

TUGAS UTAMA:
1. Analisis transkrip audio mentah secara cermat, pertahankan seluruh fakta nyata, nama orang/peserta, tanggal, angka/data, istilah teknis, dan kesepakatan rapat.
2. JANGAN hanya membuat bullet poin dangkal/singkat! Anda WAJIB langsung memparafrase dan menjabarkan hasil rapat secara mendalam, jelas, dan kaya konteks sesuai Tipe Parafrase aktif: ${activeStyle.name}.
3. Terapkan seluruh aturan gaya penulisan berikut:
${activeStyle.promptInstruction}
4. Petakan pembahasan ke dalam 'directed_topics' (Topik Terarah): setiap topik memiliki sasaran (goal), pembahasan yang mendalam dan diparafrase (discussion), keputusan (decisions), dan tindak lanjut (action_items).
5. Buat dokumen MoM lengkap berformat Markdown resmi pada atribut 'markdown' (terdiri dari Informasi Rapat, Agenda, Pembahasan mendalam per topik, Tabel Keputusan, Tabel Tindak Lanjut, dan Catatan).
6. Ekstrak istilah teknis/domain baru ke 'terms' dan koreksi salah dengar STT ke 'corrections'.
7. Output WAJIB JSON murni tanpa markdown fence backticks (\`\`\`json).`;

  const userPrompt = `Metadata Rapat:
- File: ${filename}
- Durasi Audio: ${Math.round(durationS)} detik
- Model STT: Whisper.cpp (${config.whisperModel})
- Tipe Parafrase Aktif: ${activeStyle.name} (${activeStyle.key})

ATURAN KEDALAMAN DAN PANJANG KONTEN:
- Discussion per topik: ${activeStyle.discussionRequirement}
- Ringkasan eksekutif (summary): ${activeStyle.summaryRequirement}
- Dokumen Markdown (markdown): ${activeStyle.markdownRequirement}

Knowledge & Referensi Istilah:
${existingKnowledge || "- Belum ada knowledge tersimpan"}

Transkrip Mentah Whisper:
${rawText}

Panduan Struktur Dokumen Markdown 'markdown':
# Minutes of Meeting
## Informasi Umum Rapat
| Informasi | Keterangan |
|---|---|
| **Nama File** | ${filename} |
| **Tanggal Transkripsi** | ${new Date().toLocaleDateString("id-ID")} |
| **Durasi Audio** | ${Math.round(durationS)} detik |
| **Tipe Parafrase** | ${activeStyle.name} |
## Agenda Rapat
## Pembahasan (per Topik Terarah)
(Uraikan setiap topik secara mendalam sesuai aturan ${activeStyle.name}: ${activeStyle.markdownRequirement})
${activeStyle.key === "eksekutif" ? "### Analisis Pro & Kontra Keputusan Strategis\n(Sertakan pertimbangan pro & kontra untuk setiap keputusan penting)\n" : ""}
${activeStyle.key === "detail_deskriptif" ? "### Insight & Analisis Deskriptif\n(Uraian mendalam dan deskriptif agar pembaca yang tidak ikut meeting memahami konteks seutuhnya)\n" : ""}
## Keputusan / Kesepakatan (Tabel: No, Keputusan, PIC, Target Waktu)
## Tindak Lanjut (Action Items) (Tabel: No, Aksi, PIC, Deadline)
## Catatan Tambahan & Jadwal Rapat Berikutnya

Kembalikan output JSON dengan schema berikut:
{
  "summary": "${activeStyle.summaryRequirement}",
  "entities": ["Peserta / Pihak yang terdeteksi"],
  "directed_topics": [
    {
      "topic": "Nama topik terarah",
      "goal": "Sasaran pembahasan topik ini",
      "discussion": "${activeStyle.discussionRequirement}",
      "decisions": "Keputusan / kesepakatan final ${activeStyle.key === 'eksekutif' ? '(sertakan analisis pro-kontra keputusan)' : ''}",
      "action_items": ["Tindak lanjut spesifik topik ini"]
    }
  ],
  "markdown": "Dokumen Minutes of Meeting (MoM) final lengkap sesuai panduan struktur di atas dengan pembahasan mendalam",
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
    if (!Array.isArray(parsed.directed_topics) || parsed.directed_topics.length === 0) {
      parsed.directed_topics = extractTopicsFromMarkdown(parsed.markdown || parsed.corrected_text || rawText);
    }
    return { data: parsed, status: "completed" };
  } catch (err) {
    console.warn("[AI] AI correction failed:", err);
    return { data: null, status: "failed" };
  }
}

/**
 * Extracts structured topic cards from Markdown text if AI returns an empty directed_topics array.
 */
export function extractTopicsFromMarkdown(md: string): DirectedTopic[] {
  const topics: DirectedTopic[] = [];
  if (!md) return topics;

  const pembMatch = md.match(/## Pembahasan[^\n]*\n([\s\S]*?)(?=\n## |$)/i);
  const content = pembMatch ? pembMatch[1] : md;

  const blocks = content.split(/^### /m);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const rawTitle = lines[0]?.replace(/^###\s*/, "").trim();
    if (!rawTitle || /^(Informasi|Agenda|Keputusan|Tindak|Catatan)/i.test(rawTitle)) continue;

    const restLines = lines.slice(1);
    let goal = "";
    const discussionLines: string[] = [];
    let decisions = "";
    const actionItems: string[] = [];

    for (const l of restLines) {
      const gMatch = l.match(/^>*\s*\**(?:Sasaran|Goal|Tujuan)\**[:\s]+(.+)$/i);
      const dMatch = l.match(/^>*\s*\**(?:Keputusan|Kesepakatan)\**[:\s]+(.+)$/i);
      const aMatch = l.match(/^[-*]\s*(?:Aksi|Action Item|Tindak Lanjut)[:\s]+(.+)$/i);

      if (gMatch && !goal) {
        goal = gMatch[1].trim();
      } else if (dMatch && !decisions) {
        decisions = dMatch[1].trim();
      } else if (aMatch) {
        actionItems.push(aMatch[1].trim());
      } else {
        discussionLines.push(l);
      }
    }

    const discussion = discussionLines.join("\n").trim() || trimmed;
    topics.push({
      topic: rawTitle.replace(/^\d+[\.\s]+/, "").trim(),
      goal,
      discussion,
      decisions,
      action_items: actionItems,
    });
  }

  return topics;
}

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

  const activeStyle = resolveParaphraseStyle(style);

  const systemPrompt = `Anda adalah Sekretaris Notulis Eksekutif Senior berpengalaman 20 tahun.
Tugas Anda adalah memparafrase dan menyusun ulang hasil transkrip/dokumen rapat ke dalam gaya penulisan: ${activeStyle.name} (${activeStyle.key}).

ATURAN GAYA PENULISAN & KEDALAMAN:
${activeStyle.promptInstruction}

ATURAN PENTING:
1. Pertahankan seluruh fakta nyata, nama orang/pimpinan/peserta, tanggal, keputusan, kesepakatan, PIC, deadline, istilah teknis, dan struktur dokumen Minutes of Meeting resmi.
2. JANGAN hanya membuat bullet poin pendek atau ringkasan dangkal! Wajib mematuhi jumlah paragraf dan kedalaman:
   - Pembahasan topik terarah ('discussion'): ${activeStyle.discussionRequirement}
   - Dokumen Markdown ('markdown'): ${activeStyle.markdownRequirement}
   - Ringkasan eksekutif ('summary'): ${activeStyle.summaryRequirement}
3. Array 'directed_topics' WAJIB diisi (DILARANG kosong []). Petakan setiap pembahasan ke dalam objek topik terarah.
4. Hasil output harus menghasilkan data terstruktur lengkap yang sama persis seperti hasil transkripsi AI awal:
   - Dokumen Markdown Minutes of Meeting (MoM) final lengkap (# Minutes of Meeting, ## Informasi Umum Rapat, ## Agenda Rapat, ## Pembahasan per Topik, ## Keputusan / Kesepakatan tabel, ## Tindak Lanjut tabel, ## Catatan Tambahan)
   - Ringkasan eksekutif ('summary')
   - Ekstraksi topik terarah ('directed_topics') lengkap dengan goal/sasaran, pembahasan yang sudah diparafrase mendalam, keputusan, dan action items.

Output WAJIB berupa JSON murni tanpa pembuka Markdown fence (\`\`\`json) dengan schema:
{
  "summary": "${activeStyle.summaryRequirement}",
  "directed_topics": [
    {
      "topic": "Nama topik terarah",
      "goal": "Sasaran pembahasan topik ini",
      "discussion": "${activeStyle.discussionRequirement}",
      "decisions": "Keputusan / kesepakatan final ${activeStyle.key === 'eksekutif' ? '(sertakan analisis pro-kontra keputusan)' : ''}",
      "action_items": ["Tindak lanjut spesifik topik ini"]
    }
  ],
  "markdown": "Dokumen Minutes of Meeting (MoM) final lengkap format Markdown sesuai gaya yang diminta dengan pembahasan mendalam",
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
    let directed_topics = Array.isArray(parsed.directed_topics) ? parsed.directed_topics : [];

    if (directed_topics.length === 0) {
      directed_topics = extractTopicsFromMarkdown(markdown);
    }

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
      directed_topics: extractTopicsFromMarkdown(text),
    };
  }
}
