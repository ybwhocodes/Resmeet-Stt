import  { useState, useEffect, useCallback } from "react";
import {
  Users, UserPlus, KeyRound, Trash2, CheckCircle2,
  XCircle, Shield, User, AlertCircle, RefreshCw, X, Check
} from "lucide-react";

export default function UserManagementView({ token, currentUserId, apiBaseUrl = "http://127.0.0.1:8200" }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [createLoading, setCreateLoading] = useState(false);

  const [resetUser, setResetUser] = useState(null);
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memuat daftar user.");
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message || "Gagal menghubungi server.");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, token]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) fetchUsers(); });
    return () => { active = false; };
  }, [fetchUsers]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) return;

    setCreateLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal membuat akun user.");

      setSuccess(`Akun '${newUsername}' berhasil dibuat.`);
      setTimeout(() => setSuccess(""), 4000);
      setShowCreateModal(false);
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleToggleStatus = async (user) => {
    if (user.id === currentUserId) {
      setError("Superadmin tidak dapat menonaktifkan akun sendiri.");
      return;
    }

    const nextStatus = !user.is_active;
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/users/${user.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_active: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal mengubah status.");

      setSuccess(`Status ${user.username} berhasil diubah.`);
      setTimeout(() => setSuccess(""), 3000);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_active: nextStatus } : u))
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetUser || !resetNewPassword) return;

    setResetLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/users/${resetUser.id}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ new_password: resetNewPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal reset password.");

      setSuccess(`Password untuk ${resetUser.username} berhasil direset.`);
      setTimeout(() => setSuccess(""), 4000);
      setResetUser(null);
      setResetNewPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleDeleteUser = async (user) => {
    if (user.id === currentUserId) {
      setError("Superadmin tidak dapat menghapus akun sendiri.");
      return;
    }

    if (!window.confirm(`Yakin ingin menghapus akun '${user.username}'? Seluruh data transkrip dan konfigurasi model AI terkait akan ikut terhapus permanen.`)) {
      return;
    }

    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/users/${user.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menghapus user.");

      setSuccess(`Akun ${user.username} telah dihapus.`);
      setTimeout(() => setSuccess(""), 3000);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2330] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                Manajemen User
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  Superadmin Only
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Kelola akun pengguna, hak akses role, status keaktifan, dan reset password
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="p-2 bg-[#0c0e14] hover:bg-[#1a1f2e] border border-[#1e2330] text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer"
              title="Perbarui data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Tambah Akun Baru</span>
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{success}</span>
          </div>
        )}

        {/* Table of Users */}
        <div className="mt-6 overflow-x-auto rounded-xl border border-[#1e2330] bg-[#0c0e14]">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-[#12151e] text-slate-400 font-semibold uppercase text-[10px] tracking-wider border-b border-[#1e2330]">
              <tr>
                <th className="px-4 py-3">ID / User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Model AI</th>
                <th className="px-4 py-3">Transkrip</th>
                <th className="px-4 py-3">Terdaftar</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2330] text-slate-300">
              {users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className="hover:bg-indigo-500/5 transition-colors">
                    <td className="px-4 py-3.5 font-medium">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                          u.role === "superadmin"
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                            : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                        }`}>
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            {u.username}
                            {isSelf && (
                              <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded border border-slate-700 font-mono">
                                Anda
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">ID: #{u.id}</span>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                        u.role === "superadmin"
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                      }`}>
                        {u.role === "superadmin" ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                        {u.role}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => handleToggleStatus(u)}
                        disabled={isSelf}
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-all ${
                          u.is_active
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30"
                            : "bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30"
                        } ${isSelf ? "opacity-60 cursor-not-allowed" : ""}`}
                        title={isSelf ? "Tidak dapat menonaktifkan akun sendiri" : "Klik untuk mengubah status"}
                      >
                        {u.is_active ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3 text-rose-400" />}
                        <span>{u.is_active ? "Aktif" : "Nonaktif"}</span>
                      </button>
                    </td>

                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                      {u.model_count || 0} Model
                    </td>

                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                      {u.transcript_count || 0} Notulen
                    </td>

                    <td className="px-4 py-3.5 text-slate-500 text-[11px]">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString("id-ID") : "-"}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => { setResetUser(u); setResetNewPassword(""); }}
                          className="px-2.5 py-1 bg-[#151821] hover:bg-indigo-600/20 text-slate-300 hover:text-indigo-300 border border-[#1e2330] rounded-lg transition-all flex items-center gap-1 text-[11px] cursor-pointer"
                          title="Reset Password"
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>Reset Password</span>
                        </button>

                        {!isSelf && (
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="p-1.5 bg-[#151821] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-[#1e2330] rounded-lg transition-all cursor-pointer"
                            title="Hapus Akun"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Tambah Akun Baru */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151821] border border-[#1e2330] rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl relative animate-fadeIn">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Buat Akun Pengguna Baru</h3>
                <p className="text-[11px] text-slate-400">Masukkan detail kredensial dan tetapkan role</p>
              </div>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="misal: notulis_cabang"
                  className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-slate-200 outline-none focus:border-indigo-500/50"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Password Sementara</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 12 karakter"
                  className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-slate-200 outline-none focus:border-indigo-500/50"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Tetapkan Role</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewRole("user")}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      newRole === "user"
                        ? "bg-indigo-600/20 border-indigo-500 text-indigo-200"
                        : "bg-[#0c0e14] border-[#1e2330] text-slate-400 hover:text-white"
                    }`}
                  >
                    <div className="font-semibold text-white">User Biasa</div>
                    <p className="text-[10px] text-slate-400 mt-0.5">Transkripsi &amp; model AI sendiri</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewRole("superadmin")}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      newRole === "superadmin"
                        ? "bg-purple-600/20 border-purple-500 text-purple-200"
                        : "bg-[#0c0e14] border-[#1e2330] text-slate-400 hover:text-white"
                    }`}
                  >
                    <div className="font-semibold text-white">Superadmin</div>
                    <p className="text-[10px] text-slate-400 mt-0.5">Akses penuh semua modul</p>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e2330]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-[#0c0e14] hover:bg-[#1a1f2e] text-slate-300 rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl shadow-lg shadow-indigo-600/25 flex items-center gap-1.5"
                >
                  {createLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{createLoading ? "Menyimpan..." : "Simpan Akun"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {resetUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151821] border border-[#1e2330] rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl relative animate-fadeIn">
            <button
              onClick={() => setResetUser(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Reset Password Akun</h3>
                <p className="text-[11px] text-slate-400">
                  Reset password untuk <strong>{resetUser.username}</strong> tanpa perlu tahu password lama
                </p>
              </div>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Password Baru</label>
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="Min. 12 karakter"
                  className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-slate-200 outline-none focus:border-indigo-500/50"
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e2330]">
                <button
                  type="button"
                  onClick={() => setResetUser(null)}
                  className="px-4 py-2 bg-[#0c0e14] hover:bg-[#1a1f2e] text-slate-300 rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-xl shadow-lg shadow-amber-600/25 flex items-center gap-1.5"
                >
                  {resetLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                  <span>{resetLoading ? "Mereset..." : "Reset Password"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
