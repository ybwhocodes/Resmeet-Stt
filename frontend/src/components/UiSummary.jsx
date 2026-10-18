import React, { useState, useMemo } from "react";
import {
  FileText, Target, CheckCircle2, ListTodo, Download,
  Copy, Check, Calendar, Clock, Sparkles, User, Users,
  ShieldCheck, MapPin, CheckSquare, Square, ChevronRight,
  AlertCircle, FileAudio, ExternalLink, Bookmark
} from "lucide-react";

/**
 * Robust parser that extracts structured MoM data from Markdown text.
 * Works seamlessly for historical database records and new transcripts.
 */
function parseMarkdownToUi(md) {
  if (!md || typeof md !== "string") {
    return { info: {}, agendas: [], topics: [], decisions: [], actionItems: [], notes: "" };
  }

  const info = {};
  const agendas = [];
  const topics = [];
  const decisions = [];
  const actionItems = [];
  let notes = "";

  const sections = md.split(/^## /m);

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sec = sections[sIdx];
    const lines = sec.split("\n");
    const rawTitle = lines[0].trim();
    const content = lines.slice(1).join("\n").trim();

    if (/Informasi/i.test(rawTitle)) {
      for (const line of lines.slice(1)) {
        // Table row: | **Key** | Value |
        const tableMatch = line.match(/\|\s*\*\*?([^*|:]+)\*\*?:?\s*\|\s*([^|]+)\|/);
        if (tableMatch) {
          info[tableMatch[1].trim()] = tableMatch[2].trim().replace(/<br\s*\/?>/gi, ", ");
          continue;
        }
        // Bullet row: - **Key:** Value
        const bulletMatch = line.match(/^[-*]\s*\*\*?([^*:]+)\*\*?:?\s*(.+)$/);
        if (bulletMatch) {
          info[bulletMatch[1].trim()] = bulletMatch[2].trim();
        }
      }
    } else if (/Agenda/i.test(rawTitle)) {
      for (const line of lines.slice(1)) {
        const m = line.match(/^(?:[-*]|\d+\.)\s*(.+)$/);
        if (m) {
          const text = m[1].trim();
          if (text && !text.startsWith("|")) agendas.push(text);
        }
      }
    } else if (/Pembahasan/i.test(rawTitle)) {
      const topicBlocks = content.split(/^### /m);
      for (const tb of topicBlocks) {
        const tLines = tb.trim().split("\n");
        const tTitle = tLines[0].trim();
        const tContent = tLines.slice(1).join("\n").trim();
        if (tTitle && tContent) {
          let goal = "";
          const discussionLines = [];
          for (const tl of tLines.slice(1)) {
            const goalMatch = tl.match(/^[-*]\s*\*\*(?:Sasaran|Goal|Tujuan|Latar Belakang)\*\*?:?\s*(.+)$/i);
            if (goalMatch && !goal) {
              goal = goalMatch[1].trim();
            } else if (tl.trim()) {
              discussionLines.push(tl.trim());
            }
          }
          topics.push({
            topic: tTitle.replace(/^Topik:\s*/i, "").trim(),
            goal,
            discussion: discussionLines.join("\n") || tContent,
          });
        }
      }
    } else if (/Keputusan|Kesepakatan/i.test(rawTitle)) {
      for (const line of lines.slice(1)) {
        if (/^\|[-:\s|]+\|$/.test(line) || /No\./i.test(line) || /^\|\s*No\s*\|/i.test(line)) continue;
        const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          decisions.push({
            no: parts[0],
            decision: parts[1],
            date: parts[2] || "",
            pic: parts[3] || "",
          });
        } else {
          const bulletDec = line.match(/^[-*]\s*(.+)$/);
          if (bulletDec) {
            decisions.push({
              no: String(decisions.length + 1),
              decision: bulletDec[1].trim(),
              date: "",
              pic: "",
            });
          }
        }
      }
    } else if (/Tindak Lanjut|Action/i.test(rawTitle)) {
      for (const line of lines.slice(1)) {
        if (/^\|[-:\s|]+\|$/.test(line) || /No\./i.test(line) || /^\|\s*No\s*\|/i.test(line)) continue;
        const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          actionItems.push({
            no: parts[0],
            action: parts[1],
            pic: parts[2] || "",
            deadline: parts[3] || "",
          });
        } else {
          const bulletAct = line.match(/^[-*]\s*(.+)$/);
          if (bulletAct) {
            actionItems.push({
              no: String(actionItems.length + 1),
              action: bulletAct[1].trim(),
              pic: "",
              deadline: "",
            });
          }
        }
      }
    } else if (/Catatan|Kesimpulan|Summary|Penutup/i.test(rawTitle)) {
      notes = content;
    }
  }

  return { info, agendas, topics, decisions, actionItems, notes };
}

export default function UiSummary({ item, directedTopics = [], filename = "Rapat", durationS = 0, createdAt }) {
  const [copied, setCopied] = useState(false);
  const [checkedActions, setCheckedActions] = useState({});

  const rawText = item?.markdown_text || item?.final_text || "";
  const parsed = useMemo(() => parseMarkdownToUi(rawText), [rawText]);

  // Priority: explicit directedTopics -> parsed topics -> fallback
  const topics = useMemo(() => {
    if (directedTopics && directedTopics.length > 0) return directedTopics;
    if (item?.directed_topics && item.directed_topics.length > 0) return item.directed_topics;
    if (item?.ai_data?.directed_topics && item.ai_data.directed_topics.length > 0) return item.ai_data.directed_topics;
    return parsed.topics || [];
  }, [directedTopics, item, parsed]);

  // Decisions list
  const decisions = useMemo(() => {
    if (parsed.decisions && parsed.decisions.length > 0) return parsed.decisions;
    const extracted = [];
    topics.forEach((t, i) => {
      if (t.decisions) {
        extracted.push({
          no: String(i + 1),
          decision: t.decisions,
          pic: t.pic || "",
          date: t.date || "",
        });
      }
    });
    return extracted;
  }, [parsed.decisions, topics]);

  // Action items list
  const actionItems = useMemo(() => {
    if (parsed.actionItems && parsed.actionItems.length > 0) return parsed.actionItems;
    const extracted = [];
    topics.forEach((t, i) => {
      if (t.action_items && Array.isArray(t.action_items)) {
        t.action_items.forEach((act, actIdx) => {
          extracted.push({
            no: `${i + 1}.${actIdx + 1}`,
            action: act,
            pic: t.pic || "",
            deadline: "",
          });
        });
      }
    });
    return extracted;
  }, [parsed.actionItems, topics]);

  const summaryText = item?.ai_summary || item?.summary || parsed.notes || "";
  const info = parsed.info || {};
  const agendas = parsed.agendas || [];

  const toggleAction = (key) => {
    setCheckedActions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fmtDur = (s) => {
    if (!s) return "-";
    const m = Math.floor(s / 60), sec = Math.round(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
  }) : "-");

  const handleCopySummary = () => {
    let text = `RANGKUMAN RAPAT: ${info["Nama Rapat"] || filename}\n`;
    text += `Tanggal: ${info["Tanggal"] || fmtDate(createdAt)}\n`;
    text += `Durasi: ${fmtDur(durationS)}\n`;
    if (info["Pimpinan Rapat"]) text += `Pimpinan: ${info["Pimpinan Rapat"]}\n`;
    if (info["Peserta"]) text += `Peserta: ${info["Peserta"]}\n`;
    text += `\n`;

    if (agendas.length > 0) {
      text += `AGENDA RAPAT:\n`;
      agendas.forEach((a, i) => { text += `${i + 1}. ${a}\n`; });
      text += `\n`;
    }

    if (summaryText) {
      text += `IKHTISAR / CATATAN:\n${summaryText}\n\n`;
    }

    if (topics.length > 0) {
      text += `RINCIAN PEMBAHASAN:\n`;
      topics.forEach((t, i) => {
        text += `\n${i + 1}. ${t.topic || "Topik"}\n`;
        if (t.goal) text += `   - Goal/Sasaran: ${t.goal}\n`;
        if (t.discussion) text += `   - Pembahasan: ${t.discussion.replace(/\n+/g, " ")}\n`;
        if (t.decisions) text += `   - Keputusan: ${t.decisions}\n`;
      });
      text += `\n`;
    }

    if (decisions.length > 0) {
      text += `KEPUTUSAN / KESEPAKATAN:\n`;
      decisions.forEach((d) => {
        text += `- [${d.no}] ${d.decision} (PIC: ${d.pic || "-"}, Tanggal: ${d.date || "-"})\n`;
      });
      text += `\n`;
    }

    if (actionItems.length > 0) {
      text += `TINDAK LANJUT (ACTION ITEMS):\n`;
      actionItems.forEach((act) => {
        text += `- [${act.no}] ${act.action} (PIC: ${act.pic || "-"}, Deadline: ${act.deadline || "-"})\n`;
      });
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadStandaloneHtml = () => {
    const meetingTitle = info["Nama Rapat"] || filename;
    const meetingDate = info["Tanggal"] || fmtDate(createdAt);
    const meetingLeader = info["Pimpinan Rapat"] || "-";
    const meetingParticipants = info["Peserta"] || "-";

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notulen Rapat: ${meetingTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card: #131b2e;
      --card-border: #1f2a44;
      --primary: #6366f1;
      --primary-light: #818cf8;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
      --warning: #f59e0b;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', sans-serif;
      line-height: 1.6;
      padding: 40px 20px;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
    }
    .header-card {
      background: linear-gradient(135deg, #18223c, #0e1526);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 36px;
      margin-bottom: 24px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.35);
      color: var(--primary-light);
      padding: 5px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 26px;
      font-weight: 800;
      line-height: 1.3;
      margin-bottom: 24px;
      letter-spacing: -0.02em;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .meta-item span {
      display: block;
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .meta-item strong {
      font-size: 14px;
      color: #e2e8f0;
      font-weight: 600;
    }
    .section-card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .agenda-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .agenda-pill {
      background: #1a2238;
      border: 1px solid #283556;
      padding: 6px 14px;
      border-radius: 10px;
      font-size: 13px;
      color: #cbd5e1;
    }
    .topic-card {
      background: #0f1524;
      border: 1px solid #1a233a;
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .topic-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #1c263e;
    }
    .topic-title {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
    }
    .goal-badge {
      font-size: 11px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      padding: 3px 10px;
      border-radius: 999px;
      font-weight: 500;
    }
    .block-content {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.7;
      white-space: pre-wrap;
    }
    .table-container {
      width: 100%;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      background: #0f1524;
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      text-align: left;
      padding: 10px 14px;
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      color: #e2e8f0;
      vertical-align: top;
    }
    .tag {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 6px;
      font-weight: 500;
    }
    .tag-pic { background: #222d48; color: #93c5fd; border: 1px solid #33436a; }
    .tag-date { background: #272238; color: #f472b6; border: 1px solid #4a3461; }
    .tag-deadline { background: #382c1e; color: #fbbf24; border: 1px solid #5d4525; }
    footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    @media print {
      body { background: #fff; color: #111; padding: 0; }
      .header-card, .section-card, .topic-card {
        background: #fff; border: 1px solid #ddd; box-shadow: none; color: #111;
      }
      h1, .section-title, .topic-title { color: #000; }
      .block-content, td { color: #222; }
      th { background: #f5f5f5; color: #333; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-card">
      <div class="badge">Notulen Resmi &amp; Rangkuman Rapat</div>
      <h1>${meetingTitle}</h1>
      <div class="meta-grid">
        <div class="meta-item">
          <span>Tanggal Pelaksanaan</span>
          <strong>${meetingDate}</strong>
        </div>
        <div class="meta-item">
          <span>Pimpinan Rapat</span>
          <strong>${meetingLeader}</strong>
        </div>
        <div class="meta-item">
          <span>Peserta</span>
          <strong>${meetingParticipants}</strong>
        </div>
        <div class="meta-item">
          <span>Durasi Audio</span>
          <strong>${fmtDur(durationS)}</strong>
        </div>
      </div>
    </div>

    ${agendas.length > 0 ? `
    <div class="section-card">
      <div class="section-title">📋 Agenda Rapat</div>
      <div class="agenda-list">
        ${agendas.map((a, i) => `<div class="agenda-pill">${i + 1}. ${a}</div>`).join("")}
      </div>
    </div>` : ""}

    ${summaryText ? `
    <div class="section-card">
      <div class="section-title">💡 Ikhtisar &amp; Catatan Strategis</div>
      <p style="font-size: 13.5px; color: #cbd5e1; line-height: 1.8; white-space: pre-wrap;">${summaryText}</p>
    </div>` : ""}

    ${topics.length > 0 ? `
    <div class="section-card">
      <div class="section-title">🎯 Rincian Pembahasan Rapat</div>
      ${topics.map((t, idx) => `
        <div class="topic-card">
          <div class="topic-header">
            <div class="topic-title">${idx + 1}. ${t.topic || "Pembahasan"}</div>
            ${t.goal ? `<span class="goal-badge">Goal: ${t.goal}</span>` : ""}
          </div>
          <div class="block-content">${t.discussion}</div>
          ${t.decisions ? `
            <div style="margin-top: 12px; padding: 10px 14px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; font-size: 12.5px; color: #34d399;">
              <strong>✓ Kesepakatan:</strong> ${t.decisions}
            </div>` : ""}
        </div>
      `).join("")}
    </div>` : ""}

    ${decisions.length > 0 ? `
    <div class="section-card">
      <div class="section-title">✅ Poin Keputusan &amp; Kesepakatan</div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 45px;">No</th>
              <th>Poin Keputusan</th>
              <th style="width: 140px;">PIC</th>
              <th style="width: 130px;">Tanggal Efektif</th>
            </tr>
          </thead>
          <tbody>
            ${decisions.map((d) => `
              <tr>
                <td style="font-weight: 700; color: #94a3b8;">${d.no}</td>
                <td><strong>${d.decision}</strong></td>
                <td>${d.pic ? `<span class="tag tag-pic">${d.pic}</span>` : "-"}</td>
                <td>${d.date ? `<span class="tag tag-date">${d.date}</span>` : "-"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>` : ""}

    ${actionItems.length > 0 ? `
    <div class="section-card">
      <div class="section-title">📌 Tindak Lanjut (Action Items)</div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 45px;">No</th>
              <th>Aksi / Tugas</th>
              <th style="width: 140px;">Penanggung Jawab (PIC)</th>
              <th style="width: 130px;">Tenggat (Deadline)</th>
            </tr>
          </thead>
          <tbody>
            ${actionItems.map((act) => `
              <tr>
                <td style="font-weight: 700; color: #94a3b8;">${act.no}</td>
                <td>${act.action}</td>
                <td>${act.pic ? `<span class="tag tag-pic">${act.pic}</span>` : "-"}</td>
                <td>${act.deadline ? `<span class="tag tag-deadline">${act.deadline}</span>` : "-"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>` : ""}

    <footer>
      Dihasilkan secara otomatis oleh Resmeet-STT · Sistem Notulensi Pintar &amp; Transkripsi Akurat
    </footer>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rangkuman-${filename.replace(/[^a-zA-Z0-9_-]/g, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Has ANY structured data?
  const hasStructuredData = topics.length > 0 || decisions.length > 0 || actionItems.length > 0 || agendas.length > 0;

  return (
    <div className="space-y-4">
      {/* Top Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#151821] border border-[#1e2330] rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-white">Rangkuman Eksekutif &amp; Topik Bahasan</span>
          <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-mono">
            {topics.length > 0 ? `${topics.length} Topik` : `${decisions.length} Keputusan`}
          </span>
          {decisions.length > 0 && (
            <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-mono hidden sm:inline">
              {decisions.length} Kesepakatan
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopySummary}
            className="px-3 py-1.5 bg-[#0c0e14] hover:bg-slate-800 border border-[#1e2330] rounded-lg text-slate-300 hover:text-white flex items-center gap-1.5 text-xs transition-all"
            title="Salin rangkuman teks rapi ke clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Tersalin!" : "Salin Rangkuman"}</span>
          </button>

          <button
            onClick={handleDownloadStandaloneHtml}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-1.5 text-xs font-medium shadow-lg shadow-indigo-600/20 transition-all"
            title="Unduh file HTML mandiri yang siap dibuka di browser atau dicetak"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh Rangkuman HTML</span>
          </button>
        </div>
      </div>

      {/* Meeting Highlights Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 text-xs">
        <div>
          <span className="text-slate-500 block text-[10px] uppercase font-semibold">Nama Rapat / File</span>
          <span className="font-medium text-slate-200 truncate block mt-0.5" title={info["Nama Rapat"] || filename}>
            {info["Nama Rapat"] || filename}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase font-semibold">Pimpinan Rapat</span>
          <span className="font-medium text-slate-300 block mt-0.5 truncate" title={info["Pimpinan Rapat"] || "-"}>
            {info["Pimpinan Rapat"] || "-"}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase font-semibold">Tanggal &amp; Durasi</span>
          <span className="font-mono text-indigo-300 block mt-0.5">
            {fmtDur(durationS)} · {info["Tanggal"] || fmtDate(createdAt)}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase font-semibold">Status AI</span>
          <span className="font-semibold text-emerald-400 block mt-0.5">
            {item?.ai_correction_status || "Selesai"}
          </span>
        </div>
      </div>

      {/* Peserta Bar (if parsed) */}
      {info["Peserta"] && (
        <div className="bg-[#151821] border border-[#1e2330] rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-xs">
          <Users className="w-4 h-4 text-indigo-400 flex-shrink-0" />
          <span className="text-slate-400 font-medium">Peserta:</span>
          <span className="text-slate-200">{info["Peserta"]}</span>
        </div>
      )}

      {/* Agenda Badges */}
      {agendas.length > 0 && (
        <div className="bg-[#151821] border border-[#1e2330] rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
            Agenda Rapat
          </h3>
          <div className="flex flex-wrap gap-2 pt-1">
            {agendas.map((ag, i) => (
              <span key={i} className="text-xs bg-[#0c0e14] border border-[#1e2330] text-slate-300 px-3 py-1.5 rounded-lg flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                <span>{ag}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Summary Box */}
      {summaryText && (
        <div className="bg-[#151821] border border-[#1e2330] rounded-xl p-5 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Ikhtisar &amp; Catatan Penting
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
            {summaryText}
          </p>
        </div>
      )}

      {/* Directed Topics Cards */}
      {topics.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-indigo-400" />
            Rincian Topik &amp; Pembahasan
          </h3>

          <div className="grid grid-cols-1 gap-3.5">
            {topics.map((t, idx) => (
              <div key={idx} className="bg-[#151821] border border-[#1e2330] hover:border-indigo-500/30 rounded-xl p-5 space-y-3 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1e2330] pb-3">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-indigo-500/20 text-indigo-300 text-[11px] font-mono flex items-center justify-center">
                      {idx + 1}
                    </span>
                    {t.topic || `Topik ${idx + 1}`}
                  </h4>
                  {t.goal && (
                    <span className="text-[11px] bg-emerald-950/50 border border-emerald-700/50 text-emerald-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      Goal: {t.goal}
                    </span>
                  )}
                </div>

                {t.discussion && (
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-slate-500 block mb-1">
                      Pembahasan
                    </span>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {t.discussion}
                    </p>
                  </div>
                )}

                {t.decisions && (
                  <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-3">
                    <span className="text-[10px] uppercase font-bold text-emerald-400 flex items-center gap-1 mb-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Keputusan / Kesepakatan
                    </span>
                    <p className="text-xs text-emerald-200 leading-relaxed font-medium">
                      {t.decisions}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Poin Keputusan & Kesepakatan (Decisions List) */}
      {decisions.length > 0 && (
        <div className="bg-[#151821] border border-emerald-900/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-[#1e2330] pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Keputusan &amp; Kesepakatan Resmi ({decisions.length})
            </h3>
            <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">
              Final Consensus
            </span>
          </div>

          <div className="space-y-2.5">
            {decisions.map((d, i) => (
              <div key={i} className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {d.no || i + 1}
                  </span>
                  <p className="text-xs font-medium text-slate-200 leading-relaxed">
                    {d.decision}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 text-[11px] self-end sm:self-center">
                  {d.pic && (
                    <span className="bg-[#151821] border border-[#1e2330] text-indigo-300 px-2 py-0.5 rounded-md flex items-center gap-1">
                      <User className="w-3 h-3 text-indigo-400" />
                      {d.pic}
                    </span>
                  )}
                  {d.date && (
                    <span className="bg-[#151821] border border-[#1e2330] text-slate-400 px-2 py-0.5 rounded-md flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {d.date}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tindak Lanjut (Action Items Checklist) */}
      {actionItems.length > 0 && (
        <div className="bg-[#151821] border border-amber-900/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-[#1e2330] pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <ListTodo className="w-4 h-4 text-amber-400" />
              Tindak Lanjut &amp; Action Items ({actionItems.length})
            </h3>
            <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">
              Checklist Interaktif
            </span>
          </div>

          <div className="space-y-2">
            {actionItems.map((act, i) => {
              const key = `act-${i}`;
              const isChecked = !!checkedActions[key];
              return (
                <div
                  key={i}
                  onClick={() => toggleAction(key)}
                  className={`cursor-pointer rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border transition-all ${
                    isChecked
                      ? "bg-slate-900/40 border-slate-800 opacity-60 line-through"
                      : "bg-[#0c0e14] border-[#1e2330] hover:border-amber-500/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button type="button" className="mt-0.5 text-amber-400 focus:outline-none">
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500" />
                      )}
                    </button>
                    <span className="text-xs text-slate-200 leading-relaxed">
                      {act.action}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 text-[11px] self-end sm:self-center" onClick={(e) => e.stopPropagation()}>
                    {act.pic && (
                      <span className="bg-[#151821] border border-[#1e2330] text-indigo-300 px-2 py-0.5 rounded-md flex items-center gap-1">
                        <User className="w-3 h-3 text-indigo-400" />
                        PIC: {act.pic}
                      </span>
                    )}
                    {act.deadline && (
                      <span className="bg-amber-950/30 border border-amber-800/40 text-amber-300 px-2 py-0.5 rounded-md flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3" />
                        {act.deadline}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fallback for raw transcripts without any headers */}
      {!hasStructuredData && (
        <div className="bg-[#151821] border border-[#1e2330] rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold">
            <FileText className="w-4 h-4" />
            <span>Teks Hasil Transkripsi</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap font-sans bg-[#0c0e14] border border-[#1e2330] p-4 rounded-xl">
            {rawText || "Tidak ada teks transkripsi."}
          </p>
          <div className="text-[11px] text-slate-500 flex items-center gap-1 pt-1">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Transkrip ini belum memiliki struktur MoM lengkap. Anda dapat menggunakan tombol "Parafrase Ulang AI" untuk membentuk format notulen terarah.</span>
          </div>
        </div>
      )}
    </div>
  );
}
