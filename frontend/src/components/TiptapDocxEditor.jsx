import React, { useState, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold, Italic, Underline as UnderlineIcon,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Heading1, Heading2, Heading3,
  Undo, Redo, Download, Share2, Save, Sparkles, Check, Copy,
  FileDown, FileText, Loader2, ExternalLink
} from "lucide-react";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import html2pdf from "html2pdf.js";

/**
 * Converts markdown text to clean HTML for Tiptap editor initialization
 */
function markdownToHtml(md) {
  if (!md) return "<p></p>";
  if (md.trim().startsWith("<") && md.trim().endsWith(">")) {
    return md; // Already HTML
  }

  let html = md
    // Escapes
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headings
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    // Bold & Italic
    .replace(/\*\*\*(.*?)\*\*\*/gim, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gim, "<em>$1</em>")
    // Blockquotes
    .replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>")
    // Unordered lists
    .replace(/^\s*-\s+(.*$)/gim, "<li>$1</li>")
    .replace(/^\s*\*\s+(.*$)/gim, "<li>$1</li>")
    // Numbered lists
    .replace(/^\s*\d+\.\s+(.*$)/gim, "<li>$1</li>")
    // Paragraphs
    .split(/\n{2,}/)
    .map((block) => {
      block = block.trim();
      if (!block) return "";
      if (
        block.startsWith("<h1>") ||
        block.startsWith("<h2>") ||
        block.startsWith("<h3>") ||
        block.startsWith("<blockquote>") ||
        block.startsWith("<li>")
      ) {
        if (block.startsWith("<li>")) {
          return `<ul>${block}</ul>`;
        }
        return block;
      }
      return `<p>${block.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html || "<p></p>";
}

/**
 * Exports editor content to DOCX format using docx library
 */
async function exportToDocx(editor, filename = "Minutes_of_Meeting") {
  if (!editor) return;
  const json = editor.getJSON();
  const children = [];

  const parseNode = (node) => {
    if (node.type === "heading") {
      const level = node.attrs?.level || 1;
      const text = node.content?.map((c) => c.text).join("") || "";
      const hLevel =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
      children.push(
        new Paragraph({
          text,
          heading: hLevel,
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (node.type === "paragraph") {
      const runs = (node.content || []).map((c) => {
        const isBold = c.marks?.some((m) => m.type === "bold");
        const isItalic = c.marks?.some((m) => m.type === "italic");
        const isUnderline = c.marks?.some((m) => m.type === "underline");
        return new TextRun({
          text: c.text || "",
          bold: isBold,
          italics: isItalic,
          underline: isUnderline ? {} : undefined,
        });
      });
      children.push(
        new Paragraph({
          children: runs.length > 0 ? runs : [new TextRun("")],
          spacing: { before: 80, after: 80 },
        })
      );
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      (node.content || []).forEach((item) => {
        (item.content || []).forEach((itemParagraph) => {
          const text = itemParagraph.content?.map((c) => c.text).join("") || "";
          children.push(
            new Paragraph({
              text,
              bullet: { level: 0 },
              spacing: { before: 40, after: 40 },
            })
          );
        });
      });
    }
  };

  (json.content || []).forEach(parseNode);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children:
          children.length > 0
            ? children
            : [new Paragraph({ text: editor.getText() || "Notulen Rapat" })],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const baseName = filename.replace(/\.[^/.]+$/, "");
  a.download = `${baseName}_MoM.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exports container to PDF using html2pdf.js
 */
function exportToPdf(elementId, filename = "Minutes_of_Meeting") {
  const element = document.getElementById(elementId);
  if (!element) return;
  const baseName = filename.replace(/\.[^/.]+$/, "");
  const opt = {
    margin: [12, 12, 12, 12],
    filename: `${baseName}_MoM.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  };
  html2pdf().set(opt).from(element).save();
}

export default function TiptapDocxEditor({
  content = "",
  filename = "Notulen_Rapat",
  itemId = null,
  shareSlug = null,
  isPublic = false,
  isReadOnly = false,
  apiBaseUrl = "http://localhost:8200",
  token = null,
  onSave = null,
  onParaphraseCustom = null,
  paraphrasing = false,
}) {
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [sharing, setSharing] = useState(false);
  const [currentShareSlug, setCurrentShareSlug] = useState(shareSlug);
  const [shareCopied, setShareCopied] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Placeholder.configure({
        placeholder: "Ketik atau sunting dokumen Minutes of Meeting (MoM) di sini...",
      }),
    ],
    content: markdownToHtml(content),
    editable: !isReadOnly,
  });

  // Keep editor content synced if content prop changes from outside (e.g. AI paraphrase)
  useEffect(() => {
    if (editor && content) {
      const currentHtml = editor.getHTML();
      const newHtml = markdownToHtml(content);
      if (currentHtml !== newHtml && !editor.isFocused) {
        editor.commands.setContent(newHtml);
      }
    }
  }, [content, editor]);

  // Handle Manual Save
  const handleSaveDocument = async () => {
    if (!editor) return;
    setSaving(true);
    setSaveSuccess(false);
    const htmlContent = editor.getHTML();

    if (onSave) {
      await onSave(htmlContent);
      setSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      return;
    }

    if (itemId && token) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/transcripts/${itemId}/mom`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content: htmlContent }),
        });
        if (res.ok) {
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 3000);
        }
      } catch (err) {
        console.error("Gagal menyimpan dokumen MoM:", err);
      } finally {
        setSaving(false);
      }
    }
  };

  // Handle Share Link Generation (Requirement 6: tanggal-menit-UUID)
  const handleShareClick = async () => {
    if (!itemId || !token) return;
    setSharing(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/transcripts/${itemId}/share`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_public: true }),
      });
      const data = await res.json();
      if (res.ok && data.shareSlug) {
        setCurrentShareSlug(data.shareSlug);
        const origin = window.location.origin;
        const publicUrl = `${origin}/share/${data.shareSlug}`;
        await navigator.clipboard.writeText(publicUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 4000);
      }
    } catch (err) {
      console.error("Gagal membuat link share:", err);
    } finally {
      setSharing(false);
    }
  };

  // Handle AI Custom Paraphrase
  const handleTriggerCustomParaphrase = (e) => {
    e.preventDefault();
    if (!customPrompt.trim() || !onParaphraseCustom) return;
    onParaphraseCustom(customPrompt.trim());
  };

  return (
    <div className="space-y-4">
      {/* Top Header Actions & Toolbar */}
      <div className="bg-[#151821] border border-[#1e2330] rounded-2xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#1e2330] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                Editor Dokumen MoM (DOCX Standard)
                {isReadOnly && (
                  <span className="text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded-full font-bold">
                    Pratinjau Publik (Hanya Baca)
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400">
                Penyuntingan rich-text interaktif berbasis Tiptap dengan opsi unduh DOCX &amp; PDF resmi.
              </p>
            </div>
          </div>

          {/* Action Buttons: Save, Download DOCX, Download PDF, Share */}
          <div className="flex flex-wrap items-center gap-2">
            {!isReadOnly && (
              <button
                type="button"
                onClick={handleSaveDocument}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-all shadow-sm cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : saveSuccess ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{saveSuccess ? "Tersimpan!" : "Simpan Dokumen"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => exportToDocx(editor, filename)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded-lg text-xs font-medium transition-all cursor-pointer"
              title="Unduh berkas .docx Microsoft Word"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Unduh .docx</span>
            </button>

            <button
              type="button"
              onClick={() => exportToPdf("tiptap-docx-page", filename)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 rounded-lg text-xs font-medium transition-all cursor-pointer"
              title="Unduh berkas PDF"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Unduh PDF</span>
            </button>

            {!isReadOnly && (
              <button
                type="button"
                onClick={handleShareClick}
                disabled={sharing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 rounded-lg text-xs font-medium transition-all cursor-pointer"
                title="Bagikan MoM ke publik tanpa login"
              >
                {sharing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : shareCopied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Share2 className="w-3.5 h-3.5" />
                )}
                <span>{shareCopied ? "Link Tersalin!" : "Share MoM"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Share Link Banner if active */}
        {currentShareSlug && (
          <div className="bg-[#0c0e14] border border-indigo-500/30 rounded-xl p-2.5 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 truncate">
              <Share2 className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-slate-400">Link Publik:</span>
              <span className="text-indigo-300 font-mono truncate">
                {window.location.origin}/share/{currentShareSlug}
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                const publicUrl = `${window.location.origin}/share/${currentShareSlug}`;
                await navigator.clipboard.writeText(publicUrl);
                setShareCopied(true);
                setTimeout(() => setShareCopied(false), 3000);
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-lg text-[11px] shrink-0 transition-all cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              <span>{shareCopied ? "Tersalin!" : "Salin Link"}</span>
            </button>
          </div>
        )}

        {/* AI Parafrase Custom Bar (Requirement 3: Parafrase otomatis oleh AI dengan custom input) */}
        {!isReadOnly && onParaphraseCustom && (
          <form
            onSubmit={handleTriggerCustomParaphrase}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-[#0c0e14] border border-[#1e2330] rounded-xl p-2"
          >
            <div className="flex items-center gap-2 px-2 text-indigo-400 shrink-0">
              <Sparkles className="w-4 h-4" />
              <span className="text-xs font-semibold text-slate-300">Parafrase AI:</span>
            </div>
            <input
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Contoh: 'Tulis ulang lebih formal dan fokuskan rincian pada PIC &amp; Action Items...'"
              className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 outline-none px-2 py-1"
            />
            <button
              type="submit"
              disabled={paraphrasing || !customPrompt.trim()}
              className="flex items-center justify-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-all shadow-sm cursor-pointer shrink-0"
            >
              {paraphrasing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Memproses...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Jalankan AI</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Formatting Toolbar (Only visible in edit mode) */}
        {!isReadOnly && editor && (
          <div className="flex flex-wrap items-center gap-1 bg-[#0c0e14] border border-[#1e2330] rounded-xl p-1.5 text-xs text-slate-300">
            {/* Headings */}
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive("heading", { level: 1 }) ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Heading 1"
            >
              <Heading1 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive("heading", { level: 2 }) ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Heading 2"
            >
              <Heading2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive("heading", { level: 3 }) ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Heading 3"
            >
              <Heading3 className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-[#1e2330] mx-1" />

            {/* Bold, Italic, Underline */}
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive("bold") ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Tebal (Ctrl+B)"
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive("italic") ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Miring (Ctrl+I)"
            >
              <Italic className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive("underline") ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Garis Bawah (Ctrl+U)"
            >
              <UnderlineIcon className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-[#1e2330] mx-1" />

            {/* Text Alignment */}
            <button
              type="button"
              onClick={() => editor.chain().focus().setTextAlign("left").run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive({ textAlign: "left" }) ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Rata Kiri"
            >
              <AlignLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().setTextAlign("center").run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive({ textAlign: "center" }) ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Rata Tengah"
            >
              <AlignCenter className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().setTextAlign("right").run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive({ textAlign: "right" }) ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Rata Kanan"
            >
              <AlignRight className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-[#1e2330] mx-1" />

            {/* Lists */}
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive("bulletList") ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Daftar Poin"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive("orderedList") ? "bg-indigo-600 text-white" : "hover:bg-[#1a1f2e] text-slate-400"}`}
              title="Daftar Nomor"
            >
              <ListOrdered className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-[#1e2330] mx-1" />

            {/* Undo / Redo */}
            <button
              type="button"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              className="p-1.5 rounded-lg hover:bg-[#1a1f2e] text-slate-400 disabled:opacity-30"
              title="Batal (Undo)"
            >
              <Undo className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              className="p-1.5 rounded-lg hover:bg-[#1a1f2e] text-slate-400 disabled:opacity-30"
              title="Ulangi (Redo)"
            >
              <Redo className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Realistic DOCX Page Sheet Canvas */}
      <div className="bg-[#0c0e14] border border-[#1e2330] rounded-2xl p-4 md:p-8 flex justify-center overflow-x-auto">
        <div
          id="tiptap-docx-page"
          className="w-full max-w-4xl bg-white text-slate-900 rounded-xl shadow-2xl p-8 md:p-14 min-h-[850px] font-sans text-sm leading-relaxed"
          style={{
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)",
          }}
        >
          {/* Document Header Letterhead */}
          <div className="border-b-2 border-slate-900 pb-4 mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                MINUTES OF MEETING (MoM)
              </h1>
              <p className="text-xs text-slate-600 font-medium mt-0.5">
                Resmeet STT Enterprise • Dokumen Catatan Resmi Rapat
              </p>
            </div>
            <div className="text-right text-[11px] text-slate-600 font-mono">
              <p>Berkas: {filename}</p>
              <p>{new Date().toLocaleDateString("id-ID", { dateStyle: "long" })}</p>
            </div>
          </div>

          {/* Tiptap Rich-Text Editor Content */}
          <div className="prose prose-slate max-w-none prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-h1:border-b prose-h1:pb-2 prose-p:my-2 prose-ul:my-2 prose-li:my-0.5">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  );
}
