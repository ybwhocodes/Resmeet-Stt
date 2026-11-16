import React, { useEffect, useState } from "react";
import { Lock, User, Eye, EyeOff, LogIn, Sparkles, AlertCircle, ShieldCheck } from "lucide-react";
import resmeetSymbol from "../assets/resmeet_symbol.svg";

export default function LoginView({ onLoginSuccess, apiBaseUrl = "http://127.0.0.1:8200" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [setup, setSetup] = useState({ host: "127.0.0.1", port: 5432, name: "stt_db", user: "postgres", password: "", adminUsername: "admin", adminPassword: "" });
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/setup/status`)
      .then((res) => res.json())
      .then((data) => {
        setSetupRequired(!data.configured);
        if (data.suggestedHost) setSetup((current) => ({ ...current, host: data.suggestedHost }));
      })
      .catch(() => setError("Tidak dapat memeriksa status database. Pastikan backend berjalan."));
  }, [apiBaseUrl]);

  const handleSetup = async (event) => {
    event.preventDefault();
    setSetupSaving(true);
    setSetupError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/setup/database`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...setup, port: Number(setup.port) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Setup database gagal.");
      setUsername(setup.adminUsername);
      setSetupRequired(false);
    } catch (err) {
      setSetupError(err.message);
    } finally {
      setSetupSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Username dan password wajib diisi.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          remember_me: rememberMe,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal masuk ke sistem.");
      }

      // Store in localStorage if remember me is checked
      if (rememberMe) {
        localStorage.setItem("resmeet_auth_token", data.token);
        localStorage.setItem("resmeet_auth_user", JSON.stringify(data.user));
        localStorage.setItem("resmeet_auth_remember", "true");
      } else {
        sessionStorage.setItem("resmeet_auth_token", data.token);
        sessionStorage.setItem("resmeet_auth_user", JSON.stringify(data.user));
        localStorage.removeItem("resmeet_auth_token");
        localStorage.removeItem("resmeet_auth_user");
        localStorage.removeItem("resmeet_auth_remember");
      }

      onLoginSuccess(data.user, data.token);
    } catch (err) {
      setError(err.message || "Terjadi kesalahan saat login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0c0e14] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {setupRequired && (
        <div role="dialog" aria-modal="true" aria-labelledby="database-setup-title" className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <form onSubmit={handleSetup} className="w-full max-w-lg bg-[#151821] border border-indigo-500/40 rounded-2xl p-6 space-y-4 shadow-2xl text-slate-200">
            <h2 id="database-setup-title" className="text-lg font-semibold text-white">Setup PostgreSQL diperlukan</h2>
            <p className="text-xs text-slate-400">Database belum dikonfigurasi. Isi koneksi PostgreSQL dan akun superadmin untuk mulai menggunakan aplikasi.</p>
            {setupError && <p className="text-xs text-rose-300">{setupError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                ["host", "Host database", "text"], ["port", "Port", "number"],
                ["name", "Nama database", "text"], ["user", "Username database", "text"],
                ["password", "Password database", "password"], ["adminUsername", "Username superadmin", "text"],
                ["adminPassword", "Password superadmin (min. 12 untuk akun baru)", "password"],
              ].map(([key, label, type]) => (
                <label key={key} className="text-xs text-slate-300 space-y-1">
                  <span>{label}</span>
                  <input type={type} value={setup[key]} required
                    onChange={(event) => setSetup((current) => ({ ...current, [key]: event.target.value }))}
                    className="w-full bg-[#0c0e14] border border-[#303747] rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500" />
                </label>
              ))}
            </div>
            <button type="submit" disabled={setupSaving} className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white">
              {setupSaving ? "Menghubungkan..." : "Simpan dan mulai"}
            </button>
          </form>
        </div>
      )}
      {/* Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Header Logo */}
        <div className="text-center mb-8 space-y-2">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br from-[#27272a] to-[#18181b] border border-purple-500/30 items-center justify-center p-2.5 shadow-xl shadow-purple-950/40 mb-3">
            <img src={resmeetSymbol} alt="Resmeet Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            Res<span className="text-purple-400">meet</span> STT Intelligence
          </h1>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Sistem Transkripsi Cerdas • Model AI Jev Guided Topics &amp; Notulen MoM Resmi
          </p>
        </div>

        {/* Login Box */}
        <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="border-b border-[#1e2330] pb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Masuk ke Akun</h2>
              <p className="text-xs text-slate-400 mt-0.5">Gunakan kredensial Anda untuk mengakses sistem</p>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              Sesi Terproteksi
            </span>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Input */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Masukkan username Anda"
                  className="w-full bg-[#0c0e14] border border-[#1e2330] focus:border-indigo-500/60 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-slate-200 outline-none transition-all placeholder:text-slate-600 font-sans"
                  autoFocus
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[#0c0e14] border border-[#1e2330] focus:border-indigo-500/60 rounded-xl pl-10 pr-10 py-2.5 text-xs text-slate-200 outline-none transition-all placeholder:text-slate-600 font-sans"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember Me Checkbox */}
            <div className="pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300 select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600 rounded bg-[#0c0e14] border-[#1e2330]"
                />
                <span className="font-medium text-slate-300">Ingat Saya</span>
                <span className="text-[11px] text-slate-500">(Simpan sesi di cache lokal browser)</span>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              <span>{loading ? "Memverifikasi..." : "Masuk ke Sistem"}</span>
            </button>
          </form>

          {/* Quick Notice */}
          <div className="pt-2 border-t border-[#1e2330] text-center">
            <p className="text-[11px] text-slate-500">
              Hak akses superadmin &amp; pengaturan model AI dikelola melalui PostgreSQL.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
