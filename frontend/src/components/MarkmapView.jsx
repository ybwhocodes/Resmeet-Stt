import React, { useEffect, useRef, useState } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { ZoomIn, ZoomOut, Maximize2, Download, Copy, Check, Share2 } from "lucide-react";

const transformer = new Transformer();

export default function MarkmapView({ markdown, title = "Mindmap Rapat" }) {
  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const [copied, setCopied] = useState(false);

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

    try {
      const { root } = transformer.transform(cleanMd);
      if (markmapRef.current) {
        markmapRef.current.setData(root);
        markmapRef.current.fit();
      } else {
        markmapRef.current = Markmap.create(svgRef.current, {
          duration: 300,
          color: (node) => {
            const colors = ["#818cf8", "#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#a78bfa"];
            const depth = node.depth || 0;
            return colors[depth % colors.length];
          },
          paddingX: 16,
          autoFit: true,
        }, root);
      }
    } catch (err) {
      console.warn("[Markmap] Error creating mindmap:", err);
    }
  }, [markdown, title]);

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
    const svgEl = svgRef.current;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mindmap-${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.svg`;
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
    body, html { width: 100%; height: 100%; background: #0c0e14; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    #mindmap { width: 100%; height: 100%; }
    .toolbar {
      position: absolute;
      bottom: 24px;
      right: 24px;
      display: flex;
      gap: 8px;
      background: rgba(21, 24, 33, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid #1e2330;
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn:hover { background: #1e2330; color: #fff; }
    .markmap-node text { fill: #f1f5f9 !important; font-size: 13px !important; }
    .markmap-node circle { stroke-width: 2px !important; }
    .markmap-link { stroke-width: 2px !important; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
  <script src="https://cdn.jsdelivr.net/npm/markmap-view@0.17"></script>
  <script src="https://cdn.jsdelivr.net/npm/markmap-lib@0.17"></script>
</head>
<body>
  <svg id="mindmap"></svg>
  <div class="toolbar">
    <button class="btn" onclick="window.mm.rescale(1.25)">🔍 +</button>
    <button class="btn" onclick="window.mm.rescale(0.8)">🔍 -</button>
    <button class="btn" onclick="window.mm.fit()">⛶ Fit View</button>
  </div>
  <script>
    const markdown = ${JSON.stringify(cleanMd)};
    const { Transformer } = window.markmap;
    const transformer = new Transformer();
    const { root } = transformer.transform(markdown);
    window.mm = window.markmap.Markmap.create('#mindmap', {
      duration: 300,
      color: (node) => {
        const colors = ["#818cf8", "#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#a78bfa"];
        return colors[(node.depth || 0) % colors.length];
      },
      paddingX: 18,
      autoFit: true,
    }, root);
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
    <div className="relative w-full h-[540px] bg-[#0c0e14] border border-[#1e2330] rounded-2xl overflow-hidden flex flex-col">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-[#151821]/80 backdrop-blur border-b border-[#1e2330] text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
          <span className="font-semibold text-white tracking-wide">Mindmap Diskusi (Markmap)</span>
          <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">• Klik node untuk expand/collapse</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleZoomIn}
            className="p-1.5 bg-[#0c0e14] hover:bg-slate-800 border border-[#1e2330] rounded-lg text-slate-300 hover:text-white"
            title="Perbesar"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 bg-[#0c0e14] hover:bg-slate-800 border border-[#1e2330] rounded-lg text-slate-300 hover:text-white"
            title="Perkecil"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleFit}
            className="p-1.5 bg-[#0c0e14] hover:bg-slate-800 border border-[#1e2330] rounded-lg text-slate-300 hover:text-white"
            title="Pusatkan Tampilan"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-[#1e2330] mx-1"></div>

          <button
            onClick={handleCopy}
            className="px-2.5 py-1.5 bg-[#0c0e14] hover:bg-slate-800 border border-[#1e2330] rounded-lg text-slate-300 hover:text-white flex items-center gap-1"
            title="Salin Markdown"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="text-[11px]">{copied ? "Tersalin" : "Salin"}</span>
          </button>

          <button
            onClick={handleDownloadSvg}
            className="px-2.5 py-1.5 bg-[#0c0e14] hover:bg-slate-800 border border-[#1e2330] rounded-lg text-slate-300 hover:text-white flex items-center gap-1"
            title="Unduh format SVG"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-[11px]">SVG</span>
          </button>

          <button
            onClick={handleDownloadHtml}
            className="px-2.5 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 rounded-lg text-indigo-300 hover:text-white flex items-center gap-1 font-medium"
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
