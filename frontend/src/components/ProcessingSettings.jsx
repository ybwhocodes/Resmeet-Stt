import { useCallback, useEffect, useState } from "react";
import { Cpu, Zap, RefreshCw } from "lucide-react";

export default function ProcessingSettings({ token, apiBaseUrl = "", processing = false }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanSucceeded, setScanSucceeded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async (signal) => {
    setLoading(true); setScanSucceeded(false); setError(""); setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/user/processing-settings`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Pengaturan pemrosesan belum dapat dimuat.");
      if (!signal?.aborted) { setSettings(data); setScanSucceeded(true); }
    } catch (failure) { if (!signal?.aborted) setError(failure.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [apiBaseUrl, token]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => { if (!controller.signal.aborted) load(controller.signal); });
    return () => controller.abort();
  }, [load]);
  const selectDevice = async (device) => {
    if (processing || saving || loading || !settings || (device === "gpu" && (!scanSucceeded || !settings.gpuDetected || !settings.gpuAvailable))) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/user/processing-settings`, {
        method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ device }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Pilihan pemrosesan gagal disimpan.");
      setSettings(data); setMessage(`Pilihan ${device.toUpperCase()} tersimpan untuk transkripsi berikutnya.`);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  return <section aria-labelledby="processing-title" className="rounded-2xl border border-[#1e2330] bg-[#151821] p-6 space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div><h3 id="processing-title" className="flex items-center gap-2 font-semibold text-white"><Cpu size={18} />Pemrosesan Transkripsi</h3>
        <p className="mt-1 text-xs text-slate-400">GPU akselerasi otomatis menjadi pilihan utama saat terdeteksi. CPU tetap tersedia sebagai secondary.</p></div>
      <button type="button" aria-label="Pindai ulang GPU" disabled={loading || saving} onClick={() => load()} className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-xs text-slate-300 disabled:opacity-40"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />{loading ? "Memindai..." : "Pindai GPU"}</button>
    </div>
    {loading && <p role="status" className="text-xs text-slate-400">Memindai GPU pada mesin backend. Pilihan GPU aktif setelah perangkat terdeteksi dan siap digunakan.</p>}
      <div role="radiogroup" aria-label="Perangkat transkripsi" className="grid gap-3 sm:grid-cols-2">
        {[
        { device: "cpu", title: "CPU · Hemat daya (Secondary)", description: settings ? `${settings.cpuThreads} thread, batch ${settings.batchSize}. Pilihan cadangan bila GPU sedang dipakai komputasi lain.` : "Pemrosesan hemat daya melalui CPU.", Icon: Cpu, available: Boolean(settings) },
        { device: "gpu", title: "GPU · Akselerasi (Utama / Default)", description: loading ? "Menunggu hasil pemindaian GPU..." : !scanSucceeded ? "Pemindaian GPU belum berhasil. Tekan Pindai GPU untuk mencoba kembali." : !settings?.gpuDetected ? "GPU tidak terdeteksi. Transkripsi menggunakan CPU." : settings.gpuAvailable ? `${settings.gpuName}. Kecepatan maksimal, proses otomatis diprioritaskan di GPU.` : "GPU terdeteksi, tetapi akses Vulkan atau model native belum siap pada backend.", Icon: Zap, available: scanSucceeded && settings?.gpuDetected && settings?.gpuAvailable },
      ].map(({ device, title, description, Icon, available }) => <button key={device} type="button" role="radio" aria-checked={(settings?.effectiveDevice || (settings?.gpuAvailable ? "gpu" : "cpu")) === device}
        disabled={processing || loading || saving || !available} onClick={() => selectDevice(device)}
        className={`rounded-xl border p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${(settings?.effectiveDevice || (settings?.gpuAvailable ? "gpu" : "cpu")) === device ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 bg-[#0c0e14]"}`}>
          <span className="flex items-center gap-2 text-sm font-semibold text-white"><Icon size={17} />{title}</span>
          <span className="mt-2 block text-xs leading-relaxed text-slate-400">{description}</span>
        </button>)}
      </div>
    {settings && <>
      {scanSucceeded && !settings.gpuDetected && <p className="text-xs text-slate-400">GPU yang didukung belum terdeteksi pada mesin backend. Transkripsi memakai CPU.</p>}
      {settings.device === "gpu" && settings.effectiveDevice === "cpu" && <p className="text-xs text-amber-300">GPU pilihan sebelumnya tidak tersedia. Transkripsi berikutnya memakai CPU.</p>}
      <p className="text-xs text-slate-400">Pilihan tersimpan per akun dan berlaku untuk transkripsi berikutnya. {processing ? "Tunggu transkripsi aktif selesai untuk mengganti perangkat." : "GPU yang ditampilkan adalah GPU pada mesin yang menjalankan backend."}</p>
    </>}
    {message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
  </section>;
}
