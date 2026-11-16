import React, { useState, useEffect } from "react";
import {
  Database, HardDrive, CheckCircle2, AlertCircle,
  Zap, RefreshCw, Lock, Save
} from "lucide-react";

export default function DatabaseConfigView({ token, apiBaseUrl = "http://127.0.0.1:8200" }) {
  const dbType = "postgres";
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(5432);
  const [name, setName] = useState("stt_db");
  const [user, setUser] = useState("postgres");
  const [password, setPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);
  const [error, setError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const fetchConfig = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/database`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memuat konfigurasi database.");
      setHost(data.dbHost || "127.0.0.1");
      setPort(data.dbPort || 5432);
      setName(data.dbName || "stt_db");
      setUser(data.dbUser || "postgres");
      setPassword(data.dbPassword || "");
    } catch (err) {
      setError(err.message || "Gagal memuat konfigurasi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, [token]);

  const handleTestConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/database/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: dbType,
          host,
          port: Number(port),
          name,
          user,
          password: password || undefined,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, message: err.message || "Gagal menguji koneksi." });
    } finally {
      setTestLoading(false);
    }
  };

  const handleSave = async () => {
    setSaveLoading(true);
    setSaveMessage("");
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/database/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ host, port: Number(port), name, user, password: password || undefined, adminPassword: adminPassword || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || data.error || "Gagal menyimpan database.");
      setSaveMessage(data.message);
      setPassword("");
      setAdminPassword("");
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleMigrate = async () => {
    setMigrateLoading(true);
    setMigrateResult(null);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/database/migrate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: dbType,
          host,
          port: Number(port),
          name,
          user,
          password: password || undefined,
        }),
      });
      const data = await res.json();
      setMigrateResult(data);
    } catch (err) {
      setMigrateResult({ success: false, message: err.message || "Gagal migrasi database." });
    } finally {
      setMigrateLoading(false);
    }
  };


  return (
    <div className="space-y-6">
      <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2330] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                Konfigurasi Database Terpusat
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  Superadmin Only
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Koneksi PostgreSQL yang digunakan backend Rust
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" />
              Aktif: <strong className="uppercase">{dbType}</strong>
            </span>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}
        {saveMessage && <p className="text-xs text-emerald-300">{saveMessage}</p>}

        {/* Form Connection Parameters */}
        <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-5 space-y-4">
          <div className="border-b border-[#1e2330] pb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-indigo-400" />
              Parameter Koneksi PostgreSQL
            </span>
            <span className="text-[11px] text-slate-500">
              Port standar: 5432
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Host Database</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="127.0.0.1 atau db.domain.com"
                className="w-full bg-[#151821] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                placeholder="5432"
                className="w-full bg-[#151821] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Nama Database</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="stt_db"
                className="w-full bg-[#151821] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Username DB</label>
              <input
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="postgres"
                className="w-full bg-[#151821] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-300 font-medium mb-1">
                Password DB
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Kosongkan untuk memakai password yang tersimpan"
                className="w-full bg-[#151821] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Password baru disimpan saat menekan Simpan. Kosongkan untuk mempertahankan password saat ini.
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-medium mb-1">Password superadmin untuk database baru</label>
              <input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)}
                placeholder="Isi hanya jika database tujuan belum memiliki akun (minimal 12 karakter)"
                className="w-full bg-[#151821] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-slate-200 outline-none focus:border-indigo-500/50" />
            </div>
          </div>

          {/* Test & Migration Feedback */}
          {testResult && (
            <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${testResult.success ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-300" : "bg-red-950/40 border-red-700/40 text-red-300"}`}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />}
              <div>
                <p className="font-semibold">{testResult.message}</p>
                {testResult.latencyMs && <p className="text-[10px] text-slate-400 mt-0.5 font-mono">Latency: {testResult.latencyMs}ms</p>}
              </div>
            </div>
          )}

          {migrateResult && (
            <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${migrateResult.success ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-300" : "bg-red-950/40 border-red-700/40 text-red-300"}`}>
              {migrateResult.success ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />}
              <div>
                <p className="font-semibold">{migrateResult.message}</p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#1e2330]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testLoading}
                className="px-4 py-2 bg-[#151821] hover:bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:text-white rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {testLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                <span>{testLoading ? "Menguji Koneksi..." : `Uji Koneksi ${dbType.toUpperCase()}`}</span>
              </button>

              <button
                type="button"
                onClick={handleMigrate}
                disabled={migrateLoading}
                className="px-4 py-2 bg-[#151821] hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {migrateLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                <span>{migrateLoading ? "Memigrasi..." : "Migrate Skema Database"}</span>
              </button>
            </div>
            <button type="button" onClick={handleSave} disabled={saveLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" /> {saveLoading ? "Menyimpan..." : "Simpan Koneksi Database"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
