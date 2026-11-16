import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { io } from "socket.io-client";
import {
  Upload, FileAudio, Download, Database,
  RefreshCw, AlertCircle, FileText, CheckCircle,
  Trash2, Mic, Zap, Brain,
  Settings, Eye, EyeOff, Save, Target, Check,
  ArrowLeft, ChevronRight, Search, Layers, X,
  Layout, GitBranch, Copy, Sparkles, Server, HardDrive, Star,
  Square, Pause, Play, Radio, MicOff, Lock, ShieldAlert, MessageSquare, Loader2,
  Users, LogOut, Calendar, Filter, Share2, FileDown
} from "lucide-react";
import MarkmapView from "./components/MarkmapView";
import DialogTranscriptView from "./components/DialogTranscriptView";
import TiptapDocxEditor from "./components/TiptapDocxEditor";
import LoginView from "./components/LoginView";
import UserManagementView from "./components/UserManagementView";
import PreflightStatusView from "./components/PreflightStatusView";
import UserAiModelsView from "./components/UserAiModelsView";
import resmeetSymbol from "./assets/resmeet_symbol.svg";

const defaultOrigin = typeof window !== "undefined" && window.location.hostname
  ? `${window.location.protocol}//${window.location.hostname}:8200`
  : "http://localhost:8200";
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
  // Public Share MoM State (Requirement 6: tanggal-menit-UUID, No Login Required)
  const [publicShareSlug, setPublicShareSlug] = useState(null);
  const [publicShareData, setPublicShareData] = useState(null);
  const [publicShareLoading, setPublicShareLoading] = useState(false);
  const [publicShareError, setPublicShareError] = useState("");

  // Auth state
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);

  // Navigation: "transcribe" | "history" | "detail" | "models" | "users"
  const [nav, setNav] = useState("transcribe");
  const [showPreflightModal, setShowPreflightModal] = useState(false);

  // Transcribe State
  const [file, setFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [selectedCombo, setSelectedCombo] = useState("1");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [jobId, setJobId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [preflightStatus, setPreflightStatus] = useState("checking"); // "ready" | "not_connected" | "not_ready" | "checking"
  const [preflightChecks, setPreflightChecks] = useState(null);
  const [preflightLastChecked, setPreflightLastChecked] = useState(null);

  // Output Tabs: "dialog" (Transkrip) | "mom" (Tiptap DOCX Editor) | "mindmap" (Markmap)
  const [resultTab, setResultTab] = useState("dialog");
  const [detailTab, setDetailTab] = useState("dialog");

  // History State & Date Filter
  const [history, setHistory] = useState([]);
  const [loadingH, setLoadingH] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [historySearch, setHistorySearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [quickDateFilter, setQuickDateFilter] = useState("all");

  // Settings State
  const [aiCorrection, setAiCorrection] = useState(true);
  const [paraphraseStyle, setParaphraseStyle] = useState("poin_singkat");
  const [paraphrasing, setParaphrasing] = useState(false);

  // Audio Recording State
  const [audioSource, setAudioSource] = useState("upload"); // "upload" | "record"
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micPermission, setMicPermission] = useState("prompt");
  const [micError, setMicError] = useState("");
  const [checkingMic, setCheckingMic] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const socketRef = useRef(null);

  // =========================================================================
  // 1. Check Public Share Link on Mount (No Login Required)
  // =========================================================================
  useEffect(() => {
    const pathname = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash;

    let slug = null;
    if (pathname.startsWith("/share/")) {
      slug = pathname.replace("/share/", "").split("/")[0].trim();
    } else if (searchParams.get("share")) {
      slug = searchParams.get("share").trim();
    } else if (hash.startsWith("#share=")) {
      slug = hash.replace("#share=", "").trim();
    }

    if (slug) {
      setPublicShareSlug(slug);
      setPublicShareLoading(true);
      fetch(`${API}/public/transcripts/share/${slug}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.filename) {
            setPublicShareData(data);
          } else {
            setPublicShareError(data.error || "Dokumen MoM tidak ditemukan atau akses publik telah ditutup.");
          }
        })
        .catch(() => {
          setPublicShareError("Gagal menghubungi server publik.");
        })
        .finally(() => {
          setPublicShareLoading(false);
        });
    }
  }, []);

  // =========================================================================
  // 2. Auth Verification on Page Load (Remember Me Cache)
  // =========================================================================
  useEffect(() => {
    const savedToken = localStorage.getItem("resmeet_auth_token") || sessionStorage.getItem("resmeet_auth_token");
    if (!savedToken) {
      setAuthChecking(false);
      return;
    }

    fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${savedToken}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.username) {
          setUser(data);
          setToken(savedToken);
        } else {
          localStorage.removeItem("resmeet_auth_token");
          sessionStorage.removeItem("resmeet_auth_token");
          setUser(null);
          setToken(null);
        }
      })
      .catch(() => {
        setUser(null);
        setToken(null);
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, []);

  const handleLogout = async () => {
    try {
      if (token) {
        await fetch(`${API}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {}

    localStorage.removeItem("resmeet_auth_token");
    localStorage.removeItem("resmeet_auth_user");
    sessionStorage.removeItem("resmeet_auth_token");

    setUser(null);
    setToken(null);
    setNav("transcribe");
    setHistory([]);
    setResult(null);
    setSelectedItem(null);
  };

  // Fetch User's Registered Multi-Model Array
  const fetchUserAiModels = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/user/ai-models`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.models)) {
        const def = data.models.find((m) => m.is_default);
        if (def) setSelectedModelId(def.model_id);
        else if (data.models.length > 0) setSelectedModelId(data.models[0].model_id);
      }
    } catch (err) {
      console.warn("Gagal memuat model AI user:", err);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchUserAiModels();
  }, [token, fetchUserAiModels]);

  // Fetch History with Isolation
  const fetchHistory = useCallback(async (start = startDate, end = endDate) => {
    if (!token) return;
    setLoadingH(true);
    try {
      let query = `${API}/transcripts?`;
      if (start) query += `start_date=${encodeURIComponent(start)}&`;
      if (end) query += `end_date=${encodeURIComponent(end)}&`;

      const res = await fetch(query, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data.transcripts || []);
      setHistory(rows.map((item) => ({
        ...item,
        markdown_text: item.ai_summary || item.final_text || "",
      })));
    } catch (err) {
      console.error("Gagal memuat riwayat:", err);
      setHistory([]);
    } finally {
      setLoadingH(false);
    }
  }, [token, startDate, endDate]);

  useEffect(() => {
    if (token) fetchHistory();
  }, [token, fetchHistory]);

  // Quick Date Filter Presets
  const applyQuickDateFilter = (preset) => {
    setQuickDateFilter(preset);
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (preset === "all") {
      setStartDate("");
      setEndDate("");
      fetchHistory("", "");
    } else if (preset === "today") {
      const ymd = toYMD(today);
      setStartDate(ymd);
      setEndDate(ymd);
      fetchHistory(ymd, ymd);
    } else if (preset === "7d") {
      const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const start = toYMD(past);
      const end = toYMD(today);
      setStartDate(start);
      setEndDate(end);
      fetchHistory(start, end);
    } else if (preset === "30d") {
      const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const start = toYMD(past);
      const end = toYMD(today);
      setStartDate(start);
      setEndDate(end);
      fetchHistory(start, end);
    }
  };

  // Preflight Check & Connection Readiness Handler (Requirement 8)
  const checkPreflight = useCallback(async () => {
    try {
      const res = await fetch(`${API}/preflight`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setPreflightStatus("not_connected");
        return;
      }
      const data = await res.json();
      if (!data || !data.checks) {
        setPreflightStatus("not_connected");
        return;
      }
      setPreflightChecks(data.checks);
      setPreflightLastChecked(new Date().toLocaleTimeString("id-ID"));

      const { database, ffmpeg, whisperCli, whisperModel, uploadsWritable, aiGateway } = data.checks;
      const allPassed =
        database === true &&
        ffmpeg === true &&
        whisperCli === true &&
        whisperModel === true &&
        uploadsWritable === true &&
        aiGateway === true;

      setPreflightStatus(allPassed ? "ready" : "not_ready");
    } catch {
      setPreflightStatus("not_connected");
    }
  }, [token]);

  useEffect(() => {
    checkPreflight();
    const interval = setInterval(checkPreflight, 20000);
    const handleFocus = () => checkPreflight();
    window.addEventListener("focus", handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [checkPreflight]);

  // Socket.io Connection
  useEffect(() => {
    if (!token) return;
    const socket = io(SOCKET_URL, {
      transports: ["polling", "websocket"],
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketStatus("connected");
      checkPreflight();
    });
    socket.on("disconnect", () => {
      setSocketStatus("disconnected");
      setPreflightStatus("not_connected");
    });
    socket.on("progress", (data) => {
      setProgress((prev) => ({
        percent: data.percent ?? prev?.percent ?? 0,
        stage: data.stage ?? prev?.stage ?? "",
        elapsed_s: data.elapsed_s ?? prev?.elapsed_s ?? 0,
        current_text: data.current_text !== undefined ? data.current_text : (prev?.current_text ?? ""),
      }));
    });
    socket.on("done", (data) => {
      setProcessing(false);
      setProgress({ percent: 100, stage: "Selesai", elapsed_s: data.duration_s, current_text: "" });
      setResult(data);
      fetchHistory();
    });

    return () => {
      socket.disconnect();
    };
  }, [token, checkPreflight, fetchHistory]);

  // Stop media tracks
  const stopRecordingTracks = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const proceedWithRecording = (stream) => {
    streamRef.current = stream;
    audioChunksRef.current = [];

    let actualMime = "audio/webm";
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    for (const cand of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(cand)) {
        actualMime = cand;
        break;
      }
    }

    let mediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType: actualMime });
    } catch {
      mediaRecorder = new MediaRecorder(stream);
      actualMime = mediaRecorder.mimeType || "audio/webm";
    }
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const ext = actualMime.includes("mp4") ? "mp4" : actualMime.includes("ogg") ? "ogg" : "webm";
      const blob = new Blob(audioChunksRef.current, { type: actualMime });
      if (blob.size === 0) {
        setMicError("Rekaman kosong. Coba rekam ulang dan pastikan mikrofon aktif.");
        stopRecordingTracks();
        return;
      }
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const filename = `rekaman_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${ext}`;
      const recFile = new File([blob], filename, { type: actualMime });
      acceptFile(recFile);
      stopRecordingTracks();
    };

    mediaRecorder.onerror = () => {
      setMicError("Perekaman gagal. Coba rekam ulang.");
      stopRecordingTracks();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    };

    mediaRecorder.start();
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
      stopRecordingTracks();
      setCheckingMic(false);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setMicPermission("denied");
        setMicError("Izin mikrofon ditolak oleh browser. Buka setelan browser untuk mengaktifkan mikrofon.");
      } else {
        setMicError(`Gagal mengakses mikrofon: ${err.message}`);
      }
      return false;
    }
  };

  const startRecording = async () => {
    setMicError("");
    setError("");
    const granted = await requestMicAccess(true);
    if (!granted) return;
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => setRecordSeconds((prev) => prev + 1), 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    stopRecordingTracks();
    setIsRecording(false);
    setIsPaused(false);
    setRecordSeconds(0);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const acceptFile = (f) => {
    const validExts = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".webm", ".mp4", ".mpeg", ".mpg", ".m4v", ".aac"];
    const ext = "." + f.name.split(".").pop().toLowerCase();
    if (!validExts.includes(ext)) {
      setError(`Format ${ext} tidak didukung. Format yang didukung: ${validExts.join(", ")}`);
      return;
    }
    setFile(f);
    setError("");
    setResult(null);
    setProgress(null);
    setJobId(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(f));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) acceptFile(dropped);
  };

  const handleProcess = async () => {
    if (!file || processing || !token) return;
    if (preflightStatus !== "ready") {
      setError("Transkripsi tidak dapat dijalankan: Sistem belum siap atau Gateway AI belum dikonfigurasi.");
      return;
    }

    setProcessing(true);
    setError("");
    setResult(null);
    setProgress({ percent: 5, stage: "Mengunggah file & validasi audio...", elapsed_s: 0, current_text: "" });

    const startTime = Date.now();
    const progressTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setProgress((prev) => {
        let stage = "Mengunggah file audio...";
        let pct = 5;
        if (elapsed >= 2 && elapsed < 6) {
          stage = "Konversi audio ke 16 kHz WAV via FFmpeg...";
          pct = 15;
        } else if (elapsed >= 6 && elapsed < 20) {
          stage = "Menjalankan model Whisper AI (inferensi suara)...";
          pct = Math.min(80, 20 + Math.floor((elapsed - 6) * 3));
        } else if (elapsed >= 20) {
          stage = "Laya Decision Engine: Perapian konteks dialog & pembuatan MoM...";
          pct = Math.min(95, 65 + Math.floor(elapsed - 20));
        }
        return {
          percent: prev?.percent ? Math.max(prev.percent, pct) : pct,
          stage,
          elapsed_s: elapsed,
          current_text: prev?.current_text || "",
        };
      });
    }, 1000);

    try {
      const form = new FormData();
      form.append("audioFile", file);
      form.append("combo", selectedCombo);
      form.append("ai_correction", aiCorrection ? "true" : "false");
      form.append("paraphrase_style", paraphraseStyle);
      if (selectedModelId) form.append("model_id", selectedModelId);

      const res = await fetch(`${API}/upload-and-transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload gagal");

      if (data.success && data.id) {
        setJobId(null);
        setResult({
          ...data,
          final_text: data.finalText || "",
          raw_text: data.rawText || "",
          markdown_text: data.aiSummary || data.finalText || "",
          ai_summary: data.aiSummary,
          duration_s: data.durationS || 0,
          created_at: data.createdAt,
          word_timestamps: data.segments || [],
          ai_data: {
            dialog_transcript: data.dialogTranscript,
          },
          share_slug: data.shareSlug,
        });
        setResultTab("dialog");
        setProgress(null);
        setProcessing(false);
        fetchHistory();
      } else {
        throw new Error("Respons transkripsi tidak lengkap.");
      }
    } catch (e) {
      setProcessing(false);
      setProgress(null);
      setError(e.message);
    } finally {
      clearInterval(progressTimer);
    }
  };

  // AI Re-Paraphrase with Custom User Prompt (Requirement 3)
  const handleParaphrase = async (item, customPromptText = null) => {
    if (!item?.id || paraphrasing || !token) return;
    setParaphrasing(true);
    setError("");

    try {
      const res = await fetch(`${API}/paraphrase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: item.id,
          style: paraphraseStyle,
          model_id: selectedModelId || undefined,
          custom_prompt: customPromptText || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memparafrase.");

      const updatedMom = data.aiSummary;
      if (selectedItem && selectedItem.id === item.id) {
        setSelectedItem((prev) => ({
          ...prev,
          ai_summary: updatedMom,
          markdown_text: updatedMom,
        }));
      }
      if (result && result.id === item.id) {
        setResult((prev) => ({
          ...prev,
          ai_summary: updatedMom,
          markdown_text: updatedMom,
        }));
      }
      fetchHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setParaphrasing(false);
    }
  };

  // Save MoM from Tiptap Editor directly
  const handleSaveMom = async (item, newContent) => {
    if (!item?.id || !token) return;
    try {
      const res = await fetch(`${API}/transcripts/${item.id}/mom`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: newContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan MoM.");

      if (selectedItem && selectedItem.id === item.id) {
        setSelectedItem((prev) => ({
          ...prev,
          ai_summary: newContent,
          markdown_text: newContent,
        }));
      }
      if (result && result.id === item.id) {
        setResult((prev) => ({
          ...prev,
          ai_summary: newContent,
          markdown_text: newContent,
        }));
      }
      fetchHistory();
    } catch (err) {
      console.error("Gagal simpan MoM:", err);
    }
  };

  const downloadTxt = (item) => {
    const text = item.ai_summary || item.markdown_text || item.final_text || "";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(item.filename || "transkripsi").replace(/\.[^/.]+$/, "")}_MoM.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteTranscript = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Apakah Anda yakin ingin menghapus catatan rapat ini?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API}/transcripts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setHistory((prev) => prev.filter((item) => item.id !== id));
        if (selectedItem && selectedItem.id === id) {
          setSelectedItem(null);
          setNav("history");
        }
        if (result && result.id === id) {
          setResult(null);
        }
      }
    } catch (err) {
      console.error("Gagal menghapus:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      if (!historySearch.trim()) return true;
      const s = historySearch.toLowerCase();
      return (
        item.filename.toLowerCase().includes(s) ||
        (item.final_text && item.final_text.toLowerCase().includes(s)) ||
        (item.ai_summary && item.ai_summary.toLowerCase().includes(s))
      );
    });
  }, [history, historySearch]);

  // =========================================================================
  // VIEW 1: PUBLIC SHARE MoM VIEW (No Login Required - Requirement 6)
  // =========================================================================
  if (publicShareSlug) {
    return (
      <div style={{ fontFamily: "'Sora', 'DM Sans', sans-serif" }} className="min-h-screen bg-[#0c0e14] text-slate-100 p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Public Header */}
          <header className="bg-gradient-to-r from-[#141722]/95 via-[#11131c]/95 to-[#0d0f16]/95 border border-[#1e2330] rounded-2xl p-4 md:px-6 md:py-4 shadow-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#27272a] to-[#18181b] border border-purple-500/30 flex items-center justify-center p-1.5 shadow-md shadow-purple-950/40 shrink-0">
                <img src={resmeetSymbol} alt="Resmeet Symbol" className="w-full h-full object-contain" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-white tracking-tight">
                    Res<span className="text-purple-400">meet</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-wider font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-full">
                    Public MoM Share
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Pratinjau publik dokumen Minutes of Meeting (MoM) resmi korporat
                </p>
              </div>
            </div>

            <a
              href="/"
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0c0e14] border border-[#1e2330]"
            >
              <span>Buka Aplikasi</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </a>
          </header>

          {publicShareLoading ? (
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-16 text-center space-y-3">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
              <p className="text-sm text-slate-300 font-medium">Memuat dokumen publik MoM...</p>
              <p className="text-xs text-slate-500 font-mono">Kode slug: {publicShareSlug}</p>
            </div>
          ) : publicShareError ? (
            <div className="bg-[#151821] border border-rose-500/30 rounded-2xl p-12 text-center space-y-3">
              <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
              <h3 className="text-base font-bold text-white">Akses Dokumen Tidak Tersedia</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">{publicShareError}</p>
            </div>
          ) : publicShareData ? (
            <div className="space-y-4">
              <TiptapDocxEditor
                content={publicShareData.aiSummary || publicShareData.finalText || ""}
                filename={publicShareData.filename}
                isReadOnly={true}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: AUTH LOGIN REQUIRED
  // =========================================================================
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0c0e14] flex items-center justify-center text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!user || !token) {
    return (
      <LoginView
        onLoginSuccess={(u, t) => {
          setUser(u);
          setToken(t);
        }}
        apiBaseUrl={SOCKET_URL}
      />
    );
  }

  const isSuperadmin = user.role === "superadmin";

  return (
    <div style={{ fontFamily: "'Sora', 'DM Sans', sans-serif" }} className="min-h-screen bg-[#0c0e14] text-slate-100 p-4 md:p-6 lg:p-8 pb-24 md:pb-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Navigation Bar Header (Requirement 12: Only Transkrip, Riwayat, Model AI, and User for admin) */}
        <header className="bg-gradient-to-r from-[#141722]/95 via-[#11131c]/95 to-[#0d0f16]/95 backdrop-blur-xl border border-[#1e2330] rounded-2xl p-3 md:px-5 md:py-3.5 shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between gap-4">

            {/* 1. Left: Brand Identity & Live Preflight Status Badge */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#27272a] to-[#18181b] border border-purple-500/30 flex items-center justify-center p-1.5 shadow-md shadow-purple-950/40 shrink-0">
                <img src={resmeetSymbol} alt="Resmeet Symbol" className="w-full h-full object-contain" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-white tracking-tight">
                    Res<span className="text-purple-400">meet</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-wider font-semibold bg-purple-500/15 border border-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full">
                    STT Enterprise
                  </span>
                </div>

                {/* Preflight Live Indicator (Requirement 8) */}
                <button
                  type="button"
                  onClick={() => {
                    if (isSuperadmin) setShowPreflightModal(true);
                  }}
                  className={`flex items-center gap-1.5 text-[11px] font-medium mt-0.5 transition-all text-left ${
                    isSuperadmin ? "cursor-pointer hover:underline" : "cursor-default"
                  }`}
                  title={
                    isSuperadmin
                      ? `Preflight Check: Database, FFmpeg, Whisper, dan Gateway AI • Klik untuk audit detail`
                      : `Status Kesiapan Sistem`
                  }
                >
                  {preflightStatus === "ready" && (
                    <>
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50 shrink-0" />
                      <span className="text-emerald-400 font-semibold tracking-wide">Ready</span>
                      <span className="text-slate-600">•</span>
                      <span className="text-slate-300">Sistem Siap</span>
                    </>
                  )}
                  {preflightStatus === "not_connected" && (
                    <>
                      <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse shadow-sm shadow-rose-500/50 shrink-0" />
                      <span className="text-rose-400 font-semibold tracking-wide">Not Connected</span>
                      <span className="text-slate-600">•</span>
                      <span className="text-rose-300/80">Terputus</span>
                    </>
                  )}
                  {preflightStatus === "not_ready" && (
                    <>
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-sm shadow-amber-400/50 shrink-0" />
                      <span className="text-amber-400 font-semibold tracking-wide">Not Ready</span>
                      <span className="text-slate-600">•</span>
                      <span className="text-amber-300/80">
                        {preflightChecks && !preflightChecks.aiGateway ? "Gateway AI Diperlukan" : "Perlu Perhatian"}
                      </span>
                    </>
                  )}
                  {preflightStatus === "checking" && (
                    <>
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-400/60 animate-ping shrink-0" />
                      <span className="text-slate-400 font-medium">Checking Connection...</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 2. Desktop Navigation Menu (Requirement 12: Exactly Transkrip, Riwayat, Model AI, and User for admin) */}
            <div className="hidden md:flex items-center gap-3">
              <nav className="flex items-center gap-1 bg-[#090b10] p-1 rounded-xl border border-[#1e2330]">
                {/* 1. Transkrip */}
                <button
                  type="button"
                  onClick={() => setNav("transcribe")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    nav === "transcribe"
                      ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-950/40 font-semibold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-[#141722]"
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>Transkrip</span>
                </button>

                {/* 2. Riwayat */}
                <button
                  type="button"
                  onClick={() => setNav("history")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    nav === "history" || nav === "detail"
                      ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-950/40 font-semibold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-[#141722]"
                  }`}
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Riwayat</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none ${
                    nav === "history" || nav === "detail"
                      ? "bg-white/20 text-white"
                      : "bg-[#181d28] text-slate-400"
                  }`}>
                    {history.length}
                  </span>
                </button>

                {/* 3. Model AI */}
                <button
                  type="button"
                  onClick={() => setNav("models")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    nav === "models"
                      ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-950/40 font-semibold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-[#141722]"
                  }`}
                >
                  <Brain className="w-3.5 h-3.5 text-purple-400" />
                  <span>Model AI</span>
                </button>

                {/* 4. User (Superadmin Only) */}
                {isSuperadmin && (
                  <button
                    type="button"
                    onClick={() => setNav("users")}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                      nav === "users"
                        ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-950/40 font-semibold"
                        : "text-slate-400 hover:text-slate-200 hover:bg-[#141722]"
                    }`}
                  >
                    <Users className="w-3.5 h-3.5 text-emerald-400" />
                    <span>User</span>
                  </button>
                )}
              </nav>

              {/* User Pill & Logout */}
              <div className="flex items-center gap-2 bg-[#090b10] px-3 py-1.5 rounded-xl border border-[#1e2330]">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[11px] ${
                  isSuperadmin
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                    : "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                }`}>
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs text-slate-300 font-semibold">@{user.username}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all ml-1 cursor-pointer"
                  title="Keluar dari sistem"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Mobile Header Profile Action */}
            <div className="flex md:hidden items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center justify-center text-xs font-bold">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="p-1.5 text-slate-400 hover:text-rose-400 bg-[#090b10] rounded-lg border border-[#1e2330]"
                title="Keluar"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        {/* ========================================================================= */}
        {/* PAGE 1: TRANSKRIPSI AUDIO & PEMBUATAN MoM                                */}
        {/* ========================================================================= */}
        {nav === "transcribe" && (
          <div className="space-y-6">
            {/* Input Card */}
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1e2330] pb-4">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <FileAudio className="w-5 h-5 text-indigo-400" />
                    Sumber Input Audio
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Unggah file rekaman rapat atau gunakan perekaman mikrofon langsung berstandar 16 kHz.
                  </p>
                </div>

                {/* Audio Source Switcher */}
                <div className="flex items-center gap-1 bg-[#0c0e14] p-1 rounded-xl border border-[#1e2330]">
                  <button
                    type="button"
                    onClick={() => {
                      setAudioSource("upload");
                      if (isRecording) cancelRecording();
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                      audioSource === "upload"
                        ? "bg-indigo-600 text-white font-semibold shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload File</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAudioSource("record");
                      setFile(null);
                      if (audioUrl) URL.revokeObjectURL(audioUrl);
                      setAudioUrl(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                      audioSource === "record"
                        ? "bg-indigo-600 text-white font-semibold shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5 text-rose-400" />
                    <span>Rekam Suara</span>
                  </button>
                </div>
              </div>

              {/* Source Mode: Upload */}
              {audioSource === "upload" && (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                    file
                      ? "border-indigo-500/50 bg-indigo-500/5"
                      : "border-[#1e2330] hover:border-indigo-500/40 bg-[#0c0e14]/50"
                  }`}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept="audio/*,video/*"
                    onChange={(e) => {
                      if (e.target.files?.[0]) acceptFile(e.target.files[0]);
                    }}
                    className="hidden"
                  />
                  {file ? (
                    <div className="space-y-3">
                      <div className="w-12 h-12 rounded-xl bg-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center">
                        <CheckCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="font-semibold text-white text-sm">{file.name}</p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          {(file.size / (1024 * 1024)).toFixed(2)} MB • Klik atau seret berkas lain untuk mengganti
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="w-12 h-12 rounded-xl bg-[#151821] text-slate-400 mx-auto flex items-center justify-center border border-[#1e2330]">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-200">
                          Seret &amp; lepas file audio ke sini, atau klik untuk memilih
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Mendukung WAV, MP3, M4A, FLAC, OGG, WebM, MP4 (hingga 1 GB)
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Source Mode: Live Recording */}
              {audioSource === "record" && (
                <div className="bg-[#0c0e14] border border-[#1e2330] rounded-2xl p-6 text-center space-y-4">
                  <div className="flex items-center justify-center gap-3">
                    <span className="font-mono text-2xl font-bold text-white tracking-widest">
                      {fmtTimer(recordSeconds)}
                    </span>
                    {isRecording && !isPaused && (
                      <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping" />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {!isRecording ? (
                      <button
                        type="button"
                        onClick={startRecording}
                        disabled={checkingMic}
                        className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-rose-600/30 transition-all cursor-pointer"
                      >
                        <Mic className="w-4 h-4" />
                        <span>Mulai Merekam</span>
                      </button>
                    ) : (
                      <>
                        {isPaused ? (
                          <button
                            type="button"
                            onClick={resumeRecording}
                            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-medium cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Lanjutkan</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={pauseRecording}
                            className="flex items-center gap-1.5 px-4 py-2 bg-[#1a1f2e] border border-[#2e374d] text-slate-200 rounded-xl text-xs font-medium cursor-pointer"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            <span>Jeda</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={stopRecording}
                          className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer"
                        >
                          <Square className="w-3.5 h-3.5" />
                          <span>Selesai &amp; Gunakan Audio</span>
                        </button>
                        <button
                          type="button"
                          onClick={cancelRecording}
                          className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Batal</span>
                        </button>
                      </>
                    )}
                  </div>

                  {micError && (
                    <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5 max-w-md mx-auto">
                      {micError}
                    </p>
                  )}
                </div>
              )}

              {/* Preflight Gate Warning if Not Ready (Requirement 8) */}
              {preflightStatus !== "ready" && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-start gap-3 text-xs text-amber-300 animate-in fade-in duration-300">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-white">Transkripsi Belum Dapat Dimulai (Sistem Belum Siap)</p>
                    <p className="text-amber-200/90 leading-relaxed text-[11px]">
                      {preflightChecks && !preflightChecks.aiGateway ? (
                        <>
                          Koneksi Gateway AI wajib dikonfigurasi sebelum menjalankan transkripsi.
                          Buka tab <button type="button" onClick={() => setNav("models")} className="underline font-bold text-amber-100 hover:text-white">Model AI</button> untuk mengisi Base URL dan API Key.
                        </>
                      ) : (
                        "Komponen sistem (Whisper CLI, model, atau PostgreSQL) sedang belum siap. Periksa status sistem di navbar."
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* Action Bar: Mulai Transkripsi */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span>
                    Pemrosesan otomatis menyusun giliran dialog [MM:SS] dan ringkasan MoM DOCX.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleProcess}
                  disabled={!file || processing || preflightStatus !== "ready"}
                  className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold shadow-xl shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {processing ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4" />
                  )}
                  <span>{processing ? "Memproses Audio & MoM..." : "Mulai Transkripsi Audio"}</span>
                </button>
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Progress Panel */}
            {processing && progress && (
              <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6">
                <ProgressPanel progress={progress} />
              </div>
            )}

            {/* Transcribe Result View (Requirements 2, 3, 4, 5) */}
            {result && (
              <div className="space-y-4">
                {/* 3 Output Tabs Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#151821] border border-[#1e2330] p-3 rounded-2xl">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white px-2">
                    <FileText className="w-4 h-4 text-indigo-400" />
                    <span>Hasil Pemrosesan Transkripsi:</span>
                  </div>

                  <div className="flex flex-wrap gap-1 bg-[#0c0e14] p-1 rounded-xl border border-[#1e2330] text-xs">
                    <button
                      type="button"
                      onClick={() => setResultTab("dialog")}
                      className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                        resultTab === "dialog"
                          ? "bg-indigo-600 text-white font-semibold shadow"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                      <span>1. Transkrip Percakapan / Menit</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setResultTab("mom")}
                      className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                        resultTab === "mom"
                          ? "bg-indigo-600 text-white font-semibold shadow"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-400" />
                      <span>2. Editor Dokumen MoM (DOCX)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setResultTab("mindmap")}
                      className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                        resultTab === "mindmap"
                          ? "bg-indigo-600 text-white font-semibold shadow"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <GitBranch className="w-3.5 h-3.5 text-purple-400" />
                      <span>3. Mindmap Visual (Markmap)</span>
                    </button>
                  </div>
                </div>

                {/* Tab 1: Dialog Transcript */}
                {resultTab === "dialog" && (
                  <DialogTranscriptView
                    item={result}
                    filename={result.filename || file?.name || "Rapat"}
                    durationS={result.duration_s || 0}
                  />
                )}

                {/* Tab 2: Tiptap DOCX Editor */}
                {resultTab === "mom" && (
                  <TiptapDocxEditor
                    content={result.ai_summary || result.markdown_text || result.final_text || ""}
                    filename={result.filename || file?.name || "Rapat"}
                    itemId={result.id}
                    shareSlug={result.share_slug}
                    apiBaseUrl={SOCKET_URL}
                    token={token}
                    onSave={(newContent) => handleSaveMom(result, newContent)}
                    onParaphraseCustom={(promptText) => handleParaphrase(result, promptText)}
                    paraphrasing={paraphrasing}
                  />
                )}

                {/* Tab 3: Markmap */}
                {resultTab === "mindmap" && (
                  <MarkmapView
                    markdown={result.ai_summary || result.markdown_text || result.final_text}
                    title={result.filename || file?.name || "Pohon Topik Rapat"}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* PAGE 2: RIWAYAT TRANSKRIPSI                                               */}
        {/* ========================================================================= */}
        {nav === "history" && (
          <div className="space-y-6">
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2330] pb-4">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-indigo-400" />
                    Riwayat Pemrosesan Data Transkripsi
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                      {isSuperadmin ? "Akses Superadmin" : `Akun: @${user.username}`}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {isSuperadmin
                      ? "Menampilkan seluruh riwayat transkripsi terpusat (PostgreSQL UUID v7)."
                      : "Menampilkan riwayat transkripsi milik akun Anda secara terisolasi."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => fetchHistory()}
                  disabled={loadingH}
                  className="p-2 bg-[#0c0e14] hover:bg-[#1a1f2e] border border-[#1e2330] text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer self-start sm:self-auto"
                  title="Perbarui riwayat"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingH ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Date Filter & Search */}
              <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-slate-400 font-semibold mr-1 flex items-center gap-1">
                      <Filter className="w-3.5 h-3.5 text-indigo-400" />
                      Filter Tanggal:
                    </span>
                    <button
                      type="button"
                      onClick={() => applyQuickDateFilter("all")}
                      className={`px-3 py-1 rounded-lg transition-all ${quickDateFilter === "all" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                    >
                      Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickDateFilter("today")}
                      className={`px-3 py-1 rounded-lg transition-all ${quickDateFilter === "today" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                    >
                      Hari Ini
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickDateFilter("7d")}
                      className={`px-3 py-1 rounded-lg transition-all ${quickDateFilter === "7d" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                    >
                      7 Hari
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickDateFilter("30d")}
                      className={`px-3 py-1 rounded-lg transition-all ${quickDateFilter === "30d" ? "bg-indigo-600 text-white font-medium shadow" : "bg-[#151821] text-slate-400 hover:text-white border border-[#1e2330]"}`}
                    >
                      30 Hari
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="flex items-center gap-1.5 bg-[#151821] border border-[#1e2330] rounded-lg px-2.5 py-1">
                      <span className="text-[11px] text-slate-500">Mulai:</span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          setQuickDateFilter("custom");
                          fetchHistory(e.target.value, endDate);
                        }}
                        className="bg-transparent text-slate-200 outline-none text-xs cursor-pointer"
                      />
                    </div>
                    <span className="text-slate-600">s/d</span>
                    <div className="flex items-center gap-1.5 bg-[#151821] border border-[#1e2330] rounded-lg px-2.5 py-1">
                      <span className="text-[11px] text-slate-500">Sampai:</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => {
                          setEndDate(e.target.value);
                          setQuickDateFilter("custom");
                          fetchHistory(startDate, e.target.value);
                        }}
                        className="bg-transparent text-slate-200 outline-none text-xs cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Cari berdasarkan nama berkas atau isi ringkasan MoM..."
                    className="w-full bg-[#151821] border border-[#1e2330] rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-xl border border-[#1e2330] bg-[#0c0e14]">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-[#12151e] text-slate-400 font-semibold uppercase text-[10px] tracking-wider border-b border-[#1e2330]">
                    <tr>
                      <th className="px-4 py-3">Berkas Audio</th>
                      <th className="px-4 py-3">Tanggal Waktu</th>
                      <th className="px-4 py-3">Durasi</th>
                      <th className="px-4 py-3">Status Notulen</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2330] text-slate-300">
                    {filteredHistory.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setSelectedItem(item);
                          setNav("detail");
                        }}
                        className="hover:bg-indigo-500/5 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3.5 font-medium">
                          <div className="flex items-center gap-2.5">
                            <FileAudio className="w-4 h-4 text-indigo-400 shrink-0" />
                            <span className="text-white hover:text-indigo-300 font-semibold truncate max-w-xs">
                              {item.filename}
                            </span>
                          </div>
                        </td>

                        <td className="px-4 py-3.5 text-slate-400 text-[11px] font-mono">
                          {fmt(item.created_at)}
                        </td>

                        <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                          {fmtDur(item.duration_s)}
                        </td>

                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                            item.ai_correction_status === "completed" || item.ai_correction_status === "paraphrased"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : "bg-slate-800 text-slate-400 border border-slate-700"
                          }`}>
                            {item.ai_correction_status === "paraphrased" ? "Diparafrase AI" : item.ai_correction_status}
                          </span>
                        </td>

                        <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => { setSelectedItem(item); setNav("detail"); }}
                              className="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-lg border border-indigo-500/30 text-[11px] font-medium transition-all"
                            >
                              Buka MoM
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteTranscript(item.id, e)}
                              disabled={deletingId === item.id}
                              className="p-1.5 bg-[#151821] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-[#1e2330] rounded-lg transition-all"
                              title="Hapus Transkrip"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredHistory.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-500 text-xs">
                          {loadingH ? "Memuat riwayat transkripsi..." : "Belum ada rekaman transkripsi pada filter ini."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PAGE 3: DETAIL NOTULEN MoM (DOCX EDITOR & MINDMAP)                        */}
        {/* ========================================================================= */}
        {nav === "detail" && selectedItem && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setNav("history")}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-[#151821] border border-[#1e2330] px-3.5 py-2 rounded-xl transition-all cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Kembali ke Riwayat</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadTxt(selectedItem)}
                  className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-[#151821] border border-[#1e2330] px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh .txt</span>
                </button>
              </div>
            </div>

            {/* 3 Output Tabs (Requirements 3, 4, 5) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0c0e14] p-3 rounded-xl border border-[#1e2330]">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                Pilih Tampilan Output Dokumen:
              </span>

              <div className="flex flex-wrap gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setDetailTab("dialog")}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                    detailTab === "dialog"
                      ? "bg-indigo-600 text-white font-medium shadow"
                      : "text-slate-400 hover:text-white bg-[#151821] border border-[#1e2330]"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                  <span>1. Transkrip Percakapan / Menit</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDetailTab("mom")}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                    detailTab === "mom"
                      ? "bg-indigo-600 text-white font-medium shadow"
                      : "text-slate-400 hover:text-white bg-[#151821] border border-[#1e2330]"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-400" />
                  <span>2. Editor Dokumen MoM (DOCX)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDetailTab("mindmap")}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                    detailTab === "mindmap"
                      ? "bg-indigo-600 text-white font-medium shadow"
                      : "text-slate-400 hover:text-white bg-[#151821] border border-[#1e2330]"
                  }`}
                >
                  <GitBranch className="w-3.5 h-3.5 text-purple-400" />
                  <span>3. Mindmap Visual (Markmap)</span>
                </button>
              </div>
            </div>

            {/* Tab 1: Dialog Transcript */}
            {detailTab === "dialog" && (
              <DialogTranscriptView
                item={selectedItem}
                filename={selectedItem.filename}
                durationS={selectedItem.duration_s}
              />
            )}

            {/* Tab 2: Tiptap DOCX Editor */}
            {detailTab === "mom" && (
              <TiptapDocxEditor
                content={selectedItem.ai_summary || selectedItem.markdown_text || selectedItem.final_text || ""}
                filename={selectedItem.filename}
                itemId={selectedItem.id}
                shareSlug={selectedItem.share_slug}
                isPublic={selectedItem.is_public}
                apiBaseUrl={SOCKET_URL}
                token={token}
                onSave={(newContent) => handleSaveMom(selectedItem, newContent)}
                onParaphraseCustom={(promptText) => handleParaphrase(selectedItem, promptText)}
                paraphrasing={paraphrasing}
              />
            )}

            {/* Tab 3: Markmap Visual */}
            {detailTab === "mindmap" && (
              <MarkmapView
                markdown={selectedItem.ai_summary || selectedItem.markdown_text || selectedItem.final_text}
                title={selectedItem.filename}
              />
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* PAGE 4: USER AI MODELS & GATEWAY (LAYA DECISION ENGINE CONSOLIDATED)      */}
        {/* ========================================================================= */}
        {nav === "models" && (
          <UserAiModelsView
            token={token}
            user={user}
            apiBaseUrl={SOCKET_URL}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            paraphraseStyle={paraphraseStyle}
            setParaphraseStyle={setParaphraseStyle}
            aiCorrection={aiCorrection}
            setAiCorrection={setAiCorrection}
          />
        )}

        {/* ========================================================================= */}
        {/* PAGE 5: USER MANAGEMENT (SUPERADMIN ONLY)                                */}
        {/* ========================================================================= */}
        {nav === "users" && isSuperadmin && (
          <UserManagementView
            token={token}
            currentUserId={user.id}
            apiBaseUrl={SOCKET_URL}
          />
        )}

        {/* ========================================================================= */}
        {/* SUPERADMIN PREFLIGHT INSPECTION MODAL (Requirement 8)                    */}
        {/* ========================================================================= */}
        {showPreflightModal && isSuperadmin && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#151821] border border-[#1e2330] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#1e2330] pb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Server className="w-5 h-5 text-indigo-400" />
                  Inspeksi Status Sistem &amp; Preflight Check
                </h3>
                <button
                  type="button"
                  onClick={() => setShowPreflightModal(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-[#1e2330]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <PreflightStatusView
                token={token}
                apiBaseUrl={SOCKET_URL}
                onRefresh={checkPreflight}
                onBack={() => setShowPreflightModal(false)}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="text-center text-xs text-slate-500 py-6 border-t border-[#1e2330]/50">
          <p>
            Resmeet STT Enterprise • Laya Decision Engine • PostgreSQL Native • Tiptap DOCX Standard
          </p>
        </footer>
      </div>

      {/* ========================================================================= */}
      {/* MOBILE APP BOTTOM-MENU-BAR (Requirement 13)                               */}
      {/* ========================================================================= */}
      <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-[#0d0f16]/95 backdrop-blur-xl border-t border-[#1e2330] px-3 py-2 flex items-center justify-around shadow-2xl">
        {/* 1. Transkrip */}
        <button
          type="button"
          onClick={() => setNav("transcribe")}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all cursor-pointer ${
            nav === "transcribe"
              ? "text-indigo-400 font-bold"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Mic className="w-5 h-5" />
          <span className="text-[10px]">Transkrip</span>
        </button>

        {/* 2. Riwayat */}
        <button
          type="button"
          onClick={() => setNav("history")}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all relative cursor-pointer ${
            nav === "history" || nav === "detail"
              ? "text-indigo-400 font-bold"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Database className="w-5 h-5" />
          <span className="text-[10px]">Riwayat</span>
          {history.length > 0 && (
            <span className="absolute top-0 right-2 w-4 h-4 bg-indigo-600 text-white rounded-full text-[9px] flex items-center justify-center font-bold">
              {history.length > 99 ? "99+" : history.length}
            </span>
          )}
        </button>

        {/* 3. Model AI */}
        <button
          type="button"
          onClick={() => setNav("models")}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all cursor-pointer ${
            nav === "models"
              ? "text-indigo-400 font-bold"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Brain className="w-5 h-5 text-purple-400" />
          <span className="text-[10px]">Model AI</span>
        </button>

        {/* 4. User (Admin only) */}
        {isSuperadmin && (
          <button
            type="button"
            onClick={() => setNav("users")}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all cursor-pointer ${
              nav === "users"
                ? "text-indigo-400 font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users className="w-5 h-5 text-emerald-400" />
            <span className="text-[10px]">User</span>
          </button>
        )}
      </nav>
    </div>
  );
}
