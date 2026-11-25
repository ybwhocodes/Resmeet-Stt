import { useEffect, useMemo, useRef, useState } from "react";
import { DocxEditor } from "@docx-editor.dev/react";
import { packagedFonts } from "@docx-editor.dev/fonts";
import id from "@docx-editor.dev/i18n/id";
import { exportMarkdown } from "@docx-editor.dev/docx-to-markdown";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Save, Download, Share2, Loader2, Check, Printer, Sparkles } from "lucide-react";
import { createMeetingDocx } from "../meetingDocument";
import "@docx-editor.dev/core/styles/editor.css";

const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function MeetingDocxEditor({
  content = "", filename = "Notulen_Rapat", itemId = null, shareSlug = null, isPublic = false,
  publicDocumentUrl = null, isReadOnly = false, apiBaseUrl = "http://localhost:8200",
  token = null, momTitle = null, onTitleSaved = null, onSaved = null, onParaphraseCustom = null, paraphrasing = false, aiEnabled = false,
}) {
  const ref = useRef(null);
  const ready = useRef(false);
  const lastSaved = useRef(null);
  const revision = useRef(0);
  const activeKey = useRef(null);
  const [bytes, setBytes] = useState(null);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharedLink, setSharedLink] = useState(null);
  const [titleDraft, setTitleDraft] = useState(null);
  const [savingTitle, setSavingTitle] = useState(false);
  const [prompt, setPrompt] = useState("");
  const fonts = useMemo(() => packagedFonts(), []);
  const key = `${itemId || publicDocumentUrl || filename}`;
  const storedTitle = momTitle || filename.replace(/\.[^/.]+$/, "");
  const displayTitle = titleDraft?.key === key ? titleDraft.value : storedTitle;
  const titleDirty = displayTitle !== storedTitle;
  const baseName = displayTitle.trim().replace(/[\\/:*?"<>|]/g, "_") || "Notulen_Rapat";
  const slug = sharedLink?.key === key ? sharedLink.value : isPublic ? shareSlug : null;

  useEffect(() => {
    activeKey.current = key;
    return () => { activeKey.current = null; };
  }, [key]);

  useEffect(() => {
    if (lastSaved.current?.key === key && lastSaved.current?.content === content) return;
    const controller = new AbortController();
    ready.current = false;
    revision.current = 0;
    setBytes(null); setLoaded(false); setDirty(false); setError(""); setSaved(false);
    (async () => {
      const url = publicDocumentUrl || (itemId && token ? `${apiBaseUrl}/api/transcripts/${itemId}/document` : null);
      let source;
      if (url) {
        const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal });
        if (response.ok) source = new Uint8Array(await response.arrayBuffer());
        else if (response.status !== 404) throw new Error("Dokumen tersimpan belum dapat dimuat. Coba buka kembali agar perubahan sebelumnya tetap aman.");
      }
      source ||= await createMeetingDocx(content, filename);
      if (!controller.signal.aborted) setBytes(source);
    })().catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [key, content, filename, itemId, token, apiBaseUrl, publicDocumentUrl]);

  useEffect(() => {
    if (!dirty && !titleDirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, titleDirty]);

  const saveTitle = async () => {
    if (isReadOnly || !itemId || !token || savingTitle) return;
    const title = displayTitle.trim();
    if (!title || [...title].length > 200) { setError("Judul MoM wajib diisi, maksimal 200 karakter."); return false; }
    setSavingTitle(true); setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/transcripts/${itemId}/title`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gagal menyimpan judul MoM.");
      if (activeKey.current !== key) return false;
      await onTitleSaved?.(data.momTitle);
      setTitleDraft(null);
      return true;
    } catch (failure) { setError(failure.message); return false; }
    finally { setSavingTitle(false); }
  };
  const currentBytes = async () => {
    const buffer = await ref.current?.save();
    if (!buffer) throw new Error("Dokumen belum siap.");
    return new Uint8Array(buffer);
  };
  const download = async () => {
    try {
      setError("");
      const source = await currentBytes();
      const url = URL.createObjectURL(new Blob([source], { type: MIME }));
      const link = document.createElement("a"); link.href = url; link.download = `${baseName}.docx`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure.message); }
  };
  const save = async () => {
    if (saving || savingTitle || !itemId || !token || isReadOnly) return;
    if (titleDirty && !(await saveTitle())) return;
    setSaving(true); setError(""); setSaved(false);
    const savedRevision = revision.current;
    try {
      const source = await currentBytes();
      const { markdown } = await exportMarkdown(source);
      const form = new FormData();
      form.append("document", new Blob([source], { type: MIME }), `${baseName}.docx`);
      form.append("markdown", markdown);
      const response = await fetch(`${apiBaseUrl}/api/transcripts/${itemId}/document`, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Gagal menyimpan dokumen (${response.status}).`);
      }
      lastSaved.current = { key, content: markdown };
      if (activeKey.current !== key) return;
      const unchanged = revision.current === savedRevision;
      setDirty(!unchanged); setSaved(unchanged);
      await onSaved?.(markdown);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  const print = async () => {
    // Browser printing keeps PDF available without a commercial conversion service.
    const view = window.open("", "_blank");
    if (!view) { setError("Izinkan jendela cetak untuk mengekspor PDF."); return; }
    view.opener = null;
    try {
      const { markdown } = await exportMarkdown(await currentBytes());
      const html = DOMPurify.sanitize(marked.parse(markdown), { FORBID_TAGS: ["img", "iframe", "script", "style"] });
      view.document.write(`<!doctype html><html lang="id"><head><title>Notulen Rapat</title><style>@page{size:A4;margin:20mm}body{font:11pt/1.5 Arial,sans-serif;color:#172334}h1,h2,h3{break-after:avoid;color:#223b5a}table{border-collapse:collapse;width:100%;font-size:10pt}th,td{border:1px solid #ccd4de;padding:8px;text-align:left;vertical-align:top}th{background:#e8edf5}tr{break-inside:avoid}</style></head><body>${html}</body></html>`);
      view.document.close(); view.focus(); setTimeout(() => view.print(), 250);
    } catch (failure) { view.close(); setError(failure.message); }
  };
  const share = async () => {
    if (!itemId || !token || dirty || titleDirty) return;
    setSharing(true); setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/transcripts/${itemId}/share`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ is_public: true }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Gagal membagikan dokumen.");
      setSharedLink({ key, value: data.shareSlug });
      await navigator.clipboard.writeText(`${window.location.origin}/share/${data.shareSlug}`); setCopied(true);
    } catch (failure) { setError(failure.message); }
    finally { setSharing(false); }
  };
  const button = "flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-40";
  return <div className="space-y-3">
    <div className="rounded-xl border border-[#2a3140] bg-[#151821] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold text-white">{isReadOnly ? storedTitle : "Editor DOCX · Notulen Rapat"}</h3><p className="mt-1 text-xs text-slate-400">{isReadOnly ? "Dokumen publik hanya baca." : dirty ? "Ada perubahan yang belum disimpan." : saved ? "Dokumen dan format tersimpan." : "Sunting tata letak, paragraf, tabel, dan format dokumen."}</p></div>
        <div className="flex flex-wrap gap-2">
          {!isReadOnly && <button className={button} onClick={save} disabled={!loaded || saving || savingTitle || !itemId}>{saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}Simpan DOCX</button>}
          <button className={button} onClick={download} disabled={!loaded}><Download size={14} />Unduh DOCX</button>
          <button className={button} onClick={print} disabled={!loaded}><Printer size={14} />Cetak / PDF</button>
          {!isReadOnly && <button className={button} onClick={share} disabled={!loaded || dirty || titleDirty || sharing || savingTitle || !itemId}>{sharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}{copied ? "Link tersalin" : "Bagikan"}</button>}
        </div>
      </div>
      {!isReadOnly && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); saveTitle(); }}>
        <label className="min-w-48 flex-1 text-xs text-slate-300">Judul MoM
          <input value={displayTitle} maxLength={200} disabled={savingTitle || saving} onChange={(event) => setTitleDraft({ key, value: event.target.value })}
            placeholder="Contoh: Rapat Stock Opname September 2026" className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0c0e14] p-2 text-sm text-white focus:border-indigo-400 focus:outline-none" />
        </label>
        <button className={button} type="submit" disabled={!titleDirty || savingTitle || saving || !itemId}>{savingTitle ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Simpan Judul</button>
        <p className="w-full text-[11px] text-slate-400">{titleDirty ? "Judul belum disimpan." : "Judul tampil di riwayat, halaman publik, dan nama unduhan DOCX."}</p>
      </form>}
      {slug && <p className="break-all text-xs text-indigo-300">{window.location.origin}/share/{slug}</p>}
      {aiEnabled && !isReadOnly && onParaphraseCustom && <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); onParaphraseCustom(prompt.trim() || null); }}>
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Arahan tambahan untuk dokumen, misalnya: uraikan pembahasan per topik" className="min-w-48 flex-1 rounded-lg border border-slate-700 bg-[#0c0e14] p-2 text-xs text-white" />
        <button type="submit" className={button} disabled={!loaded || dirty || titleDirty || paraphrasing}><Sparkles size={14} />{paraphrasing ? "Menyusun dokumen..." : "Susun Ulang dengan AI"}</button>
        <p className="w-full text-[11px] text-slate-400">{dirty ? "Simpan perubahan terlebih dahulu sebelum menjalankan AI." : "AI menyusun ulang dokumen dari transkrip; fakta, angka, PIC, dan tenggat tetap mengikuti sumber."}</p>
      </form>}
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</p>}
    {!bytes && !error && <p role="status" className="p-8 text-center text-slate-400">Menyiapkan dokumen...</p>}
    {bytes && <div style={{ height: "78vh", minHeight: 640, colorScheme: "light" }} className="overflow-hidden rounded-xl border border-slate-600 bg-slate-200">
      <DocxEditor ref={ref} document={bytes} mode={isReadOnly ? "view" : "edit"} title={`${baseName}.docx`}
        fonts={fonts} i18n={id} locale="id-ID" colorMode="light"
        onReady={() => { ready.current = true; setLoaded(true); setDirty(false); }}
        onChange={() => { if (ready.current && !isReadOnly) { revision.current += 1; setDirty(true); setSaved(false); } }}
        onSave={isReadOnly ? download : save}
        menu={{ reportIssue: false, exporters: { markdown: (source) => exportMarkdown(source) }, children: <DocxEditor.Menu.File><DocxEditor.Menu.ExportPdf hidden /><DocxEditor.Menu.Print hidden /></DocxEditor.Menu.File> }}
      />
    </div>}
  </div>;
}
