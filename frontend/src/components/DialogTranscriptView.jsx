import React, { useState, useMemo } from "react";
import {
  MessageSquare, Clock, Users, Copy, Check, Download,
  Search, Filter, Sparkles, Volume2, UserCheck
} from "lucide-react";

/**
 * Formats seconds into MM:SS
 */
function fmtTimer(sec) {
  if (sec == null || isNaN(sec)) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Fallback parser to reconstruct timestamped dialog turns if not explicitly present in ai_data.
 */
function extractDialogTurns(item) {
  // 1. Direct array from ai_data or top-level item
  const rawTurns = item?.dialog_transcript || item?.ai_data?.dialog_transcript;
  if (Array.isArray(rawTurns) && rawTurns.length > 0) {
    return rawTurns.map((t, idx) => ({
      id: idx + 1,
      time: t.time || `00:${String(idx * 15).padStart(2, "0")}`,
      speaker: t.speaker || `Pembicara ${(idx % 2) + 1}`,
      text: t.text || String(t),
    }));
  }

  // 2. Derive from word timestamps if available
  if (Array.isArray(item?.word_timestamps) && item.word_timestamps.length > 0) {
    const turns = [];
    let currentTurn = { start: 0, end: 0, words: [] };
    let speakerIdx = 1;

    for (let i = 0; i < item.word_timestamps.length; i++) {
      const wt = item.word_timestamps[i];
      const word = (wt.word || "").trim();
      if (!word) continue;

      if (currentTurn.words.length === 0) {
        currentTurn.start = wt.start || 0;
        currentTurn.end = wt.end || wt.start || 0;
        currentTurn.words.push(word);
        continue;
      }

      const pause = (wt.start || 0) - currentTurn.end;
      if (pause > 2.2 || (wt.end - currentTurn.start > 25)) {
        turns.push({
          id: turns.length + 1,
          time: `${fmtTimer(currentTurn.start)} - ${fmtTimer(currentTurn.end)}`,
          speaker: `Pembicara ${speakerIdx}`,
          text: currentTurn.words.join(" "),
        });
        if (pause > 2.8) speakerIdx = speakerIdx === 1 ? 2 : 1;
        currentTurn = { start: wt.start || 0, end: wt.end || 0, words: [word] };
      } else {
        currentTurn.end = wt.end || wt.start || currentTurn.end;
        currentTurn.words.push(word);
      }
    }

    if (currentTurn.words.length > 0) {
      turns.push({
        id: turns.length + 1,
        time: `${fmtTimer(currentTurn.start)} - ${fmtTimer(currentTurn.end)}`,
        speaker: `Pembicara ${speakerIdx}`,
        text: currentTurn.words.join(" "),
      });
    }

    if (turns.length > 0) return turns;
  }

  // 3. Fallback from text paragraphs or sentences
  const baseText = item?.final_text || item?.raw_text || item?.markdown_text || "";
  if (!baseText.trim()) return [];

  const sentences = baseText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const durationS = item?.duration_s || 60;
  const secPerSentence = sentences.length > 0 ? durationS / sentences.length : 15;

  const turns = [];
  let chunk = [];
  let chunkStart = 0;
  let speakerIdx = 1;

  for (let i = 0; i < sentences.length; i++) {
    chunk.push(sentences[i]);
    const currentEstTime = (i + 1) * secPerSentence;
    if (chunk.length >= 3 || currentEstTime - chunkStart >= 25 || i === sentences.length - 1) {
      turns.push({
        id: turns.length + 1,
        time: `${fmtTimer(chunkStart)} - ${fmtTimer(currentEstTime)}`,
        speaker: `Pembicara ${speakerIdx}`,
        text: chunk.join(" "),
      });
      speakerIdx = speakerIdx === 1 ? 2 : 1;
      chunkStart = currentEstTime;
      chunk = [];
    }
  }

  return turns;
}

const SPEAKER_COLORS = [
  { badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30", border: "border-indigo-500/30", avatar: "from-indigo-600 to-blue-600" },
  { badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", border: "border-emerald-500/30", avatar: "from-emerald-600 to-teal-600" },
  { badge: "bg-amber-500/15 text-amber-300 border-amber-500/30", border: "border-amber-500/30", avatar: "from-amber-600 to-orange-600" },
  { badge: "bg-purple-500/15 text-purple-300 border-purple-500/30", border: "border-purple-500/30", avatar: "from-purple-600 to-pink-600" },
  { badge: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30", border: "border-cyan-500/30", avatar: "from-cyan-600 to-blue-500" },
];

export default function DialogTranscriptView({ item, filename, durationS }) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedTurnId, setCopiedTurnId] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedSpeaker, setSelectedSpeaker] = useState("all");

  const turns = useMemo(() => extractDialogTurns(item), [item]);

  const speakersList = useMemo(() => {
    const set = new Set();
    turns.forEach((t) => set.add(t.speaker));
    return Array.from(set);
  }, [turns]);

  const filteredTurns = useMemo(() => {
    return turns.filter((t) => {
      const matchSearch = !search.trim() ||
        t.text.toLowerCase().includes(search.toLowerCase()) ||
        t.speaker.toLowerCase().includes(search.toLowerCase()) ||
        t.time.includes(search);
      const matchSpeaker = selectedSpeaker === "all" || t.speaker === selectedSpeaker;
      return matchSearch && matchSpeaker;
    });
  }, [turns, search, selectedSpeaker]);

  const copyAll = () => {
    const text = turns
      .map((t) => `[${t.time}] ${t.speaker}:\n${t.text}`)
      .join("\n\n");
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const copyTurn = (turn) => {
    const text = `[${turn.time}] ${turn.speaker}:\n${turn.text}`;
    navigator.clipboard.writeText(text);
    setCopiedTurnId(turn.id);
    setTimeout(() => setCopiedTurnId(null), 1500);
  };

  const downloadTxt = () => {
    const text = `# Transkrip Percakapan / Menit (Terkoreksi AI)
File: ${filename || item?.filename || "Audio"}
Tanggal: ${new Date().toLocaleString("id-ID")}
Durasi: ${fmtTimer(durationS || item?.duration_s || 0)}

${turns.map((t) => `[${t.time}] ${t.speaker}:\n${t.text}`).join("\n\n")}
`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transkrip-dialog-${(filename || "audio").replace(/\.[^/.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Controls */}
      <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">
              Transkrip Alur Percakapan Per Menit
            </h3>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-indigo-400" />
              Terkoreksi AI (Objektif • Tanpa Hiperbola)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Menampilkan hasil apa yang terucap setiap orang per menit secara runtut dan utuh, dengan koreksi kata yang kurang jelas/salah dengar tanpa memotong ataupun mengedit topik pembicaraan.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
          <button
            onClick={copyAll}
            className="px-3 py-1.5 bg-[#151821] hover:bg-slate-800 border border-[#1e2330] text-slate-200 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-all"
          >
            {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedAll ? "Tersalin" : "Salin Semua"}</span>
          </button>
          <button
            onClick={downloadTxt}
            className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh .txt</span>
          </button>
        </div>
      </div>

      {/* Search and Speaker Filter */}
      <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari kata ucapan / menit..."
            className="w-full bg-[#151821] border border-[#1e2330] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <span className="text-slate-500 text-[11px] flex items-center gap-1 shrink-0">
            <Filter className="w-3 h-3" />
            Pembicara:
          </span>
          <button
            onClick={() => setSelectedSpeaker("all")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 ${
              selectedSpeaker === "all"
                ? "bg-indigo-600 text-white"
                : "bg-[#151821] text-slate-400 hover:text-slate-200 border border-[#1e2330]"
            }`}
          >
            Semua ({turns.length})
          </button>
          {speakersList.map((spk, idx) => {
            const count = turns.filter((t) => t.speaker === spk).length;
            return (
              <button
                key={spk}
                onClick={() => setSelectedSpeaker(spk)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 ${
                  selectedSpeaker === spk
                    ? "bg-indigo-600 text-white"
                    : "bg-[#151821] text-slate-400 hover:text-slate-200 border border-[#1e2330]"
                }`}
              >
                {spk} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Transcript Turns List */}
      {filteredTurns.length === 0 ? (
        <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-12 text-center text-slate-500 text-xs">
          Tidak ada giliran percakapan yang cocok dengan filter pencarian.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTurns.map((turn, index) => {
            // Assign a consistent color scheme based on speaker name/hash
            const colorIdx = Math.abs(turn.speaker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)) % SPEAKER_COLORS.length;
            const style = SPEAKER_COLORS[colorIdx];

            return (
              <div
                key={turn.id || index}
                className={`bg-[#0c0e14] border ${style.border} rounded-xl p-4 transition-all hover:border-slate-600 group`}
              >
                {/* Turn Header: Speaker & Timestamp */}
                <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-[#1e2330]">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${style.avatar} flex items-center justify-center text-white text-xs font-bold shadow-sm`}>
                      {turn.speaker.replace(/[^0-9a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "P"}
                    </div>
                    <div>
                      <span className="font-semibold text-xs text-slate-200 block">
                        {turn.speaker}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono bg-[#151821] text-slate-400 border border-[#1e2330] px-2 py-0.5 rounded-md flex items-center gap-1">
                      <Clock className="w-3 h-3 text-indigo-400" />
                      {turn.time}
                    </span>
                  </div>

                  <button
                    onClick={() => copyTurn(turn)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 bg-[#151821] hover:bg-slate-800 border border-[#1e2330] text-slate-400 hover:text-slate-200 rounded-md text-[11px] flex items-center gap-1"
                    title="Salin ucapan ini"
                  >
                    {copiedTurnId === turn.id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedTurnId === turn.id ? "Tersalin" : "Salin"}</span>
                  </button>
                </div>

                {/* Spoken Text */}
                <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap font-normal select-text">
                  {turn.text}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer Note */}
      <div className="text-[11px] text-slate-500 bg-[#0c0e14] border border-[#1e2330] rounded-xl p-3 flex items-center justify-between">
        <span>
          Total <strong>{turns.length}</strong> giliran percakapan teridentifikasi.
        </span>
        <span className="flex items-center gap-1 text-slate-400">
          <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
          Koreksi ejaan & diksi aktif (Objektif tanpa hiperbola)
        </span>
      </div>
    </div>
  );
}
