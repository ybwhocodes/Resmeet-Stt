import test from "node:test";
import assert from "node:assert/strict";
import { readTranscriptionResponse, pollTranscriptionJob, transcriptionErrorMessage } from "./transcriptionStream.js";

function streamResponse(chunks) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } }), { headers: { "Content-Type": "application/x-ndjson" } });
}

test("reads real progress, ignores heartbeats, and assembles split result events", async () => {
  const progress = [];
  const result = await readTranscriptionResponse(streamResponse([
    '{"type":"progress","percent":28,"stage":"Whisper"}\n{"type":"heart',
    'beat"}\n{"type":"result","data":{"success":true,"finalText":"Rapat ',
    'dimulai."}}\n',
  ]), (event) => progress.push(event));
  assert.equal(progress.length, 1);
  assert.equal(progress[0].percent, 28);
  assert.equal(result.finalText, "Rapat dimulai.");
});

test("reports backend failure instead of staying in progress", async () => {
  await assert.rejects(readTranscriptionResponse(streamResponse([
    '{"type":"error","error":"Whisper gagal"}\n',
  ]), () => {}), /Whisper gagal/);
});

test("reports a disconnected response with no final result", async () => {
  await assert.rejects(readTranscriptionResponse(streamResponse([
    '{"type":"progress","percent":45}\n',
  ]), () => {}), /Koneksi terputus/);
});

test("keeps compatibility with JSON errors", async () => {
  await assert.rejects(readTranscriptionResponse(new Response('{"error":"Session expired"}', {
    status: 401, headers: { "Content-Type": "application/json" },
  }), () => {}), /Session expired/);
});

test("resumes via the private job status when a long stream closes", async () => {
  let resumedId;
  const result = await readTranscriptionResponse(streamResponse([
    '{"type":"job","jobId":"job-123"}\n{"type":"progress","percent":37}\n',
  ]), () => {}, async (id) => { resumedId = id; return { success: true, id: "saved" }; });
  assert.equal(resumedId, "job-123");
  assert.equal(result.id, "saved");
});

test("does not retry a terminal backend error by polling", async () => {
  let polled = false;
  await assert.rejects(readTranscriptionResponse(streamResponse([
    '{"type":"job","jobId":"job-123"}\n{"type":"error","error":"Audio rusak"}\n',
  ]), () => {}, async () => { polled = true; }), /Audio rusak/);
  assert.equal(polled, false);
});

test("publishes a readable transcript before AI finishes without ending the job", async () => {
  const previews = [];
  const result = await readTranscriptionResponse(streamResponse([
    '{"type":"transcript","data":{"id":"saved","aiCorrectionStatus":"pending","rawText":"teks asli"}}\n',
    '{"type":"progress","percent":94}\n',
    '{"type":"result","data":{"id":"saved","aiCorrectionStatus":"completed","finalText":"Teks asli."}}\n',
  ]), () => {}, undefined, (data) => previews.push(data));
  assert.equal(previews[0].rawText, "teks asli");
  assert.equal(previews[0].aiCorrectionStatus, "pending");
  assert.equal(result.aiCorrectionStatus, "completed");
});

test('uses a background acknowledgement without waiting for a long HTTP stream', async () => {
  const result = await readTranscriptionResponse(new Response('{"jobId":"background-123"}', {
    status: 202, headers: { 'Content-Type': 'application/json' },
  }), () => {}, async (id) => ({ success: true, id }));
  assert.equal(result.id, 'background-123');
});

test('closes a legacy stream as soon as its job is known and continues by polling', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"job","jobId":"legacy-123"}\n')); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  const result = await readTranscriptionResponse(response, () => {}, async (id) => ({ id }), () => {}, true);
  assert.equal(cancelled, true);
  assert.equal(result.id, 'legacy-123');
});

test('job polling recovers from timeouts and temporary server errors', async () => {
  const waits = [], reconnects = [], progress = [], previews = [];
  let calls = 0;
  const result = await pollTranscriptionJob('/job', {
    token: 'test', sleep: async (ms) => waits.push(ms),
    onReconnect: (n) => reconnects.push(n), onProgress: (data) => progress.push(data), onTranscript: (data) => previews.push(data),
    fetchImpl: async () => {
      if (++calls === 1) throw new DOMException('signal timed out', 'TimeoutError');
      if (calls === 2) return new Response('temporarily unavailable', { status: 502 });
      if (calls === 3) return Response.json({ progress: { percent: 85 }, preview: { rawText: 'Rapat' } });
      return Response.json({ terminal: { type: 'result', data: { success: true, finalText: 'Rapat.' } } });
    },
  });
  assert.equal(result.finalText, 'Rapat.');
  assert.deepEqual(reconnects, [1, 2]);
  assert.deepEqual(waits, [1000, 2000, 2000]);
  assert.equal(progress[0].percent, 85);
  assert.equal(previews[0].rawText, 'Rapat');
});

test('job polling stops for expired sessions and actual transcription errors', async () => {
  for (const response of [Response.json({ error: 'Session expired' }, { status: 401 }), Response.json({ terminal: { type: 'error', error: 'Audio rusak' } })]) {
    let calls = 0;
    await assert.rejects(pollTranscriptionJob('/job', {
      token: 'test', sleep: async () => { throw new Error('Unexpected retry'); },
      fetchImpl: async () => { calls++; return response; },
    }), /Session expired|Audio rusak/);
    assert.equal(calls, 1);
  }
});

test('persistent disconnection gives a readable recovery message after bounded retries', async () => {
  let calls = 0;
  await assert.rejects(pollTranscriptionJob('/job', {
    token: 'test', maxFailures: 2, sleep: async () => {},
    fetchImpl: async () => { calls++; throw new TypeError('Failed to fetch'); },
  }), /Pemrosesan tetap berjalan di server/);
  assert.equal(calls, 2);
});

test('a timeout while reading a polling response body reconnects without losing the job', async () => {
  let calls = 0;
  const result = await pollTranscriptionJob('/job', {
    token: 'test', sleep: async () => {},
    fetchImpl: async () => ++calls === 1
      ? { ok: true, json: async () => { throw new DOMException('signal timed out', 'TimeoutError'); } }
      : Response.json({ terminal: { type: 'result', data: { id: 'saved' } } }),
  });
  assert.equal(calls, 2);
  assert.equal(result.id, 'saved');
});
test('explicit cancellation stops polling immediately instead of retrying', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(pollTranscriptionJob('/job', {
    token: 'test', signal: controller.signal,
    fetchImpl: async () => { throw new Error('must not fetch'); },
  }), { name: 'AbortError' });
});
test('raw signal timeout errors have a readable recovery message', () => {
  assert.match(transcriptionErrorMessage(new DOMException('signal timed out', 'TimeoutError')), /Riwayat/);
  assert.equal(transcriptionErrorMessage(new Error('Audio rusak')), 'Audio rusak');
});

test('unchanged ETag status avoids downloading and rendering the transcript again', async () => {
  let calls = 0; const seenHeaders = []; const previews = [];
  const result = await pollTranscriptionJob('/job', {
    token: 'test', sleep: async () => {}, onTranscript: (preview) => previews.push(preview),
    fetchImpl: async (_url, options) => {
      seenHeaders.push(options.headers);
      if (++calls === 1) return Response.json({ preview: { rawText: 'Rapat' } }, { headers: { ETag: '"revision-1"' } });
      if (calls === 2) return new Response(null, { status: 304 });
      return Response.json({ terminal: { type: 'result', data: { id: 'saved' } } });
    },
  });
  assert.equal(result.id, 'saved'); assert.equal(previews.length, 1);
  assert.equal(seenHeaders[1]['If-None-Match'], '"revision-1"');
});
