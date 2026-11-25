import ProcessingSettings from "./ProcessingSettings";
import AiToggle from "./AiToggle";
import  { useState, useEffect, useCallback } from "react";
import {
  Brain, Plus, Trash2, CheckCircle2, Star,
  AlertCircle, RefreshCw, Sparkles, Layers, Save, Zap,
  Key, ShieldCheck, Server, Loader2
} from "lucide-react";

export default function UserAiModelsView({
  token,
  apiBaseUrl = "http://127.0.0.1:8200",
  setSelectedModelId,
  paraphraseStyle,
  setParaphraseStyle,
  aiConfigured,
  processing,
  onConfigChange,
  aiCorrection,
  setAiCorrection,
}) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Gateway form state
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [gatewaySaving, setGatewaySaving] = useState(false);
  const [gatewayTesting, setGatewayTesting] = useState(false);

  // Add model form state
  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [adding, setAdding] = useState(false);

  const updateModels = useCallback((nextModels) => {
    setModels(nextModels);
    onConfigChange?.();
    setSelectedModelId((current) =>
      nextModels.some((model) => model.model_id === current)
        ? current
        : nextModels.find((model) => model.is_default)?.model_id || nextModels[0]?.model_id || ""
    );
  }, [onConfigChange, setSelectedModelId]);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/user/ai-models`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memuat model AI akun.");
      updateModels(data.models || []);
    } catch (err) {
      setError(err.message || "Gagal memuat model.");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, token, updateModels]);

  const fetchGateway = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/ai/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setBaseUrl(data.baseUrl || "");
        setHasApiKey(Boolean(data.hasApiKey));
      }
    } catch (err) {
      console.warn("Gagal memuat konfigurasi gateway AI:", err);
    }
  }, [apiBaseUrl, token]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active && token) { fetchModels(); fetchGateway(); } });
    return () => { active = false; };
  }, [token, fetchModels, fetchGateway]);

  const saveGateway = async (event) => {
    event.preventDefault();
    setGatewaySaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/ai/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan gateway AI.");
      setHasApiKey(true);
      onConfigChange?.();
      setApiKey("");
      setSuccess("Koneksi Gateway AI berhasil disimpan dan dienkripsi.");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setGatewaySaving(false);
    }
  };

  const testGateway = async () => {
    setGatewayTesting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/ai/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || "Uji koneksi AI gagal.");
      }
      setSuccess(`Koneksi Gateway AI aktif & berhasil diuji untuk model '${data.modelId}'!`);
      setTimeout(() => setSuccess(""), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setGatewayTesting(false);
    }
  };

  const handleAddModel = async (e) => {
    e.preventDefault();
    if (!newModelId.trim()) return;

    setAdding(true);
    setError("");
    setSuccess("");
    try {
      const modelId = newModelId.trim();
      const modelName = newModelName.trim() || modelId;

      const updatedList = [
        ...models.map((m) => (isDefault ? { ...m, is_default: false } : m)),
        {
          model_id: modelId,
          model_name: modelName,
          is_default: isDefault || models.length === 0,
        },
      ];

      const res = await fetch(`${apiBaseUrl}/api/user/ai-models`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          models: updatedList,
          default_model_id: isDefault ? modelId : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menambahkan model AI.");

      setSuccess(`Model '${modelName}' berhasil didaftarkan untuk pemrosesan AI.`);
      setTimeout(() => setSuccess(""), 4000);
      setNewModelId("");
      setNewModelName("");
      setIsDefault(false);
      updateModels(data.models || []);
      if (isDefault || models.length === 0) setSelectedModelId(modelId);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleSetDefault = async (modelId) => {
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/user/ai-models/set-default`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ model_id: modelId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal mengubah model default.");

      setSuccess(`Model default berhasil diatur ke '${modelId}'.`);
      setTimeout(() => setSuccess(""), 3000);
      updateModels(data.models || []);
      setSelectedModelId(modelId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteModel = async (id, modelId) => {
    if (!window.confirm(`Hapus model '${modelId}' dari daftar?`)) return;
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/user/ai-models/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menghapus model.");

      setSuccess(`Model '${modelId}' berhasil dihapus.`);
      setTimeout(() => setSuccess(""), 3000);
      updateModels(data.models || []);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#171a25] via-[#141722] to-[#12151e] border border-[#1e2330] rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">
                Pengaturan
              </span>

            </div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Brain className="w-6 h-6 text-purple-400" />
              Pengaturan Transkripsi &amp; AI
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Atur perangkat pemrosesan transkripsi, hubungkan Gateway AI (OpenAI API compatible),
              memilih model untuk merapikan transkrip dan membuat ringkasan rapat.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              fetchModels();
              fetchGateway();
            }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#0c0e14] hover:bg-[#1a1f2e] border border-[#1e2330] text-slate-300 hover:text-white rounded-xl text-xs font-medium transition-all self-start md:self-auto cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      <ProcessingSettings token={token} apiBaseUrl={apiBaseUrl} processing={processing} />

      {/* Notifications */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs px-4 py-3 rounded-xl flex items-center gap-2 animate-in fade-in duration-200">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs px-4 py-3 rounded-xl flex items-center gap-2 animate-in fade-in duration-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{success}</span>
        </div>
      )}

      {/* UNIFIED SECTION: Gateway AI + Multi-Model AI (Requirement 11) */}
      <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-6 space-y-8">
        {/* PART 1: Gateway Connection & Credentials */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-[#1e2330] pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  1. Koneksi Gateway AI (LLM / API Provider)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Endpoint URL dan API Key terenkripsi (AES-256-GCM) untuk panggilan model AI.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                baseUrl && hasApiKey
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${baseUrl && hasApiKey ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                {baseUrl && hasApiKey ? "Gateway Terkonfigurasi" : "Belum Lengkap"}
              </span>
            </div>
          </div>

          <form onSubmit={saveGateway} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-indigo-400" />
                AI Base URL / Endpoint
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1 atau http://host.docker.internal:20128/v1"
                required
                className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500/50"
              />
              <p className="text-[10px] text-slate-500">
                Mendukung OpenAI, DeepSeek, vLLM, Ollama, LiteLLM, atau reverse proxy korporat.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                API Key
                {hasApiKey && (
                  <span className="text-[10px] text-emerald-400 font-normal">
                    (Tersimpan aman &amp; terenkripsi)
                  </span>
                )}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasApiKey ? "•••••••••••••••••••••••• (Ketik baru untuk mengubah)" : "sk-..."}
                className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500/50"
              />
              <p className="text-[10px] text-slate-500">
                Disimpan dengan kunci enkripsi AES-256 terisolasi per akun user.
              </p>
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Koneksi Gateway AI wajib aktif agar status sistem menjadi "Ready".</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={testGateway}
                  disabled={gatewayTesting || !baseUrl}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 rounded-xl text-xs font-medium transition-all cursor-pointer disabled:opacity-40"
                >
                  {gatewayTesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  <span>Uji Koneksi (Test Ping)</span>
                </button>

                <button
                  type="submit"
                  disabled={gatewaySaving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium transition-all shadow-md shadow-indigo-950/40 cursor-pointer disabled:opacity-50"
                >
                  {gatewaySaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Simpan Gateway AI</span>
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* PART 2: Multi-Model Array Registration */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between border-b border-[#1e2330] pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  2. Koleksi Multi-Model AI Terdaftar
                </h3>
                <p className="text-[11px] text-slate-400">
                  Daftar model LLM / Classifier yang dapat dipilih saat pembuatan notulen dan perapian dialog.
                </p>
              </div>
            </div>

            <span className="text-xs text-slate-400">
              Total Terdaftar: <strong className="text-white">{models.length} Model</strong>
            </span>
          </div>

          {/* Add New Model Form */}
          <form
            onSubmit={handleAddModel}
            className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-3.5 flex flex-col md:flex-row items-stretch md:items-center gap-3"
          >
            <div className="flex-1">
              <input
                type="text"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="ID Model (contoh: gpt-4o, gemini-2.0-flash, claude-3-5-sonnet)..."
                required
                className="w-full bg-[#151821] border border-[#1e2330] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500/50"
              />
            </div>

            <div className="flex-1">
              <input
                type="text"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="Label Display (Opsional, contoh: Gemini 2.0 Flash Enterprise)..."
                className="w-full bg-[#151821] border border-[#1e2330] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500/50"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0 select-none">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-[#1e2330] text-indigo-600 focus:ring-0 cursor-pointer"
              />
              <span>Set Utama</span>
            </label>

            <button
              type="submit"
              disabled={adding || !newModelId.trim()}
              className="flex items-center justify-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer"
            >
              {adding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Tambah Model</span>
            </button>
          </form>

          {/* Models Table */}
          <div className="overflow-x-auto rounded-xl border border-[#1e2330] bg-[#0c0e14]">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-[#12151e] text-slate-400 font-semibold uppercase text-[10px] tracking-wider border-b border-[#1e2330]">
                <tr>
                  <th className="px-4 py-3">Nama &amp; Label Model</th>
                  <th className="px-4 py-3">ID Model Gateway</th>
                  <th className="px-4 py-3">Status Default</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2330] text-slate-300">
                {models.map((m) => (
                  <tr key={m.id || m.model_id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-semibold text-white flex items-center gap-2">
                      <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span>{m.model_name || m.model_id}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-indigo-300 text-[11px]">
                      {m.model_id}
                    </td>
                    <td className="px-4 py-3">
                      {m.is_default ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <Star className="w-3 h-3 fill-amber-300" />
                          Model Utama
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Sekunder</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!m.is_default && (
                          <button
                            type="button"
                            onClick={() => handleSetDefault(m.model_id)}
                            className="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-[11px] font-medium transition-all cursor-pointer"
                          >
                            Jadikan Utama
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteModel(m.id, m.model_id)}
                          className="p-1.5 bg-[#151821] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-[#1e2330] rounded-lg transition-all cursor-pointer"
                          title="Hapus Model"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {models.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500 text-xs">
                      {loading ? "Memuat model..." : "Belum ada model AI yang didaftarkan."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* PART 3: AI Processing Options */}
        <div className="space-y-4 pt-2 border-t border-[#1e2330]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              3. Parameter Sintesis &amp; Gaya MoM
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 bg-[#0c0e14] border border-[#1e2330] rounded-xl p-3.5">
              <label className="text-xs font-semibold text-slate-300">
                Gaya Ringkasan MoM Bawaan
              </label>
              <select
                value={paraphraseStyle}
                onChange={(e) => setParaphraseStyle(e.target.value)}
                className="w-full bg-[#151821] border border-[#1e2330] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50 cursor-pointer"
              >
                <option value="poin_singkat">Poin-poin Penting &amp; Action Items</option>
                <option value="detail_deskriptif">Detail &amp; Lengkap (Bawaan)</option>
                <option value="ringkasan_eksekutif">Ringkasan Eksekutif Dewan Direksi</option>
              </select>
              <p className="text-[10px] text-slate-500 mt-1">
                Format struktur MoM juga dapat disesuaikan langsung di editor dokumen atau dengan input instruksi kustom.
              </p>
            </div>

            <AiToggle configured={aiConfigured} checked={aiCorrection} onChange={setAiCorrection} disabled={processing} />
          </div>
        </div>
      </div>
    </div>
  );
}
