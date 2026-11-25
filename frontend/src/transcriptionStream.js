/** Poll independently of recording duration; retry temporary network/server failures. */
export async function pollTranscriptionJob(url, {
  token, onProgress = () => {}, onTranscript = () => {}, onReconnect = () => {},
  fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxFailures = 12, timeoutMs = 60000, signal,
}) {
  let failures = 0;
  let etag;
  while (true) {
    signal?.throwIfAborted();
    let job;
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, ...(etag ? { "If-None-Match": etag } : {}) },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs), cache: "no-store",
      });
      if (response.status === 304) { failures = 0; await sleep(2000); continue; }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = new Error(data.error || "Status transkripsi tidak dapat dibaca.");
        error.permanent = response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status);
        throw error;
      }
      job = await response.json();
      etag = response.headers?.get("etag") || undefined;
      failures = 0;
    } catch (error) {
      if (signal?.aborted || error.permanent) throw error;
      if (++failures >= maxFailures) {
        throw new Error("Status belum dapat dihubungi. Pemrosesan tetap berjalan di server; periksa Riwayat setelah koneksi pulih.", { cause: error });
      }
      onReconnect(failures);
      await sleep(Math.min(1000 * 2 ** (failures - 1), 10000));
      continue;
    }
    if (job.progress) onProgress(job.progress);
    if (job.preview) onTranscript(job.preview);
    if (job.terminal?.type === "error") throw new Error(job.terminal.error || "Transkripsi gagal.");
    if (job.terminal?.type === "result") return job.terminal.data;
    await sleep(2000);
  }
}

/** Decode legacy NDJSON or a background-job acknowledgement. */
export async function readTranscriptionResponse(response, onProgress, pollJob, onTranscript = () => {}, preferPolling = false) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Transkripsi gagal.");
    if (data.jobId && pollJob) return pollJob(data.jobId);
    return data;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;
  let jobId;
  let terminalError = false;
  const accept = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "job") jobId = event.jobId;
    if (event.type === "error") { terminalError = true; throw new Error(event.error || "Transkripsi gagal."); }
    if (event.type === "progress") onProgress(event);
    if (event.type === "transcript") onTranscript(event.data);
    if (event.type === "result") result = event.data;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        accept(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (preferPolling && jobId && pollJob && !result) {
        await reader.cancel().catch(() => {});
        return pollJob(jobId);
      }
      if (done) break;
    }
    accept(buffer);
    if (!result) throw new Error("Koneksi terputus sebelum hasil diterima. Periksa Riwayat untuk hasil yang sudah tersimpan.");
    return result;
  } catch (error) {
    if (!terminalError && jobId && pollJob) return await pollJob(jobId);
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Keep transport errors understandable without treating a slow job as failed. */
export function transcriptionErrorMessage(error) {
  if (error?.name === "TimeoutError" || /signal.*tim(?:e|ed)\s*out|timed out|timeout/i.test(error?.message || "")) {
    return "Koneksi ke server melewati batas waktu. Job yang sudah diterima server tetap diproses; periksa Riwayat atau coba hubungkan kembali.";
  }
  return error?.message || "Transkripsi belum dapat diselesaikan. Periksa koneksi dan Riwayat.";
}
