import React, { useEffect, useRef, useState } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { ZoomIn, ZoomOut, Maximize2, Download, Copy, Check, Sun, Moon } from "lucide-react";

const transformer = new Transformer();

const DARK_COLORS = ["#818cf8", "#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#a78bfa"];
const LIGHT_COLORS = ["#4338ca", "#0284c7", "#059669", "#d946ef", "#d97706", "#7c3aed"];

export default function MarkmapView({ markdown, title = "Mindmap Rapat" }) {
  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const [copied, setCopied] = useState(false);
  // Default mode: dark
  const [theme, setTheme] = useState("dark");

  // Clean or convert markdown for optimal markmap visualization
  const getMindmapMarkdown = () => {
    if (!markdown) return "# Tidak ada data diskusi";
    // If text doesn't start with a heading, add one
    let text = markdown.trim();
    if (!text.startsWith("#")) {
      text = `# ${title}\n` + text;
    }
    return text;
  };

  useEffect(() => {
    if (!svgRef.current) return;
    const cleanMd = getMindmapMarkdown();
    const colors = theme === "dark" ? DARK_COLORS : LIGHT_COLORS;

    try {
      const { root } = transformer.transform(cleanMd);
      if (markmapRef.current) {
        try {
          if (typeof markmapRef.current.destroy === "function") {
            markmapRef.current.destroy();
          }
        } catch {}
        if (svgRef.current) svgRef.current.innerHTML = "";
      }

      markmapRef.current = Markmap.create(
        svgRef.current,
        {
          duration: 250,
          color: (node) => colors[(node.depth || 0) % colors.length],
          paddingX: 16,
          autoFit: true,
        },
        root
      );
    } catch (err) {
      console.warn("[Markmap] Error creating mindmap:", err);
    }
  }, [markdown, title, theme]);

  const handleZoomIn = () => {
    if (markmapRef.current) {
      markmapRef.current.rescale(1.25);
    }
  };

  const handleZoomOut = () => {
    if (markmapRef.current) {
      markmapRef.current.rescale(0.8);
    }
  };

  const handleFit = () => {
    if (markmapRef.current) {
      markmapRef.current.fit();
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getMindmapMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!svgRef.current) return;
    const svgEl = svgRef.current.cloneNode(true);
    // Add background rect to preserve the active theme in standalone image viewers
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("width", "100%");
    bgRect.setAttribute("height", "100%");
    bgRect.setAttribute("fill", theme === "dark" ? "#0c0e14" : "#ffffff");
    svgEl.insertBefore(bgRect, svgEl.firstChild);

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mindmap-${title.replace(/[^a-zA-Z0-9_-]/g, "_")}-${theme}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadHtml = () => {
    const cleanMd = getMindmapMarkdown();
    const htmlContent = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mindmap: ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body, html { width: 100%; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; transition: background 0.25s, color 0.25s; }
    #mindmap { width: 100%; height: 100%; }

    /* Dark Theme */
    body.theme-dark { background: #0c0e14; color: #f8fafc; }
    body.theme-dark .toolbar { background: rgba(21, 24, 33, 0.88); border: 1px solid #1e2330; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    body.theme-dark .btn { color: #94a3b8; }
    body.theme-dark .btn:hover { background: #1e2330; color: #ffffff; }
    body.theme-dark .markmap-node text { fill: #f8fafc !important; font-size: 13px !important; }
    body.theme-dark .markmap-node div { color: #f8fafc !important; }

    /* Light Theme */
    body.theme-light { background: #ffffff; color: #0f172a; }
    body.theme-light .toolbar { background: rgba(248, 250, 252, 0.95); border: 1px solid #cbd5e1; box-shadow: 0 10px 25px rgba(0,0,0,0.08); }
    body.theme-light .btn { color: #475569; }
    body.theme-light .btn:hover { background: #e2e8f0; color: #0f172a; }
    body.theme-light .markmap-node text { fill: #0f172a !important; font-size: 13px !important; font-weight: 500 !important; }
    body.theme-light .markmap-node div { color: #0f172a !important; font-weight: 500 !important; }

    .toolbar {
      position: absolute;
      bottom: 24px;
      right: 24px;
      display: flex;
      gap: 8px;
      backdrop-filter: blur(8px);
      border-radius: 12px;
      padding: 6px;
    }
    .btn {
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .markmap-node circle { stroke-width: 2px !important; }
    .markmap-link { stroke-width: 2px !important; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
  <script src="https://cdn.jsdelivr.net/npm/markmap-view@0.17"></script>
  <script src="https://cdn.jsdelivr.net/npm/markmap-lib@0.17"></script>
</head>
<body class="theme-${theme}">
  <svg id="mindmap"></svg>
  <div class="toolbar">
    <button class="btn" onclick="toggleTheme()" id="themeBtn" title="Ganti Mode Gelap/Terang">${theme === "dark" ? "☀️ Mode Terang" : "🌙 Mode Gelap"}</button>
    <button class="btn" onclick="window.mm.rescale(1.25)">🔍 +</button>
    <button class="btn" onclick="window.mm.rescale(0.8)">🔍 -</button>
    <button class="btn" onclick="window.mm.fit()">⛶ Fit View</button>
  </div>
  <script>
    const markdown = ${JSON.stringify(cleanMd)};
    let currentTheme = "${theme}";
    const darkColors = ["#818cf8", "#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#a78bfa"];
    const lightColors = ["#4338ca", "#0284c7", "#059669", "#d946ef", "#d97706", "#7c3aed"];

    function getColors() {
      return currentTheme === 'dark' ? darkColors : lightColors;
    }

    const { Transformer } = window.markmap;
    const transformer = new Transformer();
    const { root } = transformer.transform(markdown);

    window.mm = window.markmap.Markmap.create('#mindmap', {
      duration: 300,
      color: (node) => {
        const c = getColors();
        return c[(node.depth || 0) % c.length];
      },
      paddingX: 18,
      autoFit: true,
    }, root);

    function toggleTheme() {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.body.className = 'theme-' + currentTheme;
      document.getElementById('themeBtn').innerText = currentTheme === 'dark' ? '☀️ Mode Terang' : '🌙 Mode Gelap';
      window.mm.setData(root);
      window.mm.fit();
    }
  </script>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mindmap-${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`relative w-full h-[560px] rounded-2xl overflow-hidden flex flex-col transition-colors duration-200 border ${
        theme === "dark"
          ? "bg-[#0c0e14] border-[#1e2330] text-slate-100 markmap-container-dark"
          : "bg-white border-slate-200 text-slate-900 shadow-sm markmap-container-light"
      }`}
    >
      <style>{`
        .markmap-container-dark .markmap-node text {
          fill: #f8fafc !important;
          font-size: 13px !important;
        }
        .markmap-container-dark .markmap-node div {
          color: #f8fafc !important;
        }
        .markmap-container-dark .markmap-node circle {
          stroke-width: 2px !important;
        }
        .markmap-container-dark .markmap-link {
          stroke-width: 2px !important;
        }

        .markmap-container-light .markmap-node text {
          fill: #0f172a !important;
          font-size: 13px !important;
          font-weight: 600 !important;
        }
        .markmap-container-light .markmap-node div {
          color: #0f172a !important;
          font-weight: 600 !important;
        }
        .markmap-container-light .markmap-node circle {
          stroke-width: 2px !important;
        }
        .markmap-container-light .markmap-link {
          stroke-width: 2.2px !important;
        }
      `}</style>

      {/* Top action bar */}
      <div
        className={`flex flex-wrap items-center justify-between px-4 py-2.5 border-b text-xs transition-colors ${
          theme === "dark"
            ? "bg-[#151821]/90 border-[#1e2330] text-slate-300"
            : "bg-slate-50 border-slate-200 text-slate-700"
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              theme === "dark" ? "bg-indigo-400" : "bg-indigo-600"
            } animate-pulse`}
          ></span>
          <span
            className={`font-semibold tracking-wide ${
              theme === "dark" ? "text-white" : "text-slate-900"
            }`}
          >
            Mindmap Diskusi (Markmap)
          </span>
          <span
            className={`text-[10px] font-mono hidden sm:inline ${
              theme === "dark" ? "text-slate-500" : "text-slate-400"
            }`}
          >
            • Klik node untuk expand/collapse
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Mode Dark / Light Switcher */}
          <button
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
            className={`px-2.5 py-1.5 border rounded-lg flex items-center gap-1.5 font-medium transition-all ${
              theme === "dark"
                ? "bg-[#0c0e14] hover:bg-slate-800 border-[#1e2330] text-amber-300 hover:text-amber-200"
                : "bg-white hover:bg-slate-100 border-slate-300 text-indigo-700 hover:text-indigo-900 shadow-xs"
            }`}
            title={theme === "dark" ? "Ganti ke Mode Terang (Light)" : "Ganti ke Mode Gelap (Dark)"}
          >
            {theme === "dark" ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px]">Mode Terang</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-600" />
                <span className="text-[11px]">Mode Gelap</span>
              </>
            )}
          </button>

          <div
            className={`w-[1px] h-4 mx-1 ${
              theme === "dark" ? "bg-[#1e2330]" : "bg-slate-300"
            }`}
          ></div>

          {/* Zoom In */}
          <button
            onClick={handleZoomIn}
            className={`p-1.5 border rounded-lg transition-colors ${
              theme === "dark"
                ? "bg-[#0c0e14] hover:bg-slate-800 border-[#1e2330] text-slate-300 hover:text-white"
                : "bg-white hover:bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 shadow-xs"
            }`}
            title="Perbesar"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          {/* Zoom Out */}
          <button
            onClick={handleZoomOut}
            className={`p-1.5 border rounded-lg transition-colors ${
              theme === "dark"
                ? "bg-[#0c0e14] hover:bg-slate-800 border-[#1e2330] text-slate-300 hover:text-white"
                : "bg-white hover:bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 shadow-xs"
            }`}
            title="Perkecil"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          {/* Fit */}
          <button
            onClick={handleFit}
            className={`p-1.5 border rounded-lg transition-colors ${
              theme === "dark"
                ? "bg-[#0c0e14] hover:bg-slate-800 border-[#1e2330] text-slate-300 hover:text-white"
                : "bg-white hover:bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 shadow-xs"
            }`}
            title="Pusatkan Tampilan"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <div
            className={`w-[1px] h-4 mx-1 ${
              theme === "dark" ? "bg-[#1e2330]" : "bg-slate-300"
            }`}
          ></div>

          {/* Salin Markdown */}
          <button
            onClick={handleCopy}
            className={`px-2.5 py-1.5 border rounded-lg flex items-center gap-1 transition-colors ${
              theme === "dark"
                ? "bg-[#0c0e14] hover:bg-slate-800 border-[#1e2330] text-slate-300 hover:text-white"
                : "bg-white hover:bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 shadow-xs"
            }`}
            title="Salin Markdown"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span className="text-[11px]">{copied ? "Tersalin" : "Salin"}</span>
          </button>

          {/* Download SVG */}
          <button
            onClick={handleDownloadSvg}
            className={`px-2.5 py-1.5 border rounded-lg flex items-center gap-1 transition-colors ${
              theme === "dark"
                ? "bg-[#0c0e14] hover:bg-slate-800 border-[#1e2330] text-slate-300 hover:text-white"
                : "bg-white hover:bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 shadow-xs"
            }`}
            title="Unduh format SVG"
          >
            <Download className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[11px]">SVG</span>
          </button>

          {/* Download HTML */}
          <button
            onClick={handleDownloadHtml}
            className={`px-2.5 py-1.5 rounded-lg border font-medium flex items-center gap-1 transition-colors ${
              theme === "dark"
                ? "bg-indigo-600/20 hover:bg-indigo-600/30 border-indigo-500/40 text-indigo-300 hover:text-white"
                : "bg-indigo-600 hover:bg-indigo-700 border-indigo-600 text-white shadow-xs"
            }`}
            title="Unduh file HTML interaktif mandiri"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="text-[11px]">Unduh Mindmap HTML</span>
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing">
        <svg
          ref={svgRef}
          className="w-full h-full block"
          style={{ minHeight: "100%" }}
        />
      </div>
    </div>
  );
}
