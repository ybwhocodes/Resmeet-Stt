import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import {
  Upload, FileAudio, Download, Database,
  RefreshCw, AlertCircle, FileText, CheckCircle,
  Trash2, Mic, Zap, Brain, ShieldCheck,
  Settings, Eye, EyeOff, Save, Target, Check,
  ArrowLeft, ChevronRight, Sliders, Search, Layers, X,
  Layout, GitBranch, Copy, Sparkles, Server, HardDrive, Star,
  Square, Pause, Play, Radio, MicOff, Lock, ShieldAlert
} from "lucide-react";
import MarkmapView from "./components/MarkmapView";
import UiSummary from "./components/UiSummary";
import resmeetSymbol from "./assets/resmeet_symbol.svg";

const isViteDev = typeof window !== "undefined" && window.location.port === "5173";
const defaultOrigin = typeof window !== "undefined" && window.location.origin && window.location.origin !== "null" && !window.location.origin.startsWith("file:") && !isViteDev
  ? window.location.origin
  : "http://127.0.0.1:8200";
const API = import.meta.env.VITE_API_BASE_URL || `${defaultOrigin}/api`;
const SOCKET_URL = API.replace(/\/api\/?$/, "");

const fmt = (iso) => iso ? new Date(iso).toLocaleString("id-ID", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "-";

const fmtDur = (s) => {
  if (!s) return "-";
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};

const fmtTimer = (s) => {
  if (!s) return "00:00";
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

// 2 Streamlined Models Definitions (Pydub/Scipy -> DeepFilter-Net+ -> NoiseReduce -> Silero VAD)
const COMBOS = [
  {
    id: "1",
    name: "Model 1: Fast-Whisper + Silero VAD",
    tag: "Pydub/Scipy • DeepFilter-Net+ • NoiseReduce • Silero VAD • ggml-large-v3-turbo",
    desc: "Whisper.cpp native C++ engine dengan model ggml-large-v3-turbo-q5_0 / large-v3-turbo.bin. Tercepat untuk CPU, latensi terendah dengan hasil transkripsi dan MoM AI komprehensif.",
    badge: "Native C++ (Ultra Cepat)",
    badgeColor: "bg-indigo-950/60 border-indigo-700/60 text-indigo-300",
  },
  {
    id: "2",
    name: "Model 2: Faster-Whisper Turbo",
    tag: "Pydub/Scipy • DeepFilter-Net+ • NoiseReduce • Silero VAD • faster-whisper-large-v3-turbo",
    desc: "CTranslate2 Python engine dengan model faster-whisper-large-v3-turbo (int8 quantization). Akurasi dan presisi tinggi dengan VAD filtering terintegrasi.",
    badge: "CTranslate2 (Presisi Tinggi)",
    badgeColor: "bg-emerald-950/60 border-emerald-700/60 text-emerald-300",
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
        <span className="text-slate-300 text-xs text-right max-w-[340px] truncate font-medium">{stage}</span>
      </div>
      {elapsed_s > 0 && (
        <p className="text-slate-500 text-xs">
          Audio diproses: <span className="text-slate-300 font-mono">{fmtDur(elapsed_s)}</span>
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

  // Database Storage State
  const [dbType, setDbType] = useState("sqlite");
  const [activeDefaultDb, setActiveDefaultDb] = useState("sqlite");
  const [dbHost, setDbHost] = useState("127.0.0.1");
  const [dbPort, setDbPort] = useState(3307);
  const [dbName, setDbName] = useState("stt_db");
  const [dbUser, setDbUser] = useState("root");
  const [dbPassword, setDbPassword] = useState("password");
  const [dbTesting, setDbTesting] = useState(false);
  const [dbTestResult, setDbTestResult] = useState(null);
  const [dbMigrating, setDbMigrating] = useState(false);
  const [dbMigrateResult, setDbMigrateResult] = useState(null);
  const [settingDefaultDb, setSettingDefaultDb] = useState(false);
  const [setDefaultResult, setSetDefaultResult] = useState(null);

  // Paraphrase State
  const [paraphrasing, setParaphrasing] = useState(false);
  const [paraphraseStyle, setParaphraseStyle] = useState("poin_singkat");

  // Audio Input Source State: "upload" | "record"
  const [audioSource, setAudioSource] = useState("upload");
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micPermission, setMicPermission] = useState("unknown"); // "unknown" | "prompt" | "granted" | "denied" | "unsupported"
  const [checkingMic, setCheckingMic] = useState(false);
  const [micError, setMicError] = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

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
        if (data.dbType) {
          setDbType(data.dbType);
          setActiveDefaultDb(data.dbType);
        }
        if (data.dbHost) setDbHost(data.dbHost);
        if (data.dbPort) setDbPort(data.dbPort);
        if (data.dbName) setDbName(data.dbName);
        if (data.dbUser) setDbUser(data.dbUser);
        if (data.dbPassword !== undefined) setDbPassword(data.dbPassword);
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
    socket.on("job_status", (data) => {
      if (data?.progress) {
        setProgress(data.progress);
      } else if (data?.status && data.status !== "queued" && data.status !== "processing") {
        setProgress((p) => p ? { ...p, stage: data.status } : { percent: 0, stage: data.status, elapsed_s: 0, current_text: "" });
      }
    });
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

  const stopRecordingTracks = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }
      streamRef.current = null;
    }
  }, []);

  const cancelRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== "inactive") {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
      mediaRecorderRef.current = null;
    }
    stopRecordingTracks();
    audioChunksRef.current = [];
    setIsRecording(false);
    setIsPaused(false);
    setRecordSeconds(0);
  }, [stopRecordingTracks]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopRecordingTracks();
    };
  }, [stopRecordingTracks]);

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
    cancelRecording();
    setFile(null);
    setAudioUrl(null);
    setResult(null);
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const checkMicPermission = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.permissions && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({ name: "microphone" });
        setMicPermission(status.state);
        status.onchange = () => {
          setMicPermission(status.state);
          if (status.state === "granted") {
            setMicError("");
          }
        };
        return status.state;
      } catch {
        return "unknown";
      }
    }
    return "unknown";
  }, []);

  useEffect(() => {
    checkMicPermission();
  }, [checkMicPermission]);

  const proceedWithRecording = (stream) => {
    streamRef.current = stream;

    let mimeType = "";
    if (typeof MediaRecorder !== "undefined") {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus";
      else if (MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
      else if (MediaRecorder.isTypeSupported("audio/ogg")) mimeType = "audio/ogg";
    }

    const options = mimeType ? { mimeType } : undefined;
    const mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const actualMime = mediaRecorder.mimeType || mimeType || "audio/webm";
      const ext = actualMime.includes("mp4") ? "mp4" : actualMime.includes("ogg") ? "ogg" : actualMime.includes("wav") ? "wav" : "webm";
      const blob = new Blob(audioChunksRef.current, { type: actualMime });
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const filename = `rekaman_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${ext}`;
      const recFile = new File([blob], filename, { type: actualMime });
      acceptFile(recFile);
      stopRecordingTracks();
    };

    mediaRecorder.start(250);
    setRecordSeconds(0);
    setIsRecording(true);
    setIsPaused(false);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRecordSeconds((prev) => prev + 1);
    }, 1000);
  };

  const requestMicAccess = async (autoStart = false) => {
    setCheckingMic(true);
    setMicError("");
    setError("");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicPermission("unsupported");
      setMicError("Browser Anda tidak mendukung perekaman audio langsung (getUserMedia tidak tersedia).");
      setCheckingMic(false);
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermission("granted");
      setMicError("");
      setCheckingMic(false);

      if (autoStart) {
        proceedWithRecording(stream);
        return true;
      } else {
        stream.getTracks().forEach((track) => track.stop());
        return true;
      }
    } catch (err) {
      console.warn("Microphone access failed:", err);
      setCheckingMic(false);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setMicPermission("denied");
        setMicError(
          "Izin mikrofon dinonaktifkan atau diblokir di browser. Silakan izinkan akses mikrofon melalui ikon gembok / pengaturan situs pada bilah URL browser Anda."
        );
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setMicPermission("not_found");
        setMicError("Perangkat mikrofon fisik tidak ditemukan. Pastikan mikrofon telah terpasang ke komputer Anda.");
      } else {
        setMicPermission("error");
        setMicError(`Gagal mengakses mikrofon: ${err.message || "Izin mikrofon ditolak."}`);
      }
      return false;
    }
  };

  const startRecording = async () => {
    setError("");
    setMicError("");
    await requestMicAccess(true);
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
  };

  const handleSourceChange = async (newSource) => {
    if (isRecording) {
      cancelRecording();
    }
    setAudioSource(newSource);
    clearFile();
    setMicError("");

    if (newSource === "record") {
      const perm = await checkMicPermission();
      if (perm === "prompt" || perm === "unknown" || perm === "denied") {
        await requestMicAccess(false);
      }
    }
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
    setProgress({ percent: 1, stage: "Mengunggah file & menyiapkan audio...", elapsed_s: 0, current_text: "" });
    try {
      const form = new FormData();
      form.append("audioFile", file);
      form.append("combo", selectedCombo);
      form.append("ai_correction", aiCorrection ? "true" : "false");
      form.append("output_format", outputMd ? "md" : "json");
      form.append("paraphrase_style", paraphraseStyle);
      const res = await fetch(`${API}/upload-and-transcribe`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload gagal");
      setJobId(data.job_id);
      socketRef.current?.emit("join_job", { job_id: data.job_id });
      setProgress((prev) => ({
        percent: Math.max(prev?.percent || 0, 2),
        stage: "Memulai proses transkripsi...",
        elapsed_s: 0,
        current_text: "",
      }));
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
          dbType,
          dbHost,
          dbPort: Number(dbPort) || undefined,
          dbName,
          dbUser,
          dbPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan pengaturan");
      setSavedSuccess(true);
      setActiveDefaultDb(dbType);
      fetchPreflight();
      fetchHistory();
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSetDefaultDb = async (typeToSet = dbType) => {
    setSettingDefaultDb(true);
    setSetDefaultResult(null);
    try {
      const res = await fetch(`${API}/settings/set-default-db`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dbType: typeToSet,
          dbHost,
          dbPort: Number(dbPort) || undefined,
          dbName,
          dbUser,
          dbPassword,
        }),
      });
      const data = await res.json();
      setSetDefaultResult(data);
      if (data.success) {
        setActiveDefaultDb(typeToSet);
        setDbType(typeToSet);
        fetchPreflight();
        fetchHistory();
        setTimeout(() => setSetDefaultResult(null), 4000);
      }
    } catch (err) {
      setSetDefaultResult({ success: false, message: err.message || "Gagal mengatur database default" });
    } finally {
      setSettingDefaultDb(false);
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

  const handleTestDbConnection = async () => {
    setDbTesting(true);
    setDbTestResult(null);
    try {
      const res = await fetch(`${API}/settings/db-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dbType,
          dbHost,
          dbPort: Number(dbPort) || undefined,
          dbName,
          dbUser,
          dbPassword,
        }),
      });
      const data = await res.json();
      setDbTestResult(data);
    } catch (err) {
      setDbTestResult({ success: false, message: err.message || "Gagal menguji koneksi database" });
    } finally {
      setDbTesting(false);
    }
  };

  const handleMigrateDb = async () => {
    setDbMigrating(true);
    setDbMigrateResult(null);
    try {
      const res = await fetch(`${API}/settings/db-migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dbType,
          dbHost,
          dbPort: Number(dbPort) || undefined,
          dbName,
          dbUser,
          dbPassword,
        }),
      });
      const data = await res.json();
      setDbMigrateResult(data);
      if (data.success) {
        fetchHistory();
        fetchPreflight();
      }
    } catch (err) {
      setDbMigrateResult({ success: false, message: err.message || "Gagal migrasi database" });
    } finally {
      setDbMigrating(false);
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
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-[#151821] via-[#12141c] to-[#0f1118] border border-[#1e2330] rounded-2xl px-6 py-4 shadow-xl">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#27272a] to-[#18181b] border border-purple-500/30 flex items-center justify-center p-1.5 shadow-lg shadow-purple-950/40">
              <img
                src={resmeetSymbol}
                alt="Resmeet Symbol"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                <span>Res<span className="text-purple-400">meet</span></span>
                <span className="text-[10px] bg-purple-500/15 border border-purple-500/30 text-purple-300 px-2.5 py-0.5 rounded-full font-mono font-medium">
                  Bun + Whisper.cpp
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5 font-medium tracking-wide">
                Speech-to-Text Intelligence • Notulen MoM & Continuous RAG
              </p>
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
                    Pilih Engine Model Transkripsi (Pipeline Suara Terpadu)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Audio diproses otomatis: <span className="text-slate-400">Pydub/Scipy (Loudness &amp; dBFS)</span> → <span className="text-slate-400">DeepFilter-Net+ (80Hz-7.5kHz + Rumble Cut)</span> → <span className="text-slate-400">NoiseReduce (Spectral Gating)</span> → <span className="text-slate-400">Silero VAD (Timestamp Traceable)</span> → Validasi Post-ASR &amp; Anti-Loop
                  </p>
                </div>
                <span className="text-xs text-indigo-400 font-mono bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">
                  Model Aktif: #{selectedCombo}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            {/* Step 2: Audio Source (Upload or Direct Browser Record) */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    {audioSource === "upload" ? (
                      <Upload className="w-4 h-4 text-indigo-400" />
                    ) : (
                      <Mic className="w-4 h-4 text-rose-400 animate-pulse" />
                    )}
                    Sumber Audio Rapat
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pilih metode input: unggah berkas audio/video atau rekam langsung percakapan dari browser
                  </p>
                </div>

                {/* Dropdown Selector */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400 font-medium">Sumber Audio:</label>
                  <select
                    value={audioSource}
                    disabled={isRecording || processing}
                    onChange={(e) => handleSourceChange(e.target.value)}
                    className="bg-[#0c0e14] border border-[#1e2330] text-slate-200 text-xs rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-indigo-500 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <option value="upload">📁 Unggah File Audio</option>
                    <option value="record">🎙️ Rekam Langsung dari Browser</option>
                  </select>
                </div>
              </div>

              {/* Mode 1: Unggah File Audio */}
              {audioSource === "upload" && (
                !file ? (
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
                        <><Zap className="w-4 h-4" /> Mulai Transkripsi dengan Model #{selectedCombo}</>
                      )}
                    </button>
                  </div>
                )
              )}

              {/* Mode 2: Rekam Langsung dari Browser */}
              {audioSource === "record" && (
                <div className="space-y-4">
                  {!file && !isRecording && (
                    micPermission === "denied" || micError ? (
                      <div className="border border-rose-500/40 bg-gradient-to-b from-rose-950/30 to-[#0c0e14] rounded-2xl p-6 md:p-8 space-y-5 text-center shadow-lg shadow-rose-950/20">
                        <div className="w-16 h-16 rounded-2xl bg-rose-600/20 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-400">
                          <MicOff className="w-8 h-8" />
                        </div>
                        <div className="space-y-1.5">
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/20 border border-rose-500/30 text-rose-300">
                            <ShieldAlert className="w-3.5 h-3.5" /> Izin Akses Mikrofon Dinonaktifkan
                          </div>
                          <h3 className="text-base font-bold text-white">Browser Memblokir Akses Mikrofon</h3>
                          <p className="text-xs text-rose-200/80 max-w-md mx-auto leading-relaxed">
                            {micError || "Izin mikrofon sebelumnya dinonaktifkan di browser ini. Untuk merekam audio rapat secara langsung, silakan izinkan kembali akses mikrofon."}
                          </p>
                        </div>

                        {/* Panduan Langkah demi Langkah */}
                        <div className="bg-[#0c0e14]/90 border border-rose-900/40 rounded-xl p-4 text-left max-w-lg mx-auto space-y-2.5 text-xs text-slate-300">
                          <p className="font-semibold text-rose-300 flex items-center gap-2">
                            <Lock className="w-3.5 h-3.5 text-rose-400" /> Cara Mengaktifkan Izin di Browser:
                          </p>
                          <ol className="list-decimal list-inside space-y-1.5 text-slate-400 pl-1">
                            <li>Klik ikon <strong>Gembok / Setelan Situs</strong> di sebelah kiri URL pada bilah alamat browser (address bar).</li>
                            <li>Ubah status izin <strong>Mikrofon (Microphone)</strong> dari <em>Blokir</em> ke <strong>Izinkan (Allow)</strong>.</li>
                            <li>Setelah diizinkan, klik tombol <strong>"Minta Akses Ulang ke Browser"</strong> di bawah ini.</li>
                          </ol>
                        </div>

                        {/* Tombol Tindakan */}
                        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                          <button
                            onClick={() => requestMicAccess(false)}
                            disabled={checkingMic}
                            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-xs shadow-lg shadow-rose-600/30 transition-all cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${checkingMic ? "animate-spin" : ""}`} />
                            {checkingMic ? "Memeriksa Akses..." : "Minta Akses Ulang ke Browser"}
                          </button>
                          <button
                            onClick={() => handleSourceChange("upload")}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1e2330] hover:bg-[#282f40] text-slate-300 font-medium text-xs border border-slate-700 transition-all"
                          >
                            <Upload className="w-3.5 h-3.5 text-slate-400" /> Beralih ke Unggah File
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="border border-[#1e2330] bg-[#0c0e14] rounded-xl p-8 flex flex-col items-center justify-center gap-4 text-center">
                        <button
                          onClick={startRecording}
                          disabled={processing || checkingMic}
                          className="w-20 h-20 rounded-full bg-gradient-to-tr from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-white flex items-center justify-center shadow-lg shadow-rose-600/30 hover:scale-105 transition-all group cursor-pointer disabled:opacity-50"
                        >
                          <Mic className={`w-8 h-8 group-hover:scale-110 transition-transform ${checkingMic ? "animate-pulse" : ""}`} />
                        </button>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-200">Mulai Perekaman Audio Rapat</h3>
                          <p className="text-xs text-slate-500 mt-1 max-w-sm">
                            Klik tombol di atas untuk mulai merekam percakapan rapat secara langsung dari mikrofon browser.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {micPermission === "granted" ? (
                            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-700/40">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Akses Mikrofon Diizinkan
                            </div>
                          ) : (
                            <button
                              onClick={() => requestMicAccess(false)}
                              disabled={checkingMic}
                              className="flex items-center gap-1.5 text-[11px] text-indigo-300 hover:text-white font-mono bg-indigo-950/40 hover:bg-indigo-900/50 px-3 py-1 rounded-full border border-indigo-700/40 transition-all cursor-pointer"
                            >
                              <Radio className="w-3.5 h-3.5 text-rose-400" />
                              {checkingMic ? "Memeriksa Izin..." : "Cek / Minta Izin Mikrofon"}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  )}

                  {isRecording && (
                    <div className="border border-rose-500/40 bg-gradient-to-b from-rose-950/20 to-[#0c0e14] rounded-xl p-6 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-3 h-3 rounded-full ${isPaused ? "bg-amber-400" : "bg-rose-500 animate-ping"}`} />
                          <span className={`text-xs font-semibold uppercase tracking-wider ${isPaused ? "text-amber-400" : "text-rose-400"}`}>
                            {isPaused ? "Perekaman Dijeda" : "Sedang Merekam Suara..."}
                          </span>
                        </div>
                        <div className="font-mono text-2xl font-bold text-white tracking-widest tabular-nums bg-[#151821] px-4 py-1.5 rounded-xl border border-[#1e2330]">
                          {fmtTimer(recordSeconds)}
                        </div>
                      </div>

                      {/* Animated Wave Indicator */}
                      <div className="flex items-center justify-center gap-1.5 h-12">
                        {[40, 75, 55, 90, 65, 80, 45, 95, 60, 85, 50, 70, 90, 40, 60].map((h, i) => (
                          <span
                            key={i}
                            className={`w-1.5 rounded-full transition-all duration-300 ${
                              isPaused
                                ? "bg-slate-700 h-2"
                                : "bg-rose-500 animate-pulse"
                            }`}
                            style={{
                              height: isPaused ? "8px" : `${Math.max(12, Math.round(h * (0.5 + ((i % 5) * 0.1))))}px`,
                              animationDelay: `${(i * 0.1).toFixed(1)}s`,
                            }}
                          />
                        ))}
                      </div>

                      {/* Control Buttons */}
                      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                        {isPaused ? (
                          <button
                            onClick={resumeRecording}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs shadow-lg shadow-amber-600/20 transition-all"
                          >
                            <Play className="w-4 h-4 fill-current" /> Lanjutkan (Resume)
                          </button>
                        ) : (
                          <button
                            onClick={pauseRecording}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1e2330] hover:bg-[#282f40] text-slate-200 font-medium text-xs border border-slate-700 transition-all"
                          >
                            <Pause className="w-4 h-4" /> Jeda (Pause)
                          </button>
                        )}

                        <button
                          onClick={stopRecording}
                          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-lg shadow-rose-600/30 transition-all"
                        >
                          <Square className="w-4 h-4 fill-current" /> Selesai Merekam
                        </button>

                        <button
                          onClick={cancelRecording}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-transparent hover:bg-red-950/40 text-slate-400 hover:text-red-400 text-xs transition-all"
                        >
                          <X className="w-4 h-4" /> Batalkan
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Recorded File Ready for Preview & Transcription */}
                  {!isRecording && file && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between bg-[#0c0e14] border border-emerald-500/30 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-200 truncate max-w-[280px] md:max-w-md">{file.name}</p>
                            <p className="text-xs text-slate-500 font-mono">
                              {(file.size / 1024 / 1024).toFixed(2)} MB • Durasi rekaman: {fmtTimer(recordSeconds)}
                            </p>
                          </div>
                        </div>
                        {!processing && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={clearFile}
                              title="Rekam Ulang"
                              className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-[#1e2330] rounded-lg border border-[#1e2330] transition-all flex items-center gap-1"
                            >
                              <RefreshCw className="w-3 h-3" /> Rekam Ulang
                            </button>
                            <button onClick={clearFile} title="Hapus" className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
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
                          <><Zap className="w-4 h-4" /> Mulai Transkripsi Rekaman dengan Model #{selectedCombo}</>
                        )}
                      </button>
                    </div>
                  )}
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
                    <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                      <span>Audio durasi: {fmtDur(progress.elapsed_s)}</span>
                      {result?.generation_time_s != null && (
                        <span className="inline-flex items-center gap-1 text-amber-300 font-mono text-[11px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          <Zap className="w-3 h-3 text-amber-400" />
                          Generate: {result.generation_time_s}s
                        </span>
                      )}
                    </p>
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

                  <div className="text-[11px] text-slate-400 bg-[#12151e] border border-[#1e2330] rounded-lg px-3 py-1.5 flex items-center gap-2">
                    {paraphraseStyle === "poin_singkat" && (
                      <span>📌 <strong>Poin-poin Penting:</strong> Min. 2 paragraf per poin, to the point, padat, cepat dipindai, berkonteks terarah.</span>
                    )}
                    {paraphraseStyle === "detail_deskriptif" && (
                      <span>📖 <strong>Detail &amp; Deskriptif:</strong> Min. 4 paragraf panjang per poin, latar belakang, argumen peserta, rincian aksi &amp; insight mendalam.</span>
                    )}
                    {paraphraseStyle === "eksekutif" && (
                      <span>💼 <strong>Ringkasan Eksekutif:</strong> Min. 2 paragraf per poin format strategis manajemen + analisis pro &amp; kontra keputusan.</span>
                    )}
                    {!["poin_singkat", "detail_deskriptif", "eksekutif"].includes(paraphraseStyle) && (
                      <span>✨ <strong>Kustom:</strong> Parafrase sesuai instruksi prompt khusus pengguna.</span>
                    )}
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
                      <th className="py-3 px-4">Durasi Audio</th>
                      <th className="py-3 px-4">Lama Generate</th>
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
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                            <Zap className="w-3 h-3 text-amber-400" />
                            {item.generation_time_s != null ? `${item.generation_time_s}s` : "-"}
                          </span>
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 text-xs">
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
                <span className="text-slate-500 block text-[10px] uppercase tracking-wider">Lama Generate</span>
                <span className="font-medium text-amber-300 flex items-center gap-1 mt-0.5 font-mono">
                  <Zap className="w-3 h-3 text-amber-400" />
                  {selectedItem.generation_time_s != null ? `${selectedItem.generation_time_s}s` : "-"}
                </span>
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

              <div className="text-[11px] text-slate-400 bg-[#12151e] border border-[#1e2330] rounded-lg px-3 py-1.5 flex items-center gap-2">
                {paraphraseStyle === "poin_singkat" && (
                  <span>📌 <strong>Poin-poin Penting:</strong> Min. 2 paragraf per poin, to the point, padat, cepat dipindai, berkonteks terarah.</span>
                )}
                {paraphraseStyle === "detail_deskriptif" && (
                  <span>📖 <strong>Detail &amp; Deskriptif:</strong> Min. 4 paragraf panjang per poin, latar belakang, argumen peserta, rincian aksi &amp; insight mendalam.</span>
                )}
                {paraphraseStyle === "eksekutif" && (
                  <span>💼 <strong>Ringkasan Eksekutif:</strong> Min. 2 paragraf per poin format strategis manajemen + analisis pro &amp; kontra keputusan.</span>
                )}
                {!["poin_singkat", "detail_deskriptif", "eksekutif"].includes(paraphraseStyle) && (
                  <span>✨ <strong>Kustom:</strong> Parafrase sesuai instruksi prompt khusus pengguna.</span>
                )}
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
                        Deskripsi singkat (minimal 2 paragraf), to the point, padat, dan cepat dipindai pembaca (minimal 2 paragraf per poin dan ada penjelasan konteks yang terarah).
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
                        Penjelasan komprehensif latar belakang, argumen peserta, dan rincian aksi penjelasannya lengkap dengan konteks dengan minimalnya 4 paragraf panjang dan penuh pengetahuan dari hasil meeting dan juga tambahkan insight dan jelaskan juga yang deskriptif agar pembaca mengetahui meskipun tidak ikut meeting.
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
                        Deskripsi singkat (minimal 2 paragraf), to the point, padat, dan cepat dipindai pembaca (minimal 2 paragraf per poin dan ada penjelasan konteks yang terarah) akan tetapi format strategis tingkat manajemen untuk pengambil keputusan dengan konteks dan pro kontranya setiap keputusannya.
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

            {/* Section 2: Database Storage (SQLite, MySQL, PostgreSQL) */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1e2330] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                    <Database className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Penyimpanan Database</h2>
                    <p className="text-xs text-slate-400">Pilih mesin database (SQLite otomatis mandiri, MySQL, atau PostgreSQL)</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/70 text-emerald-400 border border-emerald-700/50 shadow-sm">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Default Aktif: <strong className="uppercase tracking-wider">{activeDefaultDb}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-indigo-950/60 text-indigo-300 border border-indigo-700/40">
                    <Server className="w-3 h-3" />
                    <span>Port: 8200</span>
                  </div>
                </div>
              </div>

              {/* DB Type Selection Cards */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-300">
                    Pilih Tipe Driver Database:
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Penyimpanan default saat ini: <strong className="text-indigo-300 uppercase">{activeDefaultDb}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* SQLite Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setDbType("sqlite");
                      setDbTestResult(null);
                      setDbMigrateResult(null);
                    }}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      dbType === "sqlite"
                        ? "bg-indigo-600/15 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500 shadow-md"
                        : "bg-[#0c0e14] border-[#1e2330] text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <div className="font-semibold text-xs text-white flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                        SQLite (Mandiri)
                      </span>
                      <div className="flex items-center gap-1">
                        {activeDefaultDb === "sqlite" ? (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5">
                            <Check className="w-3 h-3 text-emerald-400" /> Default Aktif
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.5 rounded-full">
                            Tersedia
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Mandiri tanpa server. File <code className="text-emerald-300 text-[10px]">resmeet.sqlite</code> otomatis dibuat tanpa instalasi tambahan.
                    </p>
                  </button>

                  {/* MySQL Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setDbType("mysql");
                      if (dbPort === 5432) setDbPort(3307);
                      setDbTestResult(null);
                      setDbMigrateResult(null);
                    }}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      dbType === "mysql"
                        ? "bg-indigo-600/15 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500 shadow-md"
                        : "bg-[#0c0e14] border-[#1e2330] text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <div className="font-semibold text-xs text-white flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-blue-400" />
                        MySQL Server
                      </span>
                      <div className="flex items-center gap-1">
                        {activeDefaultDb === "mysql" ? (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5">
                            <Check className="w-3 h-3 text-emerald-400" /> Default Aktif
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.5 rounded-full">
                            Tersedia
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Koneksi ke MySQL / MariaDB server lokal atau cloud dengan fitur migrasi tabel in-app.
                    </p>
                  </button>

                  {/* PostgreSQL Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setDbType("postgres");
                      if (dbPort === 3307 || dbPort === 3306) setDbPort(5432);
                      if (dbUser === "root") setDbUser("postgres");
                      setDbTestResult(null);
                      setDbMigrateResult(null);
                    }}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      dbType === "postgres"
                        ? "bg-indigo-600/15 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500 shadow-md"
                        : "bg-[#0c0e14] border-[#1e2330] text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <div className="font-semibold text-xs text-white flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <Server className="w-3.5 h-3.5 text-sky-400" />
                        PostgreSQL Server
                      </span>
                      <div className="flex items-center gap-1">
                        {activeDefaultDb === "postgres" ? (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5">
                            <Check className="w-3 h-3 text-emerald-400" /> Default Aktif
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.5 rounded-full">
                            Tersedia
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Database relasional enterprise PostgreSQL dengan skema tabel dan kolom JSON native.
                    </p>
                  </button>
                </div>
              </div>

              {/* Set Default Feedback Alert */}
              {setDefaultResult && (
                <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 shadow-lg ${setDefaultResult.success ? "bg-emerald-950/70 border-emerald-600/70 text-emerald-200" : "bg-red-950/70 border-red-600/70 text-red-200"}`}>
                  {setDefaultResult.success ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-400" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-400" />}
                  <div className="flex-1">
                    <p className="font-semibold">{setDefaultResult.success ? "Driver Default Berhasil Diperbarui!" : "Gagal Mengatur Driver Default"}</p>
                    <p className="text-[11px] mt-0.5 opacity-90">{setDefaultResult.message}</p>
                  </div>
                </div>
              )}

              {/* Conditional view: SQLite Info vs MySQL/Postgres Form */}
              {dbType === "sqlite" ? (
                <div className="bg-emerald-950/20 border border-emerald-700/40 rounded-xl p-4 space-y-4">
                  <div className="flex items-start gap-3 text-xs text-emerald-200">
                    <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-emerald-300">SQLite (Zero Configuration - Mandiri)</p>
                      <p className="text-emerald-400/90 leading-relaxed text-[11px]">
                        Aplikasi menggunakan file database lokal (<code className="bg-emerald-950/60 px-1.5 py-0.5 rounded text-emerald-200">backend/resmeet.sqlite</code>). 
                        Tabel <code className="bg-emerald-950/60 px-1.5 py-0.5 rounded text-emerald-200">transcripts</code> langsung dibuat secara otomatis saat backend berjalan. Tidak memerlukan server database eksternal ataupun tombol migrasi manual.
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-emerald-800/40 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${activeDefaultDb === "sqlite" ? "bg-emerald-400 shadow-sm shadow-emerald-400" : "bg-slate-600"}`}></span>
                      <span className="text-slate-300 text-[11px]">
                        {activeDefaultDb === "sqlite" ? (
                          <strong className="text-emerald-300">SQLite saat ini adalah driver default sistem yang aktif.</strong>
                        ) : (
                          <span className="text-slate-400">Driver default saat ini adalah: <strong className="text-indigo-300 uppercase">{activeDefaultDb}</strong>.</span>
                        )}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSetDefaultDb("sqlite")}
                      disabled={settingDefaultDb || activeDefaultDb === "sqlite"}
                      className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl font-medium transition-all ${
                        activeDefaultDb === "sqlite"
                          ? "bg-emerald-900/40 border border-emerald-700/60 text-emerald-300 cursor-default"
                          : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 cursor-pointer"
                      }`}
                    >
                      {settingDefaultDb ? (
                        <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Mengatur Default...</>
                      ) : activeDefaultDb === "sqlite" ? (
                        <><Check className="w-3.5 h-3.5 text-emerald-400" /> Default Aktif</>
                      ) : (
                        <><Star className="w-3.5 h-3.5" /> Set Default SQLite</>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between border-b border-[#1e2330] pb-2.5">
                    <span className="text-xs font-semibold text-slate-200">
                      Parameter Koneksi {dbType.toUpperCase()}:
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Default Port: {dbType === "postgres" ? "5432" : "3307 / 3306"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1">Host Database</label>
                      <input
                        type="text"
                        value={dbHost}
                        onChange={(e) => setDbHost(e.target.value)}
                        placeholder="127.0.0.1"
                        className="w-full bg-[#151821] border border-[#1e2330] rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Port Database</label>
                      <input
                        type="number"
                        value={dbPort}
                        onChange={(e) => setDbPort(Number(e.target.value))}
                        placeholder={dbType === "postgres" ? "5432" : "3307"}
                        className="w-full bg-[#151821] border border-[#1e2330] rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Nama Database</label>
                      <input
                        type="text"
                        value={dbName}
                        onChange={(e) => setDbName(e.target.value)}
                        placeholder="stt_db"
                        className="w-full bg-[#151821] border border-[#1e2330] rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Username</label>
                      <input
                        type="text"
                        value={dbUser}
                        onChange={(e) => setDbUser(e.target.value)}
                        placeholder={dbType === "postgres" ? "postgres" : "root"}
                        className="w-full bg-[#151821] border border-[#1e2330] rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-slate-400 mb-1">Password</label>
                      <input
                        type="password"
                        value={dbPassword}
                        onChange={(e) => setDbPassword(e.target.value)}
                        placeholder="Password database"
                        className="w-full bg-[#151821] border border-[#1e2330] rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500/50"
                      />
                    </div>
                  </div>

                  {/* Test & Migration Feedback */}
                  {dbTestResult && (
                    <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${dbTestResult.success ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-300" : "bg-red-950/40 border-red-700/40 text-red-300"}`}>
                      {dbTestResult.success ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                      <div>
                        <p className="font-medium">{dbTestResult.message}</p>
                        {dbTestResult.latencyMs && <p className="text-[10px] text-slate-400 mt-0.5">Latency: {dbTestResult.latencyMs}ms</p>}
                      </div>
                    </div>
                  )}

                  {dbMigrateResult && (
                    <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${dbMigrateResult.success ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-300" : "bg-red-950/40 border-red-700/40 text-red-300"}`}>
                      {dbMigrateResult.success ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                      <div>
                        <p className="font-medium">{dbMigrateResult.message}</p>
                      </div>
                    </div>
                  )}

                  {/* Buttons for Test Connection, Migrate, and Set Default */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#1e2330]">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleTestDbConnection}
                        disabled={dbTesting}
                        className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white bg-[#151821] border border-indigo-500/30 hover:border-indigo-400 px-4 py-2 rounded-xl transition-all disabled:opacity-50"
                      >
                        {dbTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                        <span>{dbTesting ? "Menguji Koneksi..." : `Uji Koneksi ${dbType.toUpperCase()}`}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleMigrateDb}
                        disabled={dbMigrating}
                        className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-[#151821] border border-slate-700 hover:border-slate-500 px-4 py-2 rounded-xl font-medium transition-all disabled:opacity-50"
                      >
                        {dbMigrating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5 text-indigo-400" />}
                        <span>{dbMigrating ? "Memigrasi..." : "Migrate Database"}</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSetDefaultDb(dbType)}
                      disabled={settingDefaultDb}
                      className={`flex items-center gap-1.5 text-xs px-5 py-2 rounded-xl font-medium transition-all shadow-lg ${
                        activeDefaultDb === dbType
                          ? "bg-emerald-950/60 border border-emerald-600/50 text-emerald-300 shadow-emerald-900/20"
                          : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30 cursor-pointer"
                      }`}
                    >
                      {settingDefaultDb ? (
                        <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Menyimpan Default...</>
                      ) : activeDefaultDb === dbType ? (
                        <><Check className="w-3.5 h-3.5 text-emerald-400" /> {dbType.toUpperCase()} Adalah Default Aktif</>
                      ) : (
                        <><Star className="w-3.5 h-3.5" /> Set {dbType.toUpperCase()} Sebagai Default</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Section 3: Output Audio & Format Settings */}
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

              {/* Default Model Selection */}
              <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Model Engine Default
                </label>
                <select
                  value={selectedCombo}
                  onChange={(e) => setSelectedCombo(e.target.value)}
                  className="w-full bg-[#151821] border border-[#1e2330] focus:border-indigo-500/50 rounded-xl px-3.5 py-2 text-xs text-slate-200 outline-none font-sans"
                >
                  <option value="1">Model 1: Fast-Whisper + Silero VAD (ggml-large-v3-turbo.bin / Native C++)</option>
                  <option value="2">Model 2: Faster-Whisper Turbo (faster-whisper-large-v3-turbo / CTranslate2)</option>
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

        <footer className="text-center text-xs text-slate-500 py-4 flex items-center justify-center gap-2">
          <img src={resmeetSymbol} alt="Resmeet" className="w-4 h-4 opacity-70" />
          <span>Resmeet · Bun.js + Whisper.cpp + DeepFilter/Silero-VAD + Jev Directed Topics</span>
        </footer>
      </div>
    </div>
  );
}
