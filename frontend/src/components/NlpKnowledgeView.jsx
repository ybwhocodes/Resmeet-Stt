import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BookOpen, Plus, Trash2, Edit3, CheckCircle2, AlertCircle,
  Search, Sparkles, RefreshCw, Loader2, ArrowRight, Globe, User, Power
} from "lucide-react";

const CATEGORIES = [
  "Nama / PIC",
  "Istilah Teknis",
  "Singkatan / Akronim",
  "Nama Proyek / Produk",
  "Konteks Organisasi",
  "Lainnya",
];

const EMPTY_FORM = {
  category: "Nama / PIC",
  title: "",
  aliases: "",
  content: "",
  source: "",
  isActive: true,
  isGlobal: false,
};

export default function NlpKnowledgeView({
  token,
  user,
  apiBaseUrl = "",
  history = [],
  onOpenTranscript,
}) {
  const isSuperadmin = user?.role === "superadmin";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("semua");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // NLP / RAG Live Analyzer state
  const [sampleText, setSampleText] = useState(
    "Laporan dari Pak Sammut dan Pak Samsul terkait stok gudang perlu dikonfirmasi bersama tim operasional."
  );
  const [selectedTranscriptId, setSelectedTranscriptId] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  const fetchItems = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/knowledge`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memuat basis Knowledge NLP.");
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || "Gagal memuat basis Knowledge NLP.");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, token]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active && token) fetchItems();
    });
    return () => {
      active = false;
    };
  }, [token, fetchItems]);

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Istilah baku / target perbaikan wajib diisi.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const endpoint = editingId
        ? `${apiBaseUrl}/api/knowledge/${editingId}`
        : `${apiBaseUrl}/api/knowledge`;
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: form.category.trim() || "Nama / PIC",
          title: form.title.trim(),
          aliases: form.aliases.trim(),
          content: form.content.trim(),
          source: form.source.trim() || null,
          isActive: form.isActive,
          isGlobal: isSuperadmin ? form.isGlobal : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan data knowledge.");
      setSuccess(data.message || "Knowledge NLP berhasil disimpan.");
      resetForm();
      await fetchItems();
      setTimeout(() => setSuccess(""), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setForm({
      category: item.category || "Nama / PIC",
      title: item.title || "",
      aliases: item.aliases || "",
      content: item.content || "",
      source: item.source || "",
      isActive: item.isActive !== false,
      isGlobal: item.userId == null,
    });
    setError("");
  };

  const handleToggleActive = async (item) => {
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/knowledge/${item.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: item.category,
          title: item.title,
          aliases: item.aliases || "",
          content: item.content || "",
          source: item.source || null,
          isActive: !item.isActive,
          isGlobal: item.userId == null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memperbarui status entri.");
      setItems((prev) => prev.map((entry) => (entry.id === item.id ? data.item : entry)));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Hapus entri knowledge "${item.title}"?`)) return;
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/knowledge/${item.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menghapus knowledge.");
      if (editingId === item.id) resetForm();
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      setSuccess(data.message || "Knowledge berhasil dihapus.");
      setTimeout(() => setSuccess(""), 3500);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAnalyze = async (overrideTranscriptId = null) => {
    setAnalyzing(true);
    setError("");
    try {
      const tid = overrideTranscriptId ?? (selectedTranscriptId || null);
      const body = tid && !overrideTranscriptId ? { text: sampleText } : tid ? { transcriptId: tid } : { text: sampleText };
      const res = await fetch(`${apiBaseUrl}/api/knowledge/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analisis NLP gagal dijalankan.");
      setAnalysis(data.analysis);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePickTranscript = (id) => {
    setSelectedTranscriptId(id);
    const chosen = history.find((item) => item.id === id);
    if (chosen?.final_text) {
      setSampleText(chosen.final_text);
      setAnalysis(null);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (categoryFilter !== "semua" && item.category !== categoryFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.aliases || "").toLowerCase().includes(q) ||
        (item.content || "").toLowerCase().includes(q) ||
        (item.source || "").toLowerCase().includes(q)
      );
    });
  }, [items, categoryFilter, search]);

  const activeCount = useMemo(() => items.filter((i) => i.isActive).length, [items]);

  const canModify = (item) => isSuperadmin || item.userId === user?.id;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-[#161a26] to-[#11141d] border border-[#1e2330] rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Knowledge NLP &amp; RAG untuk Parafrase AI</h2>
                <p className="text-xs text-slate-400">
                  Basis acuan istilah baku, koreksi salah dengar STT (misal <code className="text-purple-300">Pak Sammut / Pak Samsul</code> → <code className="text-emerald-300">Pak Samsut</code>), dan konteks RAG saat AI menyusun notulen MoM.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-semibold">
              {activeCount} Knowledge Aktif
            </span>
            <button
              type="button"
              onClick={fetchItems}
              className="p-2 rounded-xl bg-[#0c0e14] border border-[#1e2330] text-slate-400 hover:text-white cursor-pointer"
              title="Muat ulang daftar Knowledge"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-200 px-4 py-3 rounded-xl text-xs">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 px-4 py-3 rounded-xl text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Form Tambah / Edit Knowledge */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-5 bg-[#151821] border border-[#1e2330] rounded-2xl p-5 space-y-4 shadow-xl h-fit"
        >
          <div className="flex items-center justify-between border-b border-[#1e2330] pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              {editingId ? <Edit3 className="w-4 h-4 text-amber-400" /> : <Plus className="w-4 h-4 text-indigo-400" />}
              <span>{editingId ? "Ubah Entri Knowledge" : "Tambah Knowledge / Koreksi NLP"}</span>
            </h3>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
              >
                Batal Edit
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Kategori</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Istilah Baku / Target Perbaikan <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Contoh: Pak Samsut"
                maxLength={255}
                className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Variasi Salah Dengar / Alias STT (pisahkan dengan koma)
              </label>
              <input
                type="text"
                value={form.aliases}
                onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))}
                placeholder="Contoh: Pak Sammut, Pak Samsul, Pak Samut"
                className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Jika transkrip memuat alias ini atau kata mirip, NLP memberi saran perbaikan ke istilah baku sebelum &amp; saat AI memparafrase.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Konteks / Arahan RAG untuk AI
              </label>
              <textarea
                rows={3}
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="Contoh: Kepala Gudang Pusat. Selalu gunakan ejaan Pak Samsut pada daftar peserta, pembahasan, dan PIC tindak lanjut."
                className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Sumber / Referensi (Opsional)</label>
              <input
                type="text"
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                placeholder="Contoh: Struktur Organisasi Divisi Operasional"
                maxLength={255}
                className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="rounded border-slate-600 bg-[#0c0e14] text-indigo-500"
                />
                <span>Aktif dipakai AI &amp; NLP</span>
              </label>

              {isSuperadmin && (
                <label className="flex items-center gap-2 text-xs text-purple-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isGlobal}
                    onChange={(e) => setForm((f) => ({ ...f, isGlobal: e.target.checked }))}
                    className="rounded border-slate-600 bg-[#0c0e14] text-purple-500"
                  />
                  <span>Knowledge Global (Semua User)</span>
                </label>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/40 disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>{editingId ? "Simpan Perubahan Knowledge" : "Simpan ke Tabel Knowledge"}</span>
          </button>
        </form>

        {/* Daftar Knowledge */}
        <div className="lg:col-span-7 bg-[#151821] border border-[#1e2330] rounded-2xl p-5 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-white">Daftar Knowledge &amp; Pemetaan Istilah ({filteredItems.length})</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-[#0c0e14] border border-[#1e2330] rounded-xl px-2.5 py-1.5 text-xs text-slate-200 outline-none"
              >
                <option value="semua">Semua Kategori</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari istilah / alias..."
                  className="bg-[#0c0e14] border border-[#1e2330] rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500 w-44"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
            {loading && (
              <div className="py-10 text-center text-xs text-slate-400">Memuat basis knowledge...</div>
            )}
            {!loading && filteredItems.length === 0 && (
              <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-[#1e2330] rounded-xl">
                Belum ada entri knowledge pada filter ini. Tambahkan nama PIC, istilah proyek, atau singkatan perusahaan untuk memandu AI.
              </div>
            )}

            {filteredItems.map((item) => {
              const aliases = (item.aliases || "")
                .split(/[,;\n|]/)
                .map((s) => s.trim())
                .filter(Boolean);
              const editable = canModify(item);
              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-4 space-y-2 transition-all ${
                    item.isActive
                      ? "bg-[#0c0e14] border-[#1e2330]"
                      : "bg-[#0c0e14]/50 border-[#1e2330]/60 opacity-65"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">{item.title}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                          {item.category}
                        </span>
                        {item.userId == null ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                            <Globe className="w-2.5 h-2.5" /> Global
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            <User className="w-2.5 h-2.5" /> Pribadi
                          </span>
                        )}
                      </div>

                      {aliases.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] pt-1">
                          <span className="text-slate-500">Koreksi STT:</span>
                          {aliases.map((al) => (
                            <span
                              key={al}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-300"
                            >
                              {al}
                            </span>
                          ))}
                          <ArrowRight className="w-3 h-3 text-slate-500" />
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-semibold">
                            {item.title}
                          </span>
                        </div>
                      )}
                    </div>

                    {editable && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(item)}
                          className={`p-1.5 rounded-lg border text-xs cursor-pointer ${
                            item.isActive
                              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25"
                              : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white"
                          }`}
                          title={item.isActive ? "Nonaktifkan entri" : "Aktifkan entri"}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEdit(item)}
                          className="p-1.5 rounded-lg bg-[#151821] border border-[#1e2330] text-slate-300 hover:text-indigo-300 cursor-pointer"
                          title="Edit entri"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          className="p-1.5 rounded-lg bg-[#151821] border border-[#1e2330] text-slate-400 hover:text-rose-400 cursor-pointer"
                          title="Hapus entri"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {item.content && (
                    <p className="text-xs text-slate-300 leading-relaxed">{item.content}</p>
                  )}
                  {item.source && (
                    <p className="text-[11px] text-slate-500">Sumber: {item.source}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live NLP & RAG Recommendation Analyzer */}
      <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1e2330] pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>Uji Rekomendasi NLP &amp; Pratinjau Konteks RAG</span>
            </h3>
            <p className="text-xs text-slate-400">
              Tempel teks transkrip atau pilih dari Riwayat untuk melihat saran koreksi kata dan konteks RAG yang otomatis dikirim ke AI saat menyusun MoM.
            </p>
          </div>

          {history.length > 0 && (
            <select
              value={selectedTranscriptId}
              onChange={(e) => handlePickTranscript(e.target.value)}
              className="bg-[#0c0e14] border border-[#1e2330] rounded-xl px-3 py-1.5 text-xs text-slate-200 max-w-xs outline-none"
            >
              <option value="">-- Muat teks dari Riwayat Transkrip --</option>
              {history.slice(0, 20).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.mom_title || item.filename}
                </option>
              ))}
            </select>
          )}
        </div>

        <textarea
          rows={4}
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          placeholder="Tempel cuplikan transkrip rapat untuk memeriksa rekomendasi NLP..."
          className="w-full bg-[#0c0e14] border border-[#1e2330] rounded-xl p-3 text-xs text-slate-100 outline-none focus:border-purple-500"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => handleAnalyze(null)}
            disabled={analyzing || !sampleText.trim()}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>Analisis Saran Perbaikan NLP</span>
          </button>

          {selectedTranscriptId && onOpenTranscript && (
            <button
              type="button"
              onClick={() => {
                const chosen = history.find((item) => item.id === selectedTranscriptId);
                if (chosen) onOpenTranscript(chosen);
              }}
              className="px-3.5 py-2 rounded-xl bg-[#0c0e14] border border-[#1e2330] text-indigo-300 hover:text-white text-xs font-medium cursor-pointer"
            >
              Buka Dokumen MoM Ini untuk Parafrase AI
            </button>
          )}
        </div>

        {analysis && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
            <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 space-y-2.5">
              <h4 className="text-xs font-bold text-slate-200">
                Rekomendasi Perbaikan &amp; Konteks Terdeteksi ({analysis.suggestions.length})
              </h4>
              {analysis.suggestions.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Belum ada kecocokan langsung pada teks ini. {analysis.glossaryCount} entri glosarium aktif tetap disertakan sebagai referensi RAG saat AI bekerja.
                </p>
              ) : (
                <div className="space-y-2">
                  {analysis.suggestions.map((s, idx) => (
                    <div key={`${s.knowledgeId}-${idx}`} className="p-2.5 rounded-lg bg-[#151821] border border-[#1e2330] text-xs space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-amber-300 font-medium">&ldquo;{s.matchedText}&rdquo;</span>
                          <ArrowRight className="w-3 h-3 text-slate-500" />
                          <span className="text-emerald-300 font-bold">&ldquo;{s.canonicalTerm}&rdquo;</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">
                          {s.matchType === "alias_eksak"
                            ? "Alias Eksak"
                            : s.matchType === "kemiripan_nlp"
                              ? `Kemiripan ${Math.round(s.confidence * 100)}%`
                              : "Konteks Terdeteksi"}
                          {" · "}
                          {s.occurrences}x
                        </span>
                      </div>
                      {s.context && <p className="text-[11px] text-slate-400">{s.context}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-4 space-y-2.5">
              <h4 className="text-xs font-bold text-slate-200">Pratinjau Teks Setelah Koreksi Alias &amp; Prompt RAG</h4>
              <p className="text-xs text-emerald-200/90 bg-[#151821] border border-[#1e2330] rounded-lg p-3 leading-relaxed">
                {analysis.previewText}
              </p>
              {analysis.ragContextPrompt && (
                <pre className="text-[11px] text-slate-400 bg-[#151821] border border-[#1e2330] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48">
                  {analysis.ragContextPrompt}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
