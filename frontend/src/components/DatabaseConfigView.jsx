import { useCallback, useEffect, useState } from "react";
import { Database, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";

export default function DatabaseConfigView({ token, apiBaseUrl = "" }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fetchConfig = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/database`, {
        headers: { Authorization: `Bearer ${token}` }, signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gagal memuat konfigurasi database.");
      if (!signal?.aborted) setConfig(data);
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apiBaseUrl, token]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => { if (!controller.signal.aborted) fetchConfig(controller.signal); });
    return () => controller.abort();
  }, [fetchConfig]);

  return <section className="space-y-4 rounded-2xl border border-[#1e2330] bg-[#151821] p-6 text-slate-200">
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-semibold"><Database size={20} />Database PostgreSQL</h2>
      <button type="button" disabled={loading} onClick={() => fetchConfig()} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs disabled:opacity-50">
        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />Perbarui
      </button>
    </div>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {loading && <p role="status" className="text-sm text-slate-400">Memeriksa koneksi database...</p>}
    {config && <>
      <p className={`flex items-center gap-2 text-sm ${config.connected ? "text-emerald-300" : "text-amber-300"}`}>
        {config.connected ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
        {config.connected ? "Database terhubung" : "Database belum terhubung"}
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {[["Host", config.dbHost], ["Port", config.dbPort], ["Database", config.dbName], ["Username", config.dbUser]].map(([label, value]) =>
          <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="break-all">{value}</dd></div>
        )}
      </dl>
      <p className="text-xs leading-relaxed text-slate-400">Koneksi mengikuti konfigurasi lingkungan atau setup awal. Untuk mengubah koneksi, perbarui variabel DB_HOST, DB_PORT, DB_NAME, DB_USER, dan DB_PASSWORD pada .env, lalu mulai ulang backend. Password database tidak ditampilkan.</p>
    </>}
  </section>;
}
