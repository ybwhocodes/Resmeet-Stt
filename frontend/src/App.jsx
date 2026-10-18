import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import {
  Upload, FileAudio, Download, Database,
  RefreshCw, AlertCircle, FileText, CheckCircle,
  Trash2, Mic, Zap, Brain, ShieldCheck,
  Settings, Eye, EyeOff, Save, Target, Check,
  ArrowLeft, ChevronRight, Sliders, Search, Layers, X,
  Layout, GitBranch, Copy, Sparkles
} from "lucide-react";
import MarkmapView from "./components/MarkmapView";
import UiSummary from "./components/UiSummary";

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

// 3 Combos Definitions
const COMBOS = [
  {
    id: "1",
    name: "Combo 1: Akurasi Tinggi (Rekomendasi)",
    tag: "DeepFilter-Net+ • NoiseReduce • VAD • Fast-Whisper Turbo",
    desc: "Neural Spectral Denoise + Voice Activity Gating + Whisper.cpp Large-v3-Turbo Q5. Akurasi notulen MoM tertinggi dengan ekstraksi topik komprehensif.",
    badge: "Akurasi Terbaik",
    badgeColor: "bg-indigo-950/60 border-indigo-700/60 text-indigo-300",
  },
  {
    id: "2",
    name: "Combo 2: Ultra Cepat & Ringan",
    tag: "DeepFilter-Net+ • NoiseReduce • ggml-base • VAD • Fast-Whisper",
    desc: "Denoise spektral + Model GGML Base 141MB (~2-3 detik inferensi). Sangat hemat RAM dan komputasi, ideal untuk audio jelas.",
    badge: "Super Cepat (<3s)",
    badgeColor: "bg-emerald-950/60 border-emerald-700/60 text-emerald-300",
  },
  {
    id: "3",
    name: "Combo 3: Neural VAD & Fast ONNX",
    tag: "DeepFilter-Net • Fast NoiseReduce • Silero-VAD (ONNX) • Comfort Pad",
    desc: "Segmentasi neural Silero-VAD via ONNX runtime + padding alami 250ms & jeda hening agar kalimat tidak terpotong dan transkripsi jernih.",
    badge: "Neural VAD (ONNX)",
    badgeColor: "bg-purple-950/60 border-purple-700/60 text-purple-300",
  },
];

function ProgressPanel({ progress }) {
  const { percent, stage, elapsed_s, current_text } = progress;
  return (
    <div className="space-y-3">
      <div className="relative h-2.5 bg-[#0c0e14] rounded-full overflow-hidden border border-[#1e2330]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, background: "linear-gradient(90deg, #6366f1, #818cf8)", boxShadow: "0 0 10px #6366f180" }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-indigo-400 font-bold text-lg tabular-nums">{percent}%</span>
        <span className="text-slate-500 text-xs text-right max-w-[280px] truncate">{stage}</span>
      </div>
      {elapsed_s > 0 && (
        <p className="text-slate-600 text-xs">
          Audio diproses: <span className="text-slate-400">{fmtDur(elapsed_s)}</span>
        </p>
      )}
      {current_text && (
        <div className="bg-[#0c0e14] border border-indigo-500/20 rounded-lg px-3 py-2">
          <p className="text-[11px] text-slate-500 mb-0.5">Segmen audio realtime:</p>
          <p className="text-xs text-indigo-200 leading-relaxed line-clamp-2">{current_text}</p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  // Navigation: "transcribe" | "history" | "detail" | "settings"
  const [nav, setNav] = useState("transcribe");

  // Transcribe State
  const [file, setFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [selectedCombo, setSelectedCombo] = useState("1");
  const [jobId, setJobId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [resultTab, setResultTab] = useState("markdown"); // "markdown" | "ui" | "mindmap"
  const [detailTab, setDetailTab] = useState("markdown"); // "markdown" | "ui" | "mindmap"
  const [copiedMd, setCopiedMd] = useState(false);

  // History State
  const [history, setHistory] = useState([]);
  const [loadingH, setLoadingH] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [historySearch, setHistorySearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  // Settings State
  const [aiCorrection, setAiCorrection] = useState(true);
  const [outputMd, setOutputMd] = useState(true);
  const [aiBaseUrl, setAiBaseUrl] = useState("http://localhost:20128/v1");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModelId, setAiModelId] = useState("9R-Gemini");
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  // Paraphrase State
  const [paraphrasing, setParaphrasing] = useState(false);
  const [paraphraseStyle, setParaphraseStyle] = useState("poin_singkat");

  const fileRef = useRef(null);
  const socketRef = useRef(null);

  // Fetch History
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

  // Fetch Preflight
  const fetchPreflight = useCallback(async () => {
    setPreflightLoading(true);
    try {
      const res = await fetch(`${API}/preflight?ai=${aiCorrection}`);
      const data = await res.json();
      setPreflight(data);
    } catch {
      setPreflight({ status: "failed", checks: { backend: false } });
    } finally {
      setPreflightLoading(false);
    }
  }, [aiCorrection]);

  // Fetch Settings
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API}/settings`);
      if (res.ok) {
        const data = await res.json();
        if (data.baseUrl) setAiBaseUrl(data.baseUrl);
        if (data.apiKey) setAiApiKey(data.apiKey);
        if (data.modelId) setAiModelId(data.modelId);
        if (data.paraphraseStyle) setParaphraseStyle(data.paraphraseStyle);
      }
    } catch (err) {
      console.warn("Gagal memuat pengaturan:", err);
    }
  }, []);

  // Setup Socket.IO
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
  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const ALLOWED_AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "flac", "webm", "aac", "mp4", "mpeg", "mpg", "m4v"];

  const acceptFile = (f) => {
    if (!f) return;
    const ext = f.name?.split(".").pop()?.toLowerCase() || "";
    const isMimeValid =
      f.type.startsWith("audio/") ||
      f.type.startsWith("video/") ||
      f.type === "video/mp4" ||
      f.type === "video/mpeg";
    const isExtValid = ALLOWED_AUDIO_EXTENSIONS.includes(ext);

    if (!isMimeValid && !isExtValid) {
      return setError(`Format file tidak didukung: .${ext || "unknown"}. Gunakan: ${ALLOWED_AUDIO_EXTENSIONS.join(", ")}`);
    }
    setFile(f);
    setAudioUrl(URL.createObjectURL(f));
    setResult(null);
    setProgress(null);
    setError("");
  };

  const clearFile = () => {
    setFile(null);
    setAudioUrl(null);
    setResult(null);
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 2000);
  };

  const handleProcess = async () => {
    if (!file || processing) return;
    setProcessing(true);
    setError("");
    setResult(null);
    setProgress({ percent: 0, stage: "Mengunggah file & menginisialisasi combo...", elapsed_s: 0, current_text: "" });
    try {
      const form = new FormData();
      form.append("audioFile", file);
      form.append("combo", selectedCombo);
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

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSavedSuccess(false);
    try {
      const res = await fetch(`${API}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: aiBaseUrl,
          apiKey: aiApiKey,
          modelId: aiModelId,
          paraphraseStyle: paraphraseStyle,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan pengaturan");
      setSavedSuccess(true);
      fetchPreflight();
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestAiConnection = async () => {
    setTestingAi(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/settings/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: aiBaseUrl,
          apiKey: aiApiKey,
          model: aiModelId,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, message: err.message || "Gagal menghubungi server" });
    } finally {
      setTestingAi(false);
    }
  };

  const downloadTxt = (item) => {
    const text = item.markdown_text || item.final_text || "";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transkrip_${item.filename || "audio"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadMd = (item) => {
    if (item.ai_correction_status === "paraphrased") {
      const blob = new Blob([item.markdown_text || item.final_text || ""], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transkrip_${item.filename || "audio"}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
    const id = item.job_id || jobId;
    if (item.md_url) window.open(`${SOCKET_URL}${item.md_url}`, "_blank");
    else if (id) window.open(`${API}/jobs/${id}/download-md`, "_blank");
  };

  const paraphrase = async (targetItem, updateTargetFn) => {
    const text = targetItem?.markdown_text || targetItem?.final_text;
    if (!text || paraphrasing) return;
    setParaphrasing(true);
    setError("");
    try {
      const res = await fetch(`${API}/paraphrase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          style: paraphraseStyle,
          id: targetItem?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parafrase gagal");
      const next = {
        ...targetItem,
        final_text: data.markdown || data.text,
        markdown_text: data.markdown || data.text,
        ai_summary: data.summary || data.ai_summary || targetItem.ai_summary,
        summary: data.summary || data.ai_summary || targetItem.summary,
        directed_topics: data.directed_topics?.length > 0 ? data.directed_topics : targetItem.directed_topics,
        ai_data: data.ai_data || data,
        ai_correction_status: "paraphrased",
      };
      updateTargetFn(next);
      if (updateTargetFn === setResult && data.directed_topics?.length > 0) {
        setDirectedTopics(data.directed_topics);
      }
      fetchHistory();
    } catch (e) {
      setError(e.message);
    } finally {
      setParaphrasing(false);
    }
  };

  const handleDeleteTranscript = async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm("Apakah Anda yakin ingin menghapus transkrip ini dari riwayat?")) {
      return;
    }
    setDeletingId(id);
    setError("");
    try {
      const res = await fetch(`${API}/transcripts/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menghapus transkrip");

      setHistory((prev) => prev.filter((item) => item.id !== id));
      if (selectedItem?.id === id) {
        setSelectedItem(null);
        setNav("history");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const checks = preflight?.checks || {};
  const activeItem = result;
  const directedTopics = activeItem?.directed_topics || activeItem?.ai_data?.directed_topics;

  const filteredHistory = history.filter((h) => {
    if (!historySearch.trim()) return true;
    const q = historySearch.toLowerCase();
    return (
      (h.filename && h.filename.toLowerCase().includes(q)) ||
      (h.final_text && h.final_text.toLowerCase().includes(q)) ||
      (h.ai_summary && h.ai_summary.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ fontFamily: "'Sora', 'DM Sans', sans-serif" }} className="min-h-screen bg-[#0c0e14] text-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Navigation Bar */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-[#151821] to-[#0f1118] border border-[#1e2330] rounded-2xl px-6 py-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Mic className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                SuaraText
                <span className="text-[10px] bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full font-mono">
                  Bun + Whisper.cpp
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">Whisper.cpp STT + Jev-Guided Topics + Continuous RAG</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Nav Tabs */}
            <nav className="flex bg-[#0c0e14] p-1 rounded-xl border border-[#1e2330] text-xs">
              <button
                onClick={() => setNav("transcribe")}
                className={`px-3.5 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${nav === "transcribe" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"}`}
              >
                <Mic className="w-3.5 h-3.5" />
                Transkripsi
              </button>
              <button
                onClick={() => setNav("history")}
                className={`px-3.5 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${nav === "history" || nav === "detail" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"}`}
              >
                <Database className="w-3.5 h-3.5" />
                Riwayat ({history.length})
              </button>
              <button
                onClick={() => setNav("settings")}
                className={`px-3.5 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${nav === "settings" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"}`}
              >
                <Settings className="w-3.5 h-3.5" />
                Pengaturan
              </button>
            </nav>

            <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl border ${socketStatus === "connected" ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-400" : "bg-red-950/40 border-red-700/40 text-red-400"}`}>
              Socket {socketStatus}
            </div>
          </div>
        </header>

        {/* Global Error Banner */}
        {error && (
          <div className="flex items-start justify-between gap-3 bg-red-950/50 border border-red-800/50 text-red-300 px-4 py-3 rounded-xl text-sm">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PAGE 1: TRANSKRIPSI (MAIN RUNNING VIEW)                                  */}
        {/* ========================================================================= */}
        {nav === "transcribe" && (
          <div className="space-y-6">
            {/* Step 1: Combo Selector Before Running */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-400" />
                    Pilih Audio & STT Combo Pipeline
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pilih konfigurasi denoising, voice activity detection, dan model sebelum menjalankan transkripsi
                  </p>
                </div>
                <span className="text-xs text-indigo-400 font-mono bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">
                  Combo Aktif: #{selectedCombo}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {COMBOS.map((combo) => {
                  const isSelected = selectedCombo === combo.id;
                  return (
                    <div
                      key={combo.id}
                      onClick={() => setSelectedCombo(combo.id)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${isSelected ? "bg-indigo-600/10 border-indigo-500 shadow-lg shadow-indigo-600/10 ring-1 ring-indigo-500" : "bg-[#0c0e14] border-[#1e2330] hover:border-slate-700"}`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${combo.badgeColor}`}>
                            {combo.badge}
                          </span>
                          {isSelected && <Check className="w-4 h-4 text-indigo-400" />}
                        </div>
                        <h3 className="text-xs font-bold text-slate-200 leading-snug">{combo.name}</h3>
                        <p className="text-[11px] font-mono text-indigo-300/80 leading-tight">{combo.tag}</p>
                        <p className="text-[11px] text-slate-500 leading-relaxed pt-1">{combo.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Audio Uploader */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Upload className="w-4 h-4 text-indigo-400" />
                Unggah File Audio Rapat
              </h2>

              {!file ? (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && acceptFile(e.dataTransfer.files[0]); }}
                  className="border-2 border-dashed border-[#1e2330] hover:border-indigo-500/50 rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center group-hover:bg-indigo-600/20 transition-all">
                    <FileAudio className="w-7 h-7 text-indigo-400" />
                  </div>
                  <p className="text-slate-400 text-sm">
                    <span className="text-indigo-400 font-medium">Klik untuk memilih file</span> atau seret audio ke sini
                  </p>
                  <p className="text-slate-500 text-xs font-mono">Format didukung: MP3, WAV, M4A, MP4, MPEG, OGG, FLAC, AAC, WEBM</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="audio/*,video/mp4,video/mpeg,.mp3,.wav,.m4a,.ogg,.flac,.webm,.aac,.mp4,.mpeg,.mpg,.m4v"
                    className="hidden"
                    onChange={(e) => e.target.files[0] && acceptFile(e.target.files[0])}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-[#0c0e14] border border-[#1e2330] rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      <FileAudio className="w-4 h-4 text-indigo-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-200 truncate max-w-[280px] md:max-w-md">{file.name}</p>
                        <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                    {!processing && (
                      <button onClick={clearFile} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {audioUrl && <audio src={audioUrl} controls className="w-full h-9 rounded-lg accent-indigo-500" />}
                  <button
                    onClick={handleProcess}
                    disabled={processing}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-indigo-600/20"
                  >
                    {processing ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Memproses Transkripsi ({COMBOS.find((c) => c.id === selectedCombo)?.badge})...</>
                    ) : (
                      <><Zap className="w-4 h-4" /> Mulai Transkripsi dengan Combo #{selectedCombo}</>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Progress Panel */}
            {processing && progress && (
              <div className="bg-[#151821] border border-indigo-500/30 rounded-2xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Progress Transkripsi & Analisis Topik
                </h2>
                <ProgressPanel progress={progress} />
              </div>
            )}

            {/* Done Banner */}
            {!processing && progress?.percent === 100 && (
              <div className="bg-[#151821] border border-emerald-500/30 rounded-2xl p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-300">Transkripsi & Topik Terarah Selesai</h3>
                    <p className="text-xs text-slate-500">Audio durasi: {fmtDur(progress.elapsed_s)}</p>
                  </div>
                </div>
                {result && (
                  <div className="flex gap-2">
                    <button onClick={() => downloadTxt(result)} className="text-xs text-slate-300 hover:text-white bg-[#0c0e14] border border-[#1e2330] px-3 py-1.5 rounded-lg flex items-center gap-1">
                      <Download className="w-3.5 h-3.5" /> .txt
                    </button>
                    <button onClick={() => downloadMd(result)} className="text-xs text-indigo-300 hover:text-white bg-indigo-600/20 border border-indigo-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1">
                      <Download className="w-3.5 h-3.5" /> .md
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Results Display */}
            {result && (
              <div className="bg-[#151821] border border-[#1e2330] rounded-2xl overflow-hidden space-y-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-[#1e2330]">
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-indigo-400" />
                    <h2 className="text-sm font-semibold text-white">3 Format Output Hasil Rapat</h2>
                  </div>

                  {/* 3 Output Tabs */}
                  <div className="flex flex-wrap gap-1 bg-[#0c0e14] p-1 rounded-xl border border-[#1e2330] text-xs">
                    <button
                      onClick={() => setResultTab("markdown")}
                      className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${resultTab === "markdown" ? "bg-indigo-600 text-white font-medium shadow" : "text-slate-400 hover:text-white"}`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      1. Format .MD (MoM)
                    </button>
                    <button
                      onClick={() => setResultTab("ui")}
                      className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${resultTab === "ui" ? "bg-indigo-600 text-white font-medium shadow" : "text-slate-400 hover:text-white"}`}
                    >
                      <Layout className="w-3.5 h-3.5" />
                      2. Rangkuman HTML/UI
                    </button>
                    <button
                      onClick={() => setResultTab("mindmap")}
                      className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${resultTab === "mindmap" ? "bg-indigo-600 text-white font-medium shadow" : "text-slate-400 hover:text-white"}`}
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                      3. Mindmap (Markmap)
                    </button>
                  </div>
                </div>

                {/* Tab 1: Format Markdown (.md) */}
                {resultTab === "markdown" && (
                  <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between bg-[#0c0e14] border border-[#1e2330] rounded-xl px-4 py-2.5 text-xs text-slate-400">
                      <span>Dokumen Notulen Resmi (Minutes of Meeting) standar Markdown</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyToClipboard(result.markdown_text || result.final_text || "")}
                          className="px-2.5 py-1 bg-[#151821] hover:bg-slate-800 border border-[#1e2330] text-slate-300 rounded-lg flex items-center gap-1"
                        >
                          {copiedMd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedMd ? "Tersalin" : "Salin MD"}</span>
                        </button>
                        <button
                          onClick={() => downloadTxt(result)}
                          className="px-2.5 py-1 bg-[#151821] hover:bg-slate-800 border border-[#1e2330] text-slate-300 rounded-lg flex items-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5" /> .txt
                        </button>
                        <button
                          onClick={() => downloadMd(result)}
                          className="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 rounded-lg flex items-center gap-1 font-medium"
                        >
                          <Download className="w-3.5 h-3.5" /> Unduh .md
                        </button>
                      </div>
                    </div>

                    <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-6">
                      <p style={{ fontFamily: "'DM Mono', monospace" }} className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                        {result.markdown_text || result.final_text}
                      </p>
                    </div>
                  </div>
                )}

                {/* Tab 2: Rangkuman dalam bentuk HTML/UI */}
                {resultTab === "ui" && (
                  <div className="p-6">
                    <UiSummary
                      item={result}
                      filename={result.filename || file?.name || "Rapat"}
                      durationS={result.duration_s || progress?.elapsed_s || 0}
                      createdAt={new Date().toISOString()}
                      directedTopics={result.directed_topics || directedTopics}
                    />
                  </div>
                )}

                {/* Tab 3: Mindmap Poin Diskusi (Markmap) */}
                {resultTab === "mindmap" && (
                  <div className="p-6">
                    <MarkmapView
                      markdown={result.markdown_text || result.final_text}
                      title={result.filename || file?.name || "Mindmap Rapat"}
                    />
                  </div>
                )}

                {/* Enhanced Paraphrase Toolbar with Style Selector */}
                <div className="px-6 py-4 bg-[#0d1017] border-t border-[#1e2330] space-y-2.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-[11px] text-slate-400 font-semibold mr-1 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      Tipe Parafrase:
                    </span>
                    <button
                      type="button"
                      onClick={() => setParaphraseStyle("poin_singkat")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] transition-all ${paraphraseStyle === "poin_singkat" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                    >
                      Poin-poin Penting
                    </button>
                    <button
                      type="button"
                      onClick={() => setParaphraseStyle("detail_deskriptif")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] transition-all ${paraphraseStyle === "detail_deskriptif" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                    >
                      Detail &amp; Deskriptif
                    </button>
                    <button
                      type="button"
                      onClick={() => setParaphraseStyle("eksekutif")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] transition-all ${paraphraseStyle === "eksekutif" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                    >
                      Ringkasan Eksekutif
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={paraphraseStyle}
                      onChange={(e) => setParaphraseStyle(e.target.value)}
                      className="flex-1 bg-[#151821] border border-[#1e2330] text-slate-200 px-3 py-2 rounded-xl text-xs outline-none focus:border-indigo-500/50 font-mono"
                      placeholder="Gaya parafrase AI..."
                    />
                    <button
                      onClick={() => paraphrase(result, setResult)}
                      disabled={paraphrasing}
                      className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-xs font-medium shadow-lg shadow-indigo-600/20 transition-all"
                    >
                      <Brain className="w-3.5 h-3.5" />
                      {paraphrasing ? "Memparafrase..." : "Parafrase Ulang AI"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* PAGE 2: RIWAYAT (DEDICATED MULTI-COLUMN HISTORY PAGE)                     */}
        {/* ========================================================================= */}
        {nav === "history" && (
          <div className="bg-[#151821] border border-[#1e2330] rounded-2xl overflow-hidden space-y-4 p-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-[#1e2330] pb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-400" />
                  Riwayat Notulen & Transkripsi
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Daftar rekaman rapat dan notulen yang tersimpan di database</p>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Cari nama file / isi..."
                    className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                  />
                </div>
                <button
                  onClick={fetchHistory}
                  disabled={loadingH}
                  className="p-2 bg-[#0c0e14] border border-[#1e2330] hover:border-indigo-500/50 text-slate-400 hover:text-white rounded-xl transition-all"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingH ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* Multi-Column History Table */}
            {loadingH ? (
              <div className="py-20 text-center text-slate-500 text-sm">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                Memuat riwayat transkrip...
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="py-20 text-center text-slate-500 text-sm">
                Belum ada data riwayat transkripsi.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0c0e14] text-slate-400 uppercase text-[10px] tracking-wider border-b border-[#1e2330]">
                    <tr>
                      <th className="py-3 px-4">File Audio / ID</th>
                      <th className="py-3 px-4">Tanggal</th>
                      <th className="py-3 px-4">Durasi</th>
                      <th className="py-3 px-4">Status AI</th>
                      <th className="py-3 px-4">Ringkasan Pembahasan</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2330]">
                    {filteredHistory.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => { setSelectedItem(item); setNav("detail"); }}
                        className="hover:bg-indigo-600/5 cursor-pointer transition-colors group"
                      >
                        <td className="py-3 px-4 font-medium text-slate-200">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                              <FileAudio className="w-3.5 h-3.5 text-indigo-400" />
                            </div>
                            <span className="truncate max-w-[200px]" title={item.filename}>
                              {item.filename}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                          {fmt(item.created_at)}
                        </td>
                        <td className="py-3 px-4 text-indigo-300 font-mono whitespace-nowrap">
                          {fmtDur(item.duration_s)}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${item.ai_correction_status === "completed" ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-400" : "bg-slate-800/40 border-slate-700/40 text-slate-400"}`}>
                            {item.ai_correction_status || "skipped"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-400 max-w-[300px]">
                          <p className="line-clamp-2 leading-relaxed text-[11px]">
                            {item.ai_summary || item.final_text}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => { setSelectedItem(item); setNav("detail"); }}
                              className="p-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 rounded-lg text-xs flex items-center gap-1"
                            >
                              <span>Detail</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                            {item.md_url && (
                              <button
                                onClick={() => downloadMd(item)}
                                className="p-1.5 bg-[#0c0e14] hover:bg-[#1a1f2e] border border-[#1e2330] text-slate-400 hover:text-white rounded-lg"
                                title="Unduh .md"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={(e) => handleDeleteTranscript(item.id, e)}
                              disabled={deletingId === item.id}
                              className="p-1.5 bg-[#0c0e14] hover:bg-red-950/40 border border-[#1e2330] hover:border-red-700/50 text-slate-400 hover:text-red-400 rounded-lg transition-colors disabled:opacity-50"
                              title="Hapus riwayat"
                            >
                              {deletingId === item.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-red-400" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* PAGE 3: DETAIL VIEW (OPENED FROM HISTORY ROW CLICK)                       */}
        {/* ========================================================================= */}
        {nav === "detail" && selectedItem && (
          <div className="bg-[#151821] border border-[#1e2330] rounded-2xl overflow-hidden space-y-5 p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[#1e2330] pb-4">
              <button
                onClick={() => setNav("history")}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-[#0c0e14] border border-[#1e2330] px-3 py-1.5 rounded-lg transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Kembali ke Daftar Riwayat
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadTxt(selectedItem)}
                  className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-[#0c0e14] border border-[#1e2330] px-3 py-1.5 rounded-lg"
                >
                  <Download className="w-3.5 h-3.5" /> Unduh .txt
                </button>
                {selectedItem.md_url && (
                  <button
                    onClick={() => downloadMd(selectedItem)}
                    className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white bg-indigo-600/20 border border-indigo-500/30 px-3 py-1.5 rounded-lg"
                  >
                    <Download className="w-3.5 h-3.5" /> Unduh .md
                  </button>
                )}
                <button
                  onClick={() => handleDeleteTranscript(selectedItem.id)}
                  disabled={deletingId === selectedItem.id}
                  className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-200 bg-red-950/20 hover:bg-red-950/50 border border-red-900/40 hover:border-red-700/60 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                  title="Hapus transkrip ini"
                >
                  {deletingId === selectedItem.id ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  <span>Hapus</span>
                </button>
              </div>
            </div>

            {/* Metadata Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 text-xs">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase tracking-wider">File Audio</span>
                <span className="font-medium text-slate-200 truncate block mt-0.5">{selectedItem.filename}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Tanggal Transkripsi</span>
                <span className="font-medium text-slate-200 block mt-0.5">{fmt(selectedItem.created_at)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Durasi Audio</span>
                <span className="font-medium text-indigo-300 block mt-0.5">{fmtDur(selectedItem.duration_s)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Koreksi AI</span>
                <span className="font-medium text-emerald-400 block mt-0.5">{selectedItem.ai_correction_status || "skipped"}</span>
              </div>
            </div>

            {/* 3 Output Tabs Header in Detail View */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0c0e14] p-3 rounded-xl border border-[#1e2330]">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                Pilih Tampilan Output Dokumen:
              </span>

              <div className="flex flex-wrap gap-1 text-xs">
                <button
                  onClick={() => setDetailTab("markdown")}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${detailTab === "markdown" ? "bg-indigo-600 text-white font-medium shadow" : "text-slate-400 hover:text-white bg-[#151821] border border-[#1e2330]"}`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  1. Format .MD (MoM)
                </button>
                <button
                  onClick={() => setDetailTab("ui")}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${detailTab === "ui" ? "bg-indigo-600 text-white font-medium shadow" : "text-slate-400 hover:text-white bg-[#151821] border border-[#1e2330]"}`}
                >
                  <Layout className="w-3.5 h-3.5" />
                  2. Rangkuman HTML/UI
                </button>
                <button
                  onClick={() => setDetailTab("mindmap")}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${detailTab === "mindmap" ? "bg-indigo-600 text-white font-medium shadow" : "text-slate-400 hover:text-white bg-[#151821] border border-[#1e2330]"}`}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  3. Mindmap (Markmap)
                </button>
              </div>
            </div>

            {/* Tab 1: Format Markdown (.md) in Detail View */}
            {detailTab === "markdown" && (
              <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-[#1e2330]">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Dokumen Minutes of Meeting (MoM) Standar Markdown
                  </h3>
                  <button
                    onClick={() => copyToClipboard(selectedItem.markdown_text || selectedItem.final_text || "")}
                    className="px-2.5 py-1 bg-[#151821] hover:bg-slate-800 border border-[#1e2330] text-slate-300 rounded-lg flex items-center gap-1 text-xs"
                  >
                    {copiedMd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedMd ? "Tersalin" : "Salin Markdown"}</span>
                  </button>
                </div>
                <p style={{ fontFamily: "'DM Mono', monospace" }} className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                  {selectedItem.markdown_text || selectedItem.final_text}
                </p>
              </div>
            )}

            {/* Tab 2: Rangkuman dalam bentuk HTML/UI in Detail View */}
            {detailTab === "ui" && (
              <UiSummary
                item={selectedItem}
                filename={selectedItem.filename}
                durationS={selectedItem.duration_s}
                createdAt={selectedItem.created_at}
                directedTopics={selectedItem.directed_topics || selectedItem.ai_data?.directed_topics}
              />
            )}

            {/* Tab 3: Mindmap Poin Diskusi (Markmap) in Detail View */}
            {detailTab === "mindmap" && (
              <MarkmapView
                markdown={selectedItem.markdown_text || selectedItem.final_text}
                title={selectedItem.filename}
              />
            )}

            {/* Paraphrase toolbar in Detail view */}
            <div className="bg-[#0d1017] border border-[#1e2330] rounded-xl p-4 space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] text-slate-400 font-semibold mr-1 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Tipe Parafrase:
                </span>
                <button
                  type="button"
                  onClick={() => setParaphraseStyle("poin_singkat")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] transition-all ${paraphraseStyle === "poin_singkat" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                >
                  Poin-poin Penting
                </button>
                <button
                  type="button"
                  onClick={() => setParaphraseStyle("detail_deskriptif")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] transition-all ${paraphraseStyle === "detail_deskriptif" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                >
                  Detail &amp; Deskriptif
                </button>
                <button
                  type="button"
                  onClick={() => setParaphraseStyle("eksekutif")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] transition-all ${paraphraseStyle === "eksekutif" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                >
                  Ringkasan Eksekutif
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={paraphraseStyle}
                  onChange={(e) => setParaphraseStyle(e.target.value)}
                  className="flex-1 bg-[#151821] border border-[#1e2330] text-slate-200 px-3.5 py-2 rounded-xl text-xs outline-none focus:border-indigo-500/50 font-mono"
                  placeholder="Gaya parafrase AI..."
                />
                <button
                  onClick={() => paraphrase(selectedItem, setSelectedItem)}
                  disabled={paraphrasing}
                  className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-xs font-medium shadow-lg shadow-indigo-600/20 transition-all"
                >
                  <Brain className="w-3.5 h-3.5" />
                  {paraphrasing ? "Memparafrase..." : "Parafrase Ulang AI"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PAGE 4: PENGATURAN (DEDICATED SETTINGS PAGE: AI, AUDIO, PREFLIGHT)       */}
        {/* ========================================================================= */}
        {nav === "settings" && (
          <div className="space-y-6">
            {/* Section 1: AI Model Settings */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-[#1e2330] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                    <Brain className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Pengaturan Model AI (Jev Guided Topics)</h2>
                    <p className="text-xs text-slate-400">Konfigurasi endpoint, API-Key, dan model LLM untuk analisis topik terarah</p>
                  </div>
                </div>
              </div>

              {/* Koreksi & Topik AI Checkbox */}
              <label className="flex items-center justify-between bg-[#0c0e14] border border-[#1e2330] rounded-xl px-4 py-3 text-sm text-slate-300 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Brain className="w-4 h-4 text-indigo-400" />
                  <div>
                    <span className="font-medium text-slate-200">Koreksi & Topik AI (Jev Guided)</span>
                    <p className="text-[11px] text-slate-500">Ekstrak topik terarah, keputusan, action items, dan istilah baru</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={aiCorrection}
                  onChange={(e) => setAiCorrection(e.target.checked)}
                  className="w-4 h-4 accent-indigo-500 rounded"
                />
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* URL Base */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    AI Base URL (Endpoint API)
                  </label>
                  <input
                    type="text"
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                    placeholder="http://localhost:20128/v1 atau https://api.openai.com/v1"
                    className="w-full bg-[#0c0e14] border border-[#1e2330] focus:border-indigo-500/50 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Mendukung proxy lokal (port 20128), OpenRouter, DeepSeek, OpenAI, Ollama, atau vLLM.
                  </p>
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    API-Key
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={aiApiKey}
                      onChange={(e) => setAiApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full bg-[#0c0e14] border border-[#1e2330] focus:border-indigo-500/50 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-slate-200 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Model ID */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Nama / ID Model
                  </label>
                  <input
                    type="text"
                    value={aiModelId}
                    onChange={(e) => setAiModelId(e.target.value)}
                    placeholder="9R-Gemini, oc/jev-1.13-free, deepseek-chat, gpt-4o"
                    className="w-full bg-[#0c0e14] border border-[#1e2330] focus:border-indigo-500/50 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none font-mono"
                  />
                </div>

                {/* Gaya / Format Parafrase AI */}
                <div className="md:col-span-2 pt-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    Tipe Parafrase AI Default
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2.5">
                    Pilih tingkat kedalaman dan format parafrase notulen yang diinginkan
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div
                      onClick={() => setParaphraseStyle("poin_singkat")}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all ${paraphraseStyle === "poin_singkat" ? "bg-indigo-600/15 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500" : "bg-[#0c0e14] border-[#1e2330] text-slate-400 hover:border-slate-700"}`}
                    >
                      <div className="font-semibold text-xs text-white mb-1 flex items-center justify-between">
                        <span>Poin-poin Penting</span>
                        {paraphraseStyle === "poin_singkat" && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Deskripsi singkat, to the point, padat, dan cepat dipindai pembaca.
                      </p>
                    </div>

                    <div
                      onClick={() => setParaphraseStyle("detail_deskriptif")}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all ${paraphraseStyle === "detail_deskriptif" ? "bg-indigo-600/15 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500" : "bg-[#0c0e14] border-[#1e2330] text-slate-400 hover:border-slate-700"}`}
                    >
                      <div className="font-semibold text-xs text-white mb-1 flex items-center justify-between">
                        <span>Detail &amp; Deskriptif</span>
                        {paraphraseStyle === "detail_deskriptif" && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Penjelasan komprehensif latar belakang, argumen peserta, dan rincian aksi.
                      </p>
                    </div>

                    <div
                      onClick={() => setParaphraseStyle("eksekutif")}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all ${paraphraseStyle === "eksekutif" ? "bg-indigo-600/15 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500" : "bg-[#0c0e14] border-[#1e2330] text-slate-400 hover:border-slate-700"}`}
                    >
                      <div className="font-semibold text-xs text-white mb-1 flex items-center justify-between">
                        <span>Ringkasan Eksekutif</span>
                        {paraphraseStyle === "eksekutif" && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Format strategis tingkat manajemen untuk pengambil keputusan.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Test Result Feedback */}
              {testResult && (
                <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${testResult.success ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-300" : "bg-red-950/40 border-red-700/40 text-red-300"}`}>
                  {testResult.success ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                  <div>
                    <p className="font-medium">{testResult.message}</p>
                    {testResult.latencyMs && <p className="text-[10px] text-slate-400 mt-0.5">Latency: {testResult.latencyMs}ms</p>}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleTestAiConnection}
                  disabled={testingAi}
                  className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white bg-[#0c0e14] border border-indigo-500/30 hover:border-indigo-400 px-4 py-2 rounded-xl transition-all disabled:opacity-50"
                >
                  {testingAi ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  <span>{testingAi ? "Menguji Koneksi..." : "Uji Koneksi AI"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="flex items-center gap-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 px-5 py-2 rounded-xl font-medium transition-all shadow-lg shadow-indigo-600/30 disabled:opacity-50"
                >
                  {savedSuccess ? (
                    <><Check className="w-3.5 h-3.5" /> Pengaturan Tersimpan!</>
                  ) : savingSettings ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Menyimpan...</>
                  ) : (
                    <><Save className="w-3.5 h-3.5" /> Simpan Pengaturan</>
                  )}
                </button>
              </div>
            </div>

            {/* Section 2: Output Audio & Format Settings */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5 border-b border-[#1e2330] pb-4">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Pengaturan Output Audio & Format</h2>
                  <p className="text-xs text-slate-400">Format dokumen akhir dan parameter pipeline audio</p>
                </div>
              </div>

              {/* Output Markdown Checkbox */}
              <label className="flex items-center justify-between bg-[#0c0e14] border border-[#1e2330] rounded-xl px-4 py-3 text-sm text-slate-300 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <div>
                    <span className="font-medium text-slate-200">Output Markdown</span>
                    <p className="text-[11px] text-slate-500">Simpan dokumen hasil notulen akhir dalam format .md (Minutes of Meeting)</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={outputMd}
                  onChange={(e) => setOutputMd(e.target.checked)}
                  className="w-4 h-4 accent-indigo-500 rounded"
                />
              </label>

              {/* Default Combo Selection */}
              <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Combo Pipeline Default
                </label>
                <select
                  value={selectedCombo}
                  onChange={(e) => setSelectedCombo(e.target.value)}
                  className="w-full bg-[#151821] border border-[#1e2330] focus:border-indigo-500/50 rounded-xl px-3.5 py-2 text-xs text-slate-200 outline-none font-sans"
                >
                  <option value="1">Combo 1: DeepFilter-Net+, NoiseReduce, VAD + Fast-Whisper Turbo (Akurasi Tinggi)</option>
                  <option value="2">Combo 2: DeepFilter-Net+, NoiseReduce, ggml-base + VAD + Fast-Whisper (Super Cepat &lt;3s)</option>
                  <option value="3">Combo 3: DeepFilter-Net, NoiseReduce, Silero-VAD &amp; Sherpa-ONNX (Neural Segmentation)</option>
                </select>
              </div>
            </div>

            {/* Section 3: Status Sistem & Preflight Checklist */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#1e2330] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Status Sistem &amp; Kesiapan (Preflight Check)</h2>
                    <p className="text-xs text-slate-400">Verifikasi kesiapan modul backend, engine STT, database, dan AI</p>
                  </div>
                </div>

                <button
                  onClick={fetchPreflight}
                  disabled={preflightLoading}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-[#0c0e14] border border-[#1e2330] px-3 py-1.5 rounded-lg transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${preflightLoading ? "animate-spin" : ""}`} />
                  Periksa Ulang
                </button>
              </div>

              {/* Exact Preflight Grid requested by User */}
              <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {Object.entries(checks).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between p-2.5 bg-[#151821] rounded-lg border border-[#1e2330]">
                    <span className="font-mono text-slate-400 text-[11px] truncate">{key}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${value ? "bg-emerald-950/60 text-emerald-400 border border-emerald-700/50" : "bg-red-950/60 text-red-400 border border-red-700/50"}`}>
                      {String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <footer className="text-center text-xs text-slate-700 py-3">
          SuaraText · Bun.js + Whisper.cpp + DeepFilter/Silero-VAD + Jev Directed Topics
        </footer>
      </div>
    </div>
  );
}
