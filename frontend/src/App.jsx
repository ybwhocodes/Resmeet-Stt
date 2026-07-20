import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import {
  Upload, FileAudio, Download, Database, History,
  RefreshCw, AlertCircle, FileText, CheckCircle,
  Trash2, Mic, Clock, Zap
} from "lucide-react";

const API        = "https://1759-34-187-181-172.ngrok-free.app/api";
const SOCKET_URL = "https://1759-34-187-181-172.ngrok-free.app";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (iso) => new Date(iso).toLocaleString("id-ID", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit",
});
const fmtDur = (s) => {
  if (!s) return "—";
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};

// ─── Progress Bar Component ───────────────────────────────────────────────────
function ProgressPanel({ progress }) {
  const { percent, stage, elapsed_s, current_text } = progress;
  return (
    <div className="space-y-3">
      {/* Bar */}
      <div className="relative h-2.5 bg-[#0c0e14] rounded-full overflow-hidden border border-[#1e2330]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{
            width: `${percent}%`,
            background: "linear-gradient(90deg, #6366f1, #818cf8)",
            boxShadow: "0 0 10px #6366f180",
          }}
        />
      </div>

      {/* Persen + stage */}
      <div className="flex items-center justify-between">
        <span className="text-indigo-400 font-bold text-lg tabular-nums">
          {percent}%
        </span>
        <span className="text-slate-500 text-xs text-right max-w-[200px] truncate">
          {stage}
        </span>
      </div>

      {/* Elapsed */}
      {elapsed_s > 0 && (
        <p className="text-slate-600 text-xs">
          Audio yang sudah diproses: <span className="text-slate-400">{fmtDur(elapsed_s)}</span>
        </p>
      )}

      {/* Segmen teks terkini */}
      {current_text && (
        <div className="bg-[#0c0e14] border border-indigo-500/20 rounded-lg px-3 py-2">
          <p className="text-[11px] text-slate-500 mb-0.5">Segmen terbaru:</p>
          <p className="text-xs text-indigo-200 leading-relaxed line-clamp-2">
            {current_text}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── App Utama ────────────────────────────────────────────────────────────────
export default function App() {
  const [file,       setFile]       = useState(null);
  const [audioUrl,   setAudioUrl]   = useState(null);
  const [jobId,      setJobId]      = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress,   setProgress]   = useState(null);   // { percent, stage, elapsed_s, current_text }
  const [result,     setResult]     = useState(null);   // hasil akhir dari event "done"
  const [history,    setHistory]    = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [error,        setError]        = useState("");
  const [loadingH,     setLoadingH]     = useState(false);
  const [socketStatus, setSocketStatus] = useState("connecting"); // connecting | connected | disconnected

  const fileRef   = useRef(null);
  const socketRef = useRef(null);

  // ─── Socket.IO: inisialisasi sekali ────────────────────────────────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect",    () => { setSocketStatus("connected");    console.log("Socket connected:", socket.id); });
    socket.on("disconnect", () => { setSocketStatus("disconnected"); console.log("Socket disconnected"); });
    socket.on("connect_error", () => setSocketStatus("disconnected"));

    // Progress realtime dari backend
    socket.on("progress", (data) => {
      setProgress({
        percent:      data.percent      ?? 0,
        stage:        data.stage        ?? "",
        elapsed_s:    data.elapsed_s    ?? 0,
        current_text: data.current_text ?? "",
      });
    });

    // Selesai
    socket.on("done", (data) => {
      setProcessing(false);
      setProgress({ percent: 100, stage: "Selesai!", elapsed_s: data.duration_s, current_text: "" });
      setResult(data);
      setSelected(null);
      fetchHistory();
    });

    // Error dari backend
    socket.on("error", (data) => {
      setProcessing(false);
      setProgress(null);
      setError(data.message || "Terjadi kesalahan pada server.");
    });

    return () => socket.disconnect();
  }, []);

  // ─── Fetch History ──────────────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setLoadingH(true);
    try {
      const res  = await fetch(`${API}/transcripts`);
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setError("Gagal mengambil riwayat dari server.");
    } finally {
      setLoadingH(false);
    }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ─── File Handling ──────────────────────────────────────────────────────────
  const acceptFile = (f) => {
    if (!f.type.startsWith("audio/")) {
      setError("Harap unggah file audio (MP3, WAV, OGG, dsb).");
      return;
    }
    setFile(f);
    setAudioUrl(URL.createObjectURL(f));
    setResult(null);
    setProgress(null);
    setSelected(null);
    setError("");
  };

  const clearFile = () => {
    setFile(null); setAudioUrl(null); setResult(null); setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  // ─── Upload → dapat job_id → join Socket.IO room ───────────────────────────
  const handleProcess = async () => {
    if (!file || processing) return;

    setProcessing(true);
    setError("");
    setResult(null);
    setProgress({ percent: 0, stage: "Mengunggah file…", elapsed_s: 0, current_text: "" });

    try {
      const form = new FormData();
      form.append("audioFile", file);

      const res  = await fetch(`${API}/upload-and-transcribe`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload gagal");

      // Join room agar menerima progress dari backend
      setJobId(data.job_id);
      socketRef.current?.emit("join_job", { job_id: data.job_id });

      setProgress({ percent: 1, stage: "File diterima. Memulai proses…", elapsed_s: 0, current_text: "" });

    } catch (e) {
      setProcessing(false);
      setProgress(null);
      setError(e.message);
    }
  };

  // ─── Download ───────────────────────────────────────────────────────────────
  const download = (item) => {
    const text = item.final_text;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `transkrip_${item.filename}.txt`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const activeItem = selected || result;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Sora', 'DM Sans', sans-serif" }}
      className="min-h-screen bg-[#0c0e14] text-slate-100 p-4 md:p-8">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=DM+Mono:wght@400;500&display=swap');`}</style>

      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4
          bg-gradient-to-r from-[#151821] to-[#0f1118] border border-[#1e2330]
          rounded-2xl px-6 py-5 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Mic className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">SuaraText</h1>
              <p className="text-xs text-slate-500 mt-0.5">Speech-to-Text · Whisper · MySQL</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Status proses */}
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-[#0c0e14]
              border border-[#1e2330] px-3 py-1.5 rounded-full">
              <span className={`w-1.5 h-1.5 rounded-full ${processing ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />
              {processing ? "Memproses…" : "Siap"}
            </div>
            {/* Status socket */}
            <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border
              ${socketStatus === "connected"
                ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-400"
                : socketStatus === "connecting"
                ? "bg-amber-950/40 border-amber-700/40 text-amber-400"
                : "bg-red-950/40 border-red-700/40 text-red-400"}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                ${socketStatus === "connected"
                  ? "bg-emerald-400 animate-pulse"
                  : socketStatus === "connecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-red-500"}`} />
              <span>
                Socket ·{" "}
                {socketStatus === "connected"   ? "Connected"
                : socketStatus === "connecting" ? "Connecting…"
                : "Disconnected"}
              </span>
            </div>
          </div>
        </header>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-red-950/50 border border-red-800/50 text-red-300 px-4 py-3 rounded-xl text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Kolom Kiri ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Upload */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Upload className="w-4 h-4 text-indigo-400" />
                Unggah File Audio
              </h2>

              {!file ? (
                <div onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && acceptFile(e.dataTransfer.files[0]); }}
                  className="border-2 border-dashed border-[#1e2330] hover:border-indigo-500/50
                    rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all group">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20
                    flex items-center justify-center group-hover:bg-indigo-600/20 transition-all">
                    <FileAudio className="w-7 h-7 text-indigo-400" />
                  </div>
                  <p className="text-slate-400 text-sm">
                    <span className="text-indigo-400 font-medium">Klik</span> atau seret file ke sini
                  </p>
                  <p className="text-slate-600 text-xs">MP3, WAV, OGG, FLAC · Maks 500 MB</p>
                  <input ref={fileRef} type="file" accept="audio/*" className="hidden"
                    onChange={(e) => e.target.files[0] && acceptFile(e.target.files[0])} />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Info file */}
                  <div className="flex items-center justify-between bg-[#0c0e14] border border-[#1e2330] rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center">
                        <FileAudio className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200 truncate max-w-[240px]">{file.name}</p>
                        <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                    {!processing && (
                      <button onClick={clearFile}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {audioUrl && (
                    <audio src={audioUrl} controls className="w-full h-9 rounded-lg accent-indigo-500" />
                  )}

                  <button onClick={handleProcess} disabled={processing}
                    className="w-full flex items-center justify-center gap-2
                      bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                      text-white py-3 rounded-xl font-semibold text-sm transition-colors">
                    {processing ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Memproses…</>
                    ) : (
                      <><Zap className="w-4 h-4" /> Mulai Transkripsi</>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Progress Panel — tampil saat processing */}
            {processing && progress && (
              <div className="bg-[#151821] border border-indigo-500/30 rounded-2xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Progress Transkripsi
                </h2>
                <ProgressPanel progress={progress} />
              </div>
            )}

            {/* Selesai — progress 100% */}
            {!processing && progress?.percent === 100 && (
              <div className="bg-[#151821] border border-emerald-500/30 rounded-2xl p-6 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                  <CheckCircle className="w-4 h-4" />
                  Transkripsi Selesai
                </div>
                <div className="h-2 bg-[#0c0e14] rounded-full overflow-hidden">
                  <div className="h-full w-full rounded-full" style={{ background: "linear-gradient(90deg,#10b981,#34d399)" }} />
                </div>
                <p className="text-xs text-slate-500">
                  Durasi audio: <span className="text-slate-300">{fmtDur(progress.elapsed_s)}</span>
                </p>
              </div>
            )}

            {/* Hasil Transkrip */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2330]">
                <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  {selected ? `Riwayat · ${selected.filename}` : "Hasil Transkrip"}
                </h2>
                {selected && (
                  <button onClick={() => setSelected(null)}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                    ← Kembali
                  </button>
                )}
              </div>

              <div className="p-6 min-h-[200px]">
                {activeItem ? (
                  <>
                    <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />{fmt(activeItem.created_at)}
                      </span>
                      {activeItem.duration_s && (
                        <span className="flex items-center gap-1">
                          <FileAudio className="w-3 h-3" />{fmtDur(activeItem.duration_s)}
                        </span>
                      )}
                    </div>
                    <p style={{ fontFamily: "'DM Mono', monospace" }}
                      className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                      {activeItem.final_text}
                    </p>
                  </>
                ) : (
                  <p className="text-slate-600 text-sm italic">
                    Hasil transkripsi akan muncul di sini setelah proses selesai…
                  </p>
                )}
              </div>

              {activeItem && (
                <div className="px-6 pb-5">
                  <button onClick={() => download(activeItem)}
                    className="flex items-center gap-2 bg-[#0c0e14] border border-[#1e2330]
                      hover:border-indigo-500/50 text-slate-300 hover:text-indigo-300
                      px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
                    <Download className="w-4 h-4" /> Unduh .txt
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Sidebar History ── */}
          <div className="lg:col-span-1">
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl flex flex-col h-[680px] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2330]">
                <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  MySQL · transcripts
                </h2>
                <button onClick={fetchHistory}
                  className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-[#0c0e14] rounded-lg transition-colors">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingH ? "animate-spin" : ""}`} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {loadingH ? (
                  <div className="text-center py-8 text-slate-600 text-sm">Memuat…</div>
                ) : history.length === 0 ? (
                  <div className="text-center py-10 text-slate-600 text-sm">Belum ada data</div>
                ) : (
                  history.map((item) => (
                    <button key={item.id}
                      onClick={() => { setSelected(item); setResult(null); }}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all
                        ${selected?.id === item.id
                          ? "bg-indigo-600/10 border-indigo-500/40"
                          : "bg-[#0c0e14] border-[#1e2330] hover:border-indigo-500/30"}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <FileAudio className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                        <p className="text-xs font-medium text-slate-300 truncate">{item.filename}</p>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{item.final_text}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[10px] text-slate-600">{fmt(item.created_at)}</span>
                        {item.duration_s && (
                          <span className="text-[10px] text-indigo-400/70">{fmtDur(item.duration_s)}</span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>

        <p className="text-center text-xs text-slate-700 pb-2">
          SuaraText · Whisper STT + Flask + Socket.IO + MySQL
        </p>
      </div>
    </div>
  );
}