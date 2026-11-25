export default function AiToggle({ configured, checked, onChange, disabled = false }) {
  if (!configured) return null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-indigo-500/25 bg-[#0c0e14] p-4">
      <div>
        <p className="text-sm font-semibold text-white">Model AI <span className={checked ? "text-emerald-400" : "text-slate-400"}>{checked ? "ON" : "OFF"}</span></p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{checked ? "Transkrip dirapikan dan dokumen rapat disusun lebih rinci berdasarkan isi percakapan." : "Hasil transkripsi asli tanpa parafrase atau ringkasan AI."}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label="Model AI" disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "border-emerald-400 bg-emerald-500" : "border-slate-600 bg-slate-700"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "left-0.5 translate-x-5" : "left-0.5 translate-x-0"}`} />
      </button>
    </div>
  );
}
