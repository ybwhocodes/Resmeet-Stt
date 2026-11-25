import { useState, useEffect, useCallback } from "react";
import { ShieldCheck, RefreshCw, CheckCircle2, XCircle, AlertCircle, Cpu, Database, HardDrive, FileAudio, ArrowLeft, Brain } from "lucide-react";

const itemsConfig = [
  {
    key: "transcriptionWorker",
    label: "Worker Transkripsi",
    desc: "Antrean persisten dan worker pemrosesan tersedia",
    solution: "Jalankan 'docker compose up -d worker' atau restart worker dengan 'docker compose restart worker'.",
    icon: Cpu,
  },
  {
    key: "database",
    label: "PostgreSQL Database",
    desc: "Koneksi dan query pool PostgreSQL aktif",
    solution: "Pastikan container database aktif di port 5433 ('docker compose up -d postgres') dan pastikan DATABASE_URL sesuai.",
    icon: Database,
  },
  {
    key: "ffmpeg",
    label: "FFmpeg Audio Converter",
    desc: "Konversi audio ke 16 kHz WAV mono",
    solution: "Pastikan paket FFmpeg terpasang di dalam image container backend.",
    icon: FileAudio,
  },
  {
    key: "whisperCli",
    label: "Mesin Transkripsi",
    desc: "Runtime pemrosesan CPU/GPU tersedia",
    solution: "Periksa executable whisper-server/cli atau runtime faster-whisper di backend.",
    icon: Cpu,
  },
  {
    key: "whisperModel",
    label: "Model Whisper GGML",
    desc: "File bobot model speech-to-text tersedia",
    solution: "Pastikan file bobot model (misal 'ggml-large-v3-turbo-q5_0.bin') tersedia di folder ./models/.",
    icon: HardDrive,
  },
  {
    key: "uploadsWritable",
    label: "Penyimpanan Upload",
    desc: "Direktori penyimpanan audio dapat ditulis",
    solution: "Beri izin tulis pada folder uploads: 'chmod -R 777 uploads'.",
    icon: HardDrive,
  },
  {
    key: "aiWorker",
    label: "Worker AI",
    desc: "Perapian transkrip dan MoM terpisah (opsional)",
    solution: "Jalankan 'docker compose up -d ai-worker' jika fitur AI perapian diperlukan.",
    icon: Brain,
  },
  {
    key: "aiGateway",
    label: "Koneksi Gateway AI",
    desc: "Gateway AI terkonfigurasi (opsional)",
    solution: "Konfigurasikan API Key AI Gateway pada menu Model AI.",
    icon: Brain,
  },
];

export default function PreflightStatusView({
  token,
  apiBaseUrl = "http://127.0.0.1:8200",
  onRefresh,
  onBack,
}) {
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState({});
  const [error, setError] = useState("");
  const [lastChecked, setLastChecked] = useState(null);

  const fetchPreflight = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/preflight`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memverifikasi status sistem.");
      if (!data.checks || itemsConfig.some(({ key }) => typeof data.checks[key] !== "boolean")) {
        throw new Error("Respons Preflight backend tidak lengkap. Perbarui backend Rust.");
      }
      setChecks(data.checks);
      setLastChecked(new Date().toLocaleTimeString("id-ID"));
      onRefresh?.();
    } catch (err) {
      setError(err.message || "Gagal menghubungi backend.");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, token, onRefresh]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) fetchPreflight(); });
    return () => { active = false; };
  }, [fetchPreflight]);

  const allPassed = !error && itemsConfig.filter(({ key }) => !["aiGateway", "aiWorker"].includes(key)).every(({ key }) => checks[key] === true);

  return (
    <div className="space-y-6">
      <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2330] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                Status Sistem &amp; Kesiapan (Preflight Check)
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  Audit Layanan
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Pemeriksaan PostgreSQL, FFmpeg, Whisper, model transkripsi, penyimpanan upload, dan Gateway AI
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-3.5 py-2 bg-[#0c0e14] hover:bg-[#1a1f2e] border border-[#1e2330] text-slate-300 hover:text-white rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Kembali</span>
              </button>
            )}
            {lastChecked && (
              <span className="text-[11px] text-slate-500 font-mono hidden md:inline">
                Diperiksa: {lastChecked}
              </span>
            )}
            <button
              onClick={fetchPreflight}
              disabled={loading}
              className="px-3.5 py-2 bg-[#0c0e14] hover:bg-[#1a1f2e] border border-[#1e2330] text-slate-300 hover:text-white rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Periksa Ulang</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between p-4 rounded-xl bg-[#0c0e14] border border-[#1e2330]">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${allPassed ? "bg-emerald-400 shadow-md shadow-emerald-400/50 animate-pulse" : "bg-rose-400 shadow-md shadow-rose-400/50"}`} />
            <div>
              <p className="text-sm font-semibold text-white">
                {allPassed ? "Semua Layanan Siap (Ready)" : "Beberapa Komponen Perlu Perhatian (Not Ready)"}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {allPassed
                  ? "Sistem memenuhi seluruh syarat untuk menjalankan transkripsi audio dan pemrosesan AI opsional."
                  : "Perbaiki komponen yang bertanda silang merah di bawah sebelum menjalankan transkripsi."}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {itemsConfig.map(({ key, label, desc, solution, icon: Icon }) => {
            const passed = checks[key] === true;
            return (
              <div
                key={key}
                className="flex flex-col justify-between p-3.5 rounded-xl bg-[#0c0e14] border border-[#1e2330] hover:border-slate-700/60 transition-all space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-[#151821] border border-[#1e2330] text-slate-300 mt-0.5">
                      <Icon className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-200">{label}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
                    </div>
                  </div>

                  <div className="shrink-0 ml-3">
                    {loading ? (
                      <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />
                    ) : passed ? (
                      <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Siap</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-rose-400 text-xs font-medium bg-rose-500/10 px-2 py-0.5 rounded-md border border-rose-500/20">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Belum Siap</span>
                      </div>
                    )}
                  </div>
                </div>

                {!loading && !passed && solution && (
                  <div className="text-[11px] bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5 text-rose-300">
                    <span className="font-semibold text-rose-200">💡 Langkah Perbaikan: </span>
                    <span className="font-mono text-[10px] text-rose-100">{solution}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
