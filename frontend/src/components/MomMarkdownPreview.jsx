import  { useState } from "react";
import {
   Copy, Check, Download, Eye, Code, CheckCircle2, Edit3,
  Save, RotateCcw, X, AlertCircle, RefreshCw
} from "lucide-react";

/**
 * Parses markdown tables into structured headers and rows.
 */
function parseMarkdownTable(tableBlock) {
  const lines = tableBlock.trim().split("\n").map(l => l.trim()).filter(l => l.startsWith("|") && l.endsWith("|"));
  if (lines.length < 2) return null;

  const parseRow = (line) => line.slice(1, -1).split("|").map(c => c.trim());
  const headers = parseRow(lines[0]);
  
  // Skip separator line if present (e.g. |---|---|)
  const startIndex = lines[1].replace(/[\s|:-]/g, "").length === 0 ? 2 : 1;
  const rows = lines.slice(startIndex).map(parseRow);

  return { headers, rows };
}

/**
 * Enhanced Minutes of Meeting (MoM) Viewer with Editing & Real-time Persistence:
 * 1. Formatted Executive Document View (Stylized tables, section badges, clean cards)
 * 2. Raw Source Markdown View (Pure standard .md with 1-click clipboard copy)
 * 3. Interactive Edit Mode with live updates to Database
 */
export default function MomMarkdownPreview({
  markdown = "",
  onCopy,
  onDownloadMd,
  onDownloadTxt,
  copied = false,
  onSave = null,
}) {
  const [viewMode, setViewMode] = useState("formatted"); // "formatted" | "raw" | "edit"
  const [editTab, setEditTab] = useState("editor"); // "editor" | "preview"
  const [content, setContent] = useState(markdown || "");
  const [initialContent, setInitialContent] = useState(markdown || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Synchronize incoming content during render without resetting an active draft.
  const [sourceMarkdown, setSourceMarkdown] = useState(markdown);
  if (sourceMarkdown !== markdown && viewMode !== "edit") {
    setSourceMarkdown(markdown);
    setContent(markdown || "");
    setInitialContent(markdown || "");
  }

  const handleStartEdit = () => {
    setInitialContent(content);
    setSaveError(null);
    setSaveSuccess(false);
    setViewMode("edit");
    setEditTab("editor");
  };

  const handleCancelEdit = () => {
    setContent(initialContent);
    setSaveError(null);
    setSaveSuccess(false);
    setViewMode("formatted");
  };

  const handleResetEdit = () => {
    setContent(initialContent);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!content.trim()) {
      setSaveError("Konten dokumen tidak boleh kosong.");
      return;
    }

    if (!onSave) {
      setSaveError("Fungsi penyimpanan belum dikonfigurasi.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(content.trim());
      setSaveSuccess(true);
      setInitialContent(content.trim());
      setTimeout(() => {
        setSaveSuccess(false);
        setViewMode("formatted");
      }, 1200);
    } catch (err) {
      setSaveError(err?.message || "Gagal menyimpan perubahan ke database.");
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut Ctrl+S / Cmd+S in edit mode
  const handleEditorKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const lineCount = content ? content.split("\n").length : 0;

  // Simple, robust parser for the 7 official MoM sections
  const renderFormattedMom = (textToRender = content) => {
    if (!textToRender || !textToRender.trim()) {
      return (
        <div className="py-12 text-center text-slate-500 text-xs">
          Belum ada konten notulen rapat yang tersedia.
        </div>
      );
    }

    // Split markdown by major ## headers
    const rawSections = textToRender.split(/^## /m);
    const mainTitle = rawSections[0].replace(/^#\s*/, "").trim() || "MINUTES OF MEETING (MoM)";
    const sections = rawSections.slice(1);

    return (
      <div className="space-y-6 text-slate-200">
        {/* Main Document Header Banner */}
        <div className="bg-gradient-to-r from-indigo-950/40 via-[#121622] to-slate-900 border border-indigo-500/20 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Dokumen Resmi Minutes of Meeting
                </span>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Standar Format Valid
                </span>
              </div>
              <h1 className="text-lg md:text-xl font-bold text-white tracking-tight pt-1">
                {mainTitle}
              </h1>
              <p className="text-xs text-slate-400">
                Disusun dan distandarisasi secara resmi oleh Resmeet AI Executive Secretary
              </p>
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              {onSave && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="Edit isi dokumen MoM ini"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Dokumen</span>
                </button>
              )}
              <button
                type="button"
                onClick={onCopy}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5 cursor-pointer"
                title="Salin isi dokumen berformat .md murni"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Tersalin!" : "Salin .MD"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Render Each Section */}
        {sections.map((section, idx) => {
          const lines = section.trim().split("\n");
          const sectionTitle = lines[0]?.trim();
          const sectionBody = lines.slice(1).join("\n").trim();

          // Check for markdown table inside section body
          const tableMatch = sectionBody.match(/\|[^\n]+\|\n\|[^\n]+\|\n([\s\S]*?)(?=\n\n|$)/);
          const parsedTable = tableMatch ? parseMarkdownTable(tableMatch[0]) : null;

          return (
            <div
              key={idx}
              className="bg-[#0e111a] border border-[#1e2330] rounded-xl p-5 space-y-3.5 transition-all hover:border-slate-700/60"
            >
              <div className="flex items-center gap-2 pb-2.5 border-b border-[#1e2330]">
                <div className="w-2 h-2 rounded-full bg-indigo-400" />
                <h2 className="text-sm font-bold text-slate-100 tracking-wide">
                  {sectionTitle}
                </h2>
              </div>

              {/* Render Table if Present */}
              {parsedTable && (
                <div className="overflow-x-auto rounded-lg border border-[#1e2330] bg-[#090b10]">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-[#151924] text-slate-300 font-semibold uppercase text-[11px] tracking-wider border-b border-[#1e2330]">
                      <tr>
                        {parsedTable.headers.map((h, hIdx) => (
                          <th key={hIdx} className="px-4 py-2.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2330] text-slate-300">
                      {parsedTable.rows.map((row, rIdx) => (
                        <tr
                          key={rIdx}
                          className="hover:bg-indigo-500/5 transition-colors"
                        >
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-4 py-2.5 font-sans leading-relaxed">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Render Section Text / Paragraphs */}
              <div className="space-y-2.5">
                {sectionBody.split("\n\n").map((para, pIdx) => {
                  const trimmed = para.trim();
                  if (!trimmed || (parsedTable && trimmed.startsWith("|"))) {
                    return null;
                  }

                  // Subheadings (e.g. ### 4.1. Topik)
                  if (trimmed.startsWith("### ")) {
                    return (
                      <h3
                        key={pIdx}
                        className="text-xs font-bold text-indigo-300 pt-2 pb-1 flex items-center gap-1.5"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        {trimmed.replace(/^###\s*/, "")}
                      </h3>
                    );
                  }

                  // Bullet Points (- or *)
                  if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                    const items = trimmed.split(/\n(?=[-*]\s+)/);
                    return (
                      <ul key={pIdx} className="space-y-1.5 pl-2">
                        {items.map((item, iIdx) => {
                          const cleanItem = item.replace(/^[-*]\s+/, "");
                          const isBoldPrefix = cleanItem.startsWith("**");
                          return (
                            <li
                              key={iIdx}
                              className="text-xs text-slate-300 flex items-start gap-2 leading-relaxed"
                            >
                              <span className="text-indigo-400 mt-1 min-w-1.5">•</span>
                              <span className="flex-1">
                                {isBoldPrefix ? (
                                  <>
                                    <strong className="text-slate-100 font-semibold">
                                      {cleanItem.split("**")[1]}
                                    </strong>
                                    {cleanItem.slice(cleanItem.indexOf("**", 2) + 2)}
                                  </>
                                ) : (
                                  cleanItem
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  }

                  // Numbered Lists (1. 2. 3.)
                  if (/^\d+\.\s+/.test(trimmed)) {
                    const items = trimmed.split(/\n(?=\d+\.\s+)/);
                    return (
                      <ol key={pIdx} className="space-y-1.5 pl-2">
                        {items.map((item, iIdx) => (
                          <li key={iIdx} className="flex items-start gap-2 text-slate-300">
                            <span className="text-indigo-400 font-semibold font-mono text-[11px] min-w-4">
                              {iIdx + 1}.
                            </span>
                            <span className="flex-1">{item.replace(/^\d+\.\s*/, "")}</span>
                          </li>
                        ))}
                      </ol>
                    );
                  }

                  // Standard Paragraph
                  return (
                    <p key={pIdx} className="text-slate-300 leading-relaxed text-xs">
                      {trimmed}
                    </p>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-4">
      {/* Top Toolbar: Dual View Mode & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0c0e14] border border-[#1e2330] rounded-xl px-4 py-2.5 text-xs text-slate-400">
        <div>
          <span className="font-semibold text-slate-200 block">
            Dokumen Resmi Minutes of Meeting (MoM) Standar Markdown
          </span>
          <span className="text-[11px] text-slate-400">
            {viewMode === "edit"
              ? "Mode Edit Aktif: Sesuaikan notulen rapat langsung, simpan, dan update otomatis ke database."
              : "Standar resmi 7 bagian: Informasi Rapat, Agenda, Ringkasan, Topik Terarah, Keputusan, Tindak Lanjut, & Catatan."}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {viewMode !== "edit" ? (
            <>
              {/* View Mode Toggle: Formatted vs Raw */}
              <div className="flex items-center bg-[#151821] border border-[#1e2330] rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("formatted")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
                    viewMode === "formatted"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title="Tampilkan dokumen notulen terformat rapi"
                >
                  <Eye className="w-3 h-3" />
                  <span>Preview Rapi</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("raw")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
                    viewMode === "raw"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title="Tampilkan kode mentah markdown (.md)"
                >
                  <Code className="w-3 h-3" />
                  <span>Kode .MD</span>
                </button>
              </div>

              {/* Edit Button */}
              {onSave && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="px-2.5 py-1 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 rounded-lg flex items-center gap-1 font-medium cursor-pointer transition-all"
                  title="Edit dokumen MoM ini"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit MoM</span>
                </button>
              )}

              {/* Salin Button */}
              <button
                type="button"
                onClick={onCopy}
                className="px-2.5 py-1 bg-[#151821] hover:bg-slate-800 border border-[#1e2330] text-slate-300 rounded-lg flex items-center gap-1 font-medium cursor-pointer"
                title="Salin dokumen format .md murni ke clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Tersalin!" : "Salin .MD"}</span>
              </button>

              {onDownloadTxt && (
                <button
                  type="button"
                  onClick={onDownloadTxt}
                  className="px-2.5 py-1 bg-[#151821] hover:bg-slate-800 border border-[#1e2330] text-slate-300 rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> .txt
                </button>
              )}
              {onDownloadMd && (
                <button
                  type="button"
                  onClick={onDownloadMd}
                  className="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 rounded-lg flex items-center gap-1 font-medium cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Unduh .md
                </button>
              )}
            </>
          ) : (
            /* Edit Mode Action Buttons */
            <>
              <div className="flex items-center bg-[#151821] border border-[#1e2330] rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setEditTab("editor")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
                    editTab === "editor"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Code className="w-3 h-3" />
                  <span>Editor .MD</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditTab("preview")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
                    editTab === "preview"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>Pratinjau Hasil</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleResetEdit}
                className="px-2.5 py-1 bg-[#151821] hover:bg-slate-800 border border-[#1e2330] text-slate-300 rounded-lg flex items-center gap-1 font-medium cursor-pointer transition-all"
                title="Reset kembali ke sebelum diedit"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>

              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-2.5 py-1 bg-[#151821] hover:bg-slate-800 border border-[#1e2330] text-rose-300 rounded-lg flex items-center gap-1 font-medium cursor-pointer transition-all"
              >
                <X className="w-3.5 h-3.5" />
                <span>Batal</span>
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-3.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 font-medium cursor-pointer shadow-md shadow-emerald-600/20 transition-all"
              >
                {isSaving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : saveSuccess ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{isSaving ? "Menyimpan..." : saveSuccess ? "Tersimpan!" : "Simpan Perubahan"}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Save Success / Error Alerts */}
      {saveSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>Perubahan dokumen MoM berhasil disimpan dan disinkronkan ke database!</span>
        </div>
      )}
      {saveError && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Content View Switcher */}
      {viewMode === "formatted" && renderFormattedMom(content)}

      {viewMode === "raw" && (
        <div className="bg-[#0c0e14] border border-[#1e2330] rounded-xl p-6 relative">
          <div className="absolute right-4 top-4 text-[10px] font-mono text-slate-500 bg-[#151821] px-2 py-0.5 rounded border border-[#1e2330]">
            Markdown Standar
          </div>
          <p
            style={{ fontFamily: "'DM Mono', monospace" }}
            className="text-slate-200 text-xs leading-relaxed whitespace-pre-wrap selection:bg-indigo-500/30"
          >
            {content}
          </p>
        </div>
      )}

      {viewMode === "edit" && (
        <div className="space-y-3">
          {/* Editor Header Stats & Quick Tip */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-400 font-mono">
            <div className="flex items-center gap-3">
              <span>{lineCount} baris</span>
              <span>•</span>
              <span>{wordCount} kata</span>
              <span>•</span>
              <span>{content.length} karakter</span>
            </div>
            <div className="text-slate-500">
              Tips: Gunakan <kbd className="px-1.5 py-0.5 bg-[#151821] border border-[#1e2330] rounded text-slate-300 text-[10px]">Cmd+S</kbd> / <kbd className="px-1.5 py-0.5 bg-[#151821] border border-[#1e2330] rounded text-slate-300 text-[10px]">Ctrl+S</kbd> untuk menyimpan langsung.
            </div>
          </div>

          {editTab === "editor" ? (
            <div className="relative rounded-xl border border-[#1e2330] focus-within:border-indigo-500/60 transition-all bg-[#090b10] overflow-hidden">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                rows={24}
                className="w-full bg-transparent p-5 text-slate-200 text-xs leading-relaxed font-mono outline-none resize-y selection:bg-indigo-500/30"
                placeholder="Tuliskan atau sesuaikan dokumen Minutes of Meeting (MoM) di sini..."
                autoFocus
              />
            </div>
          ) : (
            <div className="rounded-xl border border-[#1e2330] p-4 bg-[#090b10]">
              <div className="text-[11px] font-semibold text-slate-400 mb-3 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-indigo-400" />
                <span>Pratinjau Hasil Edit Dokumen</span>
              </div>
              {renderFormattedMom(content)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
