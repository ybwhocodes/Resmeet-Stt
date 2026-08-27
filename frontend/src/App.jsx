import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import {
  Upload, FileAudio, Download, Database,
  RefreshCw, AlertCircle, FileText, CheckCircle,
  Trash2, Mic, Clock, Zap, Brain, ShieldCheck
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8081/api";
const SOCKET_URL = API.replace(/\/api\/?$/, "");

const fmt = (iso) => iso ? new Date(iso).toLocaleString("id-ID", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "-";
const fmtDur = (s) => {
  if (!s) return "-";
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};

function ProgressPanel({ progress }) {
  const { percent, stage, elapsed_s, current_text } = progress;
  return (
    <div className="space-y-3">
      <div className="relative h-2.5 bg-[#0c0e14] rounded-full overflow-hidden border border-[#1e2330]">
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: `${percent}%`, background: "linear-gradient(90deg, #6366f1, #818cf8)", boxShadow: "0 0 10px #6366f180" }} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-indigo-400 font-bold text-lg tabular-nums">{percent}%</span>
        <span className="text-slate-500 text-xs text-right max-w-[240px] truncate">{stage}</span>
      </div>
      {elapsed_s > 0 && <p className="text-slate-600 text-xs">Audio diproses: <span className="text-slate-400">{fmtDur(elapsed_s)}</span></p>}
      {current_text && (
        <div className="bg-[#0c0e14] border border-indigo-500/20 rounded-lg px-3 py-2">
          <p className="text-[11px] text-slate-500 mb-0.5">Segmen terbaru:</p>
          <p className="text-xs text-indigo-200 leading-relaxed line-clamp-2">{current_text}</p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [file, setFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [loadingH, setLoadingH] = useState(false);
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [preflight, setPreflight] = useState(null);
  const [aiCorrection, setAiCorrection] = useState(true);
  const [outputMd, setOutputMd] = useState(true);
  const [paraphrasing, setParaphrasing] = useState(false);
  const [paraphraseStyle, setParaphraseStyle] = useState("lebih ringkas, profesional, dan mudah dipahami");

  const fileRef = useRef(null);
  const socketRef = useRef(null);

  const fetchHistory = useCallback(async () => {
    setLoadingH(true);
    try {
      const res = await fetch(`${API}/transcripts`);
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setError("Gagal mengambil riwayat dari server.");
    } finally {
      setLoadingH(false);
    }
  }, []);

  const fetchPreflight = useCallback(async () => {
    try {
      const res = await fetch(`${API}/preflight?ai=${aiCorrection}`);
      const data = await res.json();
      setPreflight(data);
    } catch {
      setPreflight({ status: "failed", checks: { backend: false } });
    }
  }, [aiCorrection]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect", () => setSocketStatus("connected"));
    socket.on("disconnect", () => setSocketStatus("disconnected"));
    socket.on("connect_error", () => setSocketStatus("disconnected"));
    socket.on("progress", (data) => setProgress({ percent: data.percent ?? 0, stage: data.stage ?? "", elapsed_s: data.elapsed_s ?? 0, current_text: data.current_text ?? "" }));
    socket.on("job_status", (data) => data?.status && setProgress((p) => p || { percent: 0, stage: data.status, elapsed_s: 0, current_text: "" }));
    socket.on("done", (data) => {
      setProcessing(false);
      setProgress({ percent: 100, stage: "Selesai", elapsed_s: data.duration_s, current_text: "" });
      setResult(data);
      setSelected(null);
      fetchHistory();
    });
    socket.on("error", (data) => {
      setProcessing(false);
      setProgress(null);
      setError(data.message || "Terjadi kesalahan pada server.");
    });
    return () => socket.disconnect();
  }, [fetchHistory]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);
  useEffect(() => { fetchPreflight(); }, [fetchPreflight]);

  const acceptFile = (f) => {
    if (!f.type.startsWith("audio/")) return setError("Harap unggah file audio.");
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

  const handleProcess = async () => {
    if (!file || processing) return;
    setProcessing(true);
    setError("");
    setResult(null);
    setProgress({ percent: 0, stage: "Mengunggah file", elapsed_s: 0, current_text: "" });
    try {
      const form = new FormData();
      form.append("audioFile", file);
      form.append("ai_correction", aiCorrection ? "true" : "false");
      form.append("output_format", outputMd ? "md" : "json");
      const res = await fetch(`${API}/upload-and-transcribe`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload gagal");
      setJobId(data.job_id);
      socketRef.current?.emit("join_job", { job_id: data.job_id });
      setProgress({ percent: 1, stage: data.status || "queued", elapsed_s: 0, current_text: "" });
    } catch (e) {
      setProcessing(false);
      setProgress(null);
      setError(e.message);
    }
  };

  const downloadTxt = (item) => {
    const blob = new Blob([item.markdown_text || item.final_text || ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `transkrip_${item.filename || "audio"}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const downloadMd = (item) => {
    if (item.ai_correction_status === "paraphrased") {
      const blob = new Blob([item.markdown_text || item.final_text || ""], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `transkrip_${item.filename || "audio"}.md`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      return;
    }
    const id = item.job_id || jobId;
    if (item.md_url) window.open(`${SOCKET_URL}${item.md_url}`, "_blank");
    else if (id) window.open(`${API}/jobs/${id}/download-md`, "_blank");
  };

  const paraphrase = async () => {
    const item = selected || result;
    const text = item?.markdown_text || item?.final_text;
    if (!text || paraphrasing) return;
    setParaphrasing(true);
    setError("");
    try {
      const res = await fetch(`${API}/paraphrase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, style: paraphraseStyle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parafrase gagal");
      const next = { ...item, final_text: data.text, markdown_text: data.text, ai_correction_status: "paraphrased" };
      if (selected) setSelected(next);
      else setResult(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setParaphrasing(false);
    }
  };

  const activeItem = selected || result;
  const checks = preflight?.checks || {};

  return (
    <div style={{ fontFamily: "'Sora', 'DM Sans', sans-serif" }} className="min-h-screen bg-[#0c0e14] text-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-[#151821] to-[#0f1118] border border-[#1e2330] rounded-2xl px-6 py-5 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center"><Mic className="w-5 h-5 text-indigo-400" /></div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">SuaraText</h1>
              <p className="text-xs text-slate-500 mt-0.5">Whisper STT + AI correction + Markdown</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-[#0c0e14] border border-[#1e2330] px-3 py-1.5 rounded-full"><span className={`w-1.5 h-1.5 rounded-full ${processing ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />{processing ? "Memproses" : "Siap"}</div>
            <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${socketStatus === "connected" ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-400" : "bg-red-950/40 border-red-700/40 text-red-400"}`}>Socket {socketStatus}</div>
          </div>
        </header>

        {error && <div className="flex items-start gap-3 bg-red-950/50 border border-red-800/50 text-red-300 px-4 py-3 rounded-xl text-sm"><AlertCircle className="w-4 h-4 mt-0.5" />{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2"><Upload className="w-4 h-4 text-indigo-400" />Unggah File Audio</h2>
                <button onClick={fetchPreflight} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />Preflight</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center justify-between bg-[#0c0e14] border border-[#1e2330] rounded-xl px-4 py-3 text-sm text-slate-300">
                  <span className="flex items-center gap-2"><Brain className="w-4 h-4 text-indigo-400" />Koreksi AI</span>
                  <input type="checkbox" checked={aiCorrection} onChange={(e) => setAiCorrection(e.target.checked)} />
                </label>
                <label className="flex items-center justify-between bg-[#0c0e14] border border-[#1e2330] rounded-xl px-4 py-3 text-sm text-slate-300">
                  <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-400" />Output Markdown</span>
                  <input type="checkbox" checked={outputMd} onChange={(e) => setOutputMd(e.target.checked)} />
                </label>
              </div>

              <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-3 text-xs text-slate-500 grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(checks).map(([k, v]) => <span key={k} className={v ? "text-emerald-400" : "text-red-400"}>{k}: {String(v)}</span>)}
              </div>

              {!file ? (
                <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && acceptFile(e.dataTransfer.files[0]); }} className="border-2 border-dashed border-[#1e2330] hover:border-indigo-500/50 rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all group">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center group-hover:bg-indigo-600/20 transition-all"><FileAudio className="w-7 h-7 text-indigo-400" /></div>
                  <p className="text-slate-400 text-sm"><span className="text-indigo-400 font-medium">Klik</span> atau seret file ke sini</p>
                  <p className="text-slate-600 text-xs">MP3, WAV, OGG, FLAC</p>
                  <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files[0] && acceptFile(e.target.files[0])} />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-[#0c0e14] border border-[#1e2330] rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3"><FileAudio className="w-4 h-4 text-indigo-400" /><div><p className="text-sm font-medium text-slate-200 truncate max-w-[260px]">{file.name}</p><p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p></div></div>
                    {!processing && <button onClick={clearFile} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                  {audioUrl && <audio src={audioUrl} controls className="w-full h-9 rounded-lg accent-indigo-500" />}
                  <button onClick={handleProcess} disabled={processing} className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3 rounded-xl font-semibold text-sm transition-colors">
                    {processing ? <><RefreshCw className="w-4 h-4 animate-spin" /> Memproses</> : <><Zap className="w-4 h-4" /> Mulai Transkripsi</>}
                  </button>
                </div>
              )}
            </div>

            {processing && progress && <div className="bg-[#151821] border border-indigo-500/30 rounded-2xl p-6 space-y-4"><h2 className="text-sm font-semibold text-indigo-300 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />Progress</h2><ProgressPanel progress={progress} /></div>}
            {!processing && progress?.percent === 100 && <div className="bg-[#151821] border border-emerald-500/30 rounded-2xl p-6 space-y-3"><div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold"><CheckCircle className="w-4 h-4" />Transkripsi Selesai</div><p className="text-xs text-slate-500">Durasi audio: <span className="text-slate-300">{fmtDur(progress.elapsed_s)}</span></p></div>}

            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2330]"><h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-400" />{selected ? `Riwayat · ${selected.filename}` : "Hasil Transkrip"}</h2>{selected && <button onClick={() => setSelected(null)} className="text-xs text-slate-500 hover:text-slate-300">Kembali</button>}</div>
              <div className="p-6 min-h-[220px]">
                {activeItem ? <><div className="flex flex-wrap items-center gap-4 mb-4 text-xs text-slate-500"><span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmt(activeItem.created_at)}</span>{activeItem.duration_s && <span className="flex items-center gap-1"><FileAudio className="w-3 h-3" />{fmtDur(activeItem.duration_s)}</span>}{activeItem.ai_correction_status && <span className="flex items-center gap-1"><Brain className="w-3 h-3" />AI: {activeItem.ai_correction_status}</span>}</div><p style={{ fontFamily: "'DM Mono', monospace" }} className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{activeItem.markdown_text || activeItem.final_text}</p></> : <p className="text-slate-600 text-sm italic">Hasil transkripsi akan muncul di sini setelah proses selesai.</p>}
              </div>
              {activeItem && <div className="px-6 pb-5 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input value={paraphraseStyle} onChange={(e) => setParaphraseStyle(e.target.value)} className="flex-1 bg-[#0c0e14] border border-[#1e2330] text-slate-300 px-3 py-2.5 rounded-xl text-sm outline-none focus:border-indigo-500/50" placeholder="Gaya parafrase" />
                  <button onClick={paraphrase} disabled={paraphrasing} className="flex items-center justify-center gap-2 bg-violet-600/10 border border-violet-500/30 hover:border-violet-400 disabled:opacity-50 text-violet-300 px-4 py-2.5 rounded-xl text-sm font-medium"><Brain className="w-4 h-4" />{paraphrasing ? "Memparafrase" : "Parafrase AI"}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => downloadTxt(activeItem)} className="flex items-center gap-2 bg-[#0c0e14] border border-[#1e2330] hover:border-indigo-500/50 text-slate-300 hover:text-indigo-300 px-4 py-2.5 rounded-xl text-sm font-medium"><Download className="w-4 h-4" />Unduh .txt</button>
                  {(activeItem.md_url || activeItem.job_id || jobId) && <button onClick={() => downloadMd(activeItem)} className="flex items-center gap-2 bg-indigo-600/10 border border-indigo-500/30 hover:border-indigo-400 text-indigo-300 px-4 py-2.5 rounded-xl text-sm font-medium"><Download className="w-4 h-4" />Unduh .md</button>}
                </div>
              </div>}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl flex flex-col h-[720px] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2330]"><h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2"><Database className="w-4 h-4 text-indigo-400" />Riwayat</h2><button onClick={fetchHistory} className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-[#0c0e14] rounded-lg"><RefreshCw className={`w-3.5 h-3.5 ${loadingH ? "animate-spin" : ""}`} /></button></div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {loadingH ? <div className="text-center py-8 text-slate-600 text-sm">Memuat</div> : history.length === 0 ? <div className="text-center py-10 text-slate-600 text-sm">Belum ada data</div> : history.map((item) => <button key={item.id} onClick={() => { setSelected(item); setResult(null); }} className={`w-full text-left p-3.5 rounded-xl border transition-all ${selected?.id === item.id ? "bg-indigo-600/10 border-indigo-500/40" : "bg-[#0c0e14] border-[#1e2330] hover:border-indigo-500/30"}`}><div className="flex items-center gap-2 mb-1.5"><FileAudio className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" /><p className="text-xs font-medium text-slate-300 truncate">{item.filename}</p></div><p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{item.final_text}</p><div className="flex items-center justify-between mt-2"><span className="text-[10px] text-slate-600">{fmt(item.created_at)}</span>{item.duration_s && <span className="text-[10px] text-indigo-400/70">{fmtDur(item.duration_s)}</span>}</div></button>)}
              </div>
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-slate-700 pb-2">SuaraText · Whisper STT + AI RAG + Markdown</p>
      </div>
    </div>
  );
}
