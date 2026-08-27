"""
STT Backend - Python Flask + Socket.IO
WhisperX (batched faster-whisper + Silero VAD + optional wav2vec2 alignment) + MySQL.
Progress transkripsi dikirim realtime via WebSocket ke frontend.
"""

import hashlib
import json
import logging
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid

_cpu = "2"
for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(k, _cpu)

import whisperx

from datetime import datetime
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import mysql.connector
from mysql.connector import Error

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "stt-secret-key")
CORS(app, resources={r"/*": {"origins": "*"}})

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
ALLOWED_EXTENSIONS = {"mp3", "wav", "ogg", "flac", "m4a", "webm"}

DB_CONFIG = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", 3307)),
    "database": os.getenv("DB_NAME",     "stt_db"),
    "user":     os.getenv("DB_USER",     "root"),
    "password": os.getenv("DB_PASSWORD", "password"),
}

MODEL_SIZE       = os.getenv("WHISPER_MODEL", "large-v3-turbo")
MODEL_DIR        = os.getenv("MODEL_DIR", "").strip() or os.path.join(BASE_DIR, "models")
COMPUTE_TYPE     = os.getenv("COMPUTE_TYPE", "int8")
DEVICE           = os.getenv("DEVICE", "cpu").strip()
CPU_THREADS      = int(os.getenv("CPU_THREADS", "2"))
BATCH_SIZE       = int(os.getenv("BATCH_SIZE", "1"))
ENABLE_DENOISE   = os.getenv("ENABLE_AUDIO_DENOISE", "false").lower() == "true"
FFMPEG_TIMEOUT_S = int(os.getenv("FFMPEG_TIMEOUT_S", "600"))
CACHE_PATH       = os.path.join(BASE_DIR, "transcription_cache.json")
KNOWLEDGE_DIR    = os.path.join(BASE_DIR, "knowledge")
TRANSCRIPTS_MD_DIR = os.path.join(BASE_DIR, "transcripts_md")
AI_BASE_URL      = os.getenv("AI_BASE_URL", "").rstrip("/")
AI_API_KEY       = os.getenv("AI_API_KEY", "")
AI_MODEL_ID      = os.getenv("AI_MODEL_ID", "")
AI_TIMEOUT_S     = int(os.getenv("AI_TIMEOUT_S", "120"))
AI_ENABLE_CORRECTION = os.getenv("AI_ENABLE_CORRECTION", "true").lower() == "true"
AI_ENABLE_KNOWLEDGE_EXTRACTION = os.getenv("AI_ENABLE_KNOWLEDGE_EXTRACTION", "true").lower() == "true"
AI_ENABLE_RAG    = os.getenv("AI_ENABLE_RAG", "true").lower() == "true"

MODEL_LOCAL_PATH = os.path.join(MODEL_DIR, MODEL_SIZE)

_whisper_pipeline = None
_align_model = None
_align_metadata = None
_model_lock = threading.Lock()
_align_lock = threading.Lock()
_transcription_lock = threading.Lock()
_cache_lock = threading.Lock()
_status_lock = threading.Lock()
JOB_STATUS = {}


def _set_status(job_id: str, status: str, **extra):
    with _status_lock:
        JOB_STATUS[job_id] = {**JOB_STATUS.get(job_id, {}), "status": status, **extra}


def _get_status(job_id: str):
    with _status_lock:
        return JOB_STATUS.get(job_id, {}).copy()


# ponytail: whisperx.load_model wraps WhisperModel + Silero VAD in one call
def load_model():
    global _whisper_pipeline
    if _whisper_pipeline is not None:
        return _whisper_pipeline
    with _model_lock:
        if _whisper_pipeline is not None:
            return _whisper_pipeline

        os.makedirs(MODEL_DIR, exist_ok=True)
        model_exists = (
            os.path.isdir(MODEL_LOCAL_PATH) and
            any(f.endswith(".bin") for _, _, files in os.walk(MODEL_LOCAL_PATH) for f in files)
        )
        load_from = MODEL_LOCAL_PATH if model_exists else MODEL_SIZE

        _whisper_pipeline = whisperx.load_model(
            load_from,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            download_root=MODEL_DIR,
            local_files_only=model_exists,
            threads=CPU_THREADS,
            language="id",
            asr_options={
                "beam_size": 3,
                "best_of": 3,
                "repetition_penalty": 1.05,
                "no_repeat_ngram_size": 3,
                "condition_on_previous_text": True,
                "temperatures": [0.0],
            },
            vad_method="silero",
        )
        logger.info("WhisperX pipeline siap. Device=%s, compute_type=%s, threads=%s", DEVICE, COMPUTE_TYPE, CPU_THREADS)
        return _whisper_pipeline


def load_align():
    global _align_model, _align_metadata
    if _align_model is not None:
        return _align_model, _align_metadata
    with _align_lock:
        if _align_model is not None:
            return _align_model, _align_metadata
        _align_model, _align_metadata = whisperx.load_align_model(
            language_code="id",
            device=DEVICE,
            model_dir=MODEL_DIR,
        )
        logger.info("Alignment model (wav2vec2) loaded.")
        return _align_model, _align_metadata


def get_db():
    return mysql.connector.connect(**DB_CONFIG)


def init_db():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS transcripts (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                filename        VARCHAR(255) NOT NULL,
                final_text      LONGTEXT     NOT NULL,
                created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                duration_s      FLOAT        DEFAULT NULL,
                language        VARCHAR(10)  DEFAULT 'id',
                word_timestamps JSON         DEFAULT NULL,
                raw_text        LONGTEXT     DEFAULT NULL,
                ai_corrected_text LONGTEXT   DEFAULT NULL,
                ai_summary      LONGTEXT     DEFAULT NULL,
                md_path         VARCHAR(500) DEFAULT NULL,
                ai_correction_status VARCHAR(50) DEFAULT 'skipped'
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """)
        for column_sql in (
            "ALTER TABLE transcripts ADD COLUMN word_timestamps JSON DEFAULT NULL",
            "ALTER TABLE transcripts ADD COLUMN raw_text LONGTEXT DEFAULT NULL",
            "ALTER TABLE transcripts ADD COLUMN ai_corrected_text LONGTEXT DEFAULT NULL",
            "ALTER TABLE transcripts ADD COLUMN ai_summary LONGTEXT DEFAULT NULL",
            "ALTER TABLE transcripts ADD COLUMN md_path VARCHAR(500) DEFAULT NULL",
            "ALTER TABLE transcripts ADD COLUMN ai_correction_status VARCHAR(50) DEFAULT 'skipped'",
        ):
            try:
                cur.execute(column_sql)
            except Exception:
                pass
        conn.commit()
        cur.close(); conn.close()
        logger.info("Database initialized.")
    except Error as e:
        logger.error("DB init error: %s", e)


def calculate_file_hash(file_path: str) -> str:
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def _cache_key(file_hash: str, word_timestamps: bool, ai_correction: bool) -> str:
    fmt_path = os.path.join(KNOWLEDGE_DIR, "format-mom.md")
    fmt_hash = calculate_file_hash(fmt_path)[:12] if os.path.exists(fmt_path) else "noformat"
    return f"{file_hash}:{MODEL_SIZE}:id:{COMPUTE_TYPE}:word_ts={int(word_timestamps)}:denoise={int(ENABLE_DENOISE)}:ai={int(ai_correction)}:{AI_MODEL_ID}:fmt={fmt_hash}"


def _read_cache(cache_key: str):
    with _cache_lock:
        if not os.path.exists(CACHE_PATH):
            return None
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                return json.load(f).get(cache_key)
        except Exception as e:
            logger.warning("Cache read failed: %s", e)
            return None


def _write_cache(cache_key: str, data: dict):
    with _cache_lock:
        cache = {}
        if os.path.exists(CACHE_PATH):
            try:
                with open(CACHE_PATH, "r", encoding="utf-8") as f:
                    cache = json.load(f)
            except Exception:
                cache = {}
        cache[cache_key] = data
        tmp = CACHE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, CACHE_PATH)


def convert_with_ffmpeg(input_path: str, target_sr: int = 16000):
    output = os.path.splitext(input_path)[0] + "_processed.wav"
    start = time.perf_counter()
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-ac", "1", "-ar", str(target_sr), "-c:a", "pcm_s16le", output],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        timeout=FFMPEG_TIMEOUT_S,
    )
    if proc.returncode:
        raise RuntimeError(f"FFmpeg gagal: {proc.stderr[-1000:]}")
    duration = float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output],
        text=True,
        timeout=30,
    ).strip() or 0)
    return output, duration, time.perf_counter() - start


def denoise_audio(input_path: str, target_sr: int = 16000):
    import librosa
    import noisereduce as nr
    import numpy as np
    import soundfile as sf
    from scipy.signal import butter, filtfilt

    start = time.perf_counter()
    audio, sr = librosa.load(input_path, sr=target_sr, mono=True)
    audio, _ = librosa.effects.trim(audio, top_db=25)
    audio = nr.reduce_noise(y=audio, sr=sr, stationary=False, prop_decrease=0.45)
    nyq = 0.5 * sr
    for cutoff, filter_type in ((80, "highpass"), (7600, "lowpass")):
        b, a = butter(4, cutoff / nyq, btype=filter_type, analog=False)
        audio = filtfilt(b, a, audio)
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = audio / peak * 0.95
    audio = np.clip(audio, -1.0, 1.0)
    output = os.path.splitext(input_path)[0] + "_processed.wav"
    sf.write(output, audio, target_sr)
    return output, len(audio) / target_sr, time.perf_counter() - start


def preprocess_audio(input_path: str):
    return denoise_audio(input_path) if ENABLE_DENOISE else convert_with_ffmpeg(input_path)


def clean_text(text: str) -> str:
    text = text.strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r"([,.!?;:])([^\s])", r"\1 \2", text)
    text = re.sub(r"([,.!?])\1+", r"\1", text)
    text = re.sub(r"\b(\w+)( \1\b)+", r"\1", text, flags=re.IGNORECASE)
    return text


def add_sentence_breaks(text: str) -> str:
    text = clean_text(text)
    for phrase in [" kemudian ", " lalu ", " setelah itu ", " selanjutnya ",
                   " jadi ", " namun ", " tetapi ", " karena ", " sehingga "]:
        text = text.replace(phrase, ". " + phrase.strip() + " ")
    return re.sub(r"\.\s*\.", ".", text)


def sentence_case(text: str) -> str:
    parts = re.split(r"([.!?])", add_sentence_breaks(text))
    out = []
    for i in range(0, len(parts), 2):
        s = parts[i].strip()
        p = parts[i + 1] if i + 1 < len(parts) else "."
        if s:
            out.append(s[0].upper() + s[1:] + p)
    return " ".join(out).strip()


def postprocess(text: str) -> str:
    return sentence_case(clean_text(text))


def _make_progress_emitter(job_id: str, total_duration: float):
    last_emit_time = 0.0
    last_percent = -1.0

    def emit_progress(percent: float, stage: str, current_text: str = "", force: bool = False):
        nonlocal last_emit_time, last_percent
        now = time.time()
        percent = min(round(percent, 1), 100.0)
        if force or percent == 100 or percent - last_percent >= 5 or now - last_emit_time >= 1:
            socketio.emit("progress", {
                "job_id": job_id,
                "percent": percent,
                "elapsed_s": round(total_duration * percent / 100, 1) if total_duration else 0,
                "current_text": current_text,
                "stage": stage,
            }, room=job_id)
            last_emit_time = now
            last_percent = percent

    return emit_progress


def transcribe_with_progress(audio_path: str, job_id: str, total_duration: float, word_timestamps: bool):
    pipeline = load_model()
    emit_progress = _make_progress_emitter(job_id, total_duration)
    emit_progress(0, "Memulai transkripsi...", force=True)

    audio = whisperx.load_audio(audio_path)

    def on_progress(pct):
        emit_progress(min(pct, 95.0), f"Memproses {round(min(pct, 95.0), 1)}%")

    start = time.perf_counter()
    try:
        result = pipeline.transcribe(audio, batch_size=BATCH_SIZE, progress_callback=on_progress)
    except TypeError as e:
        if "progress_callback" not in str(e):
            raise
        logger.warning("WhisperX versi ini tidak support progress_callback; lanjut tanpa progress detail.")
        result = pipeline.transcribe(audio, batch_size=BATCH_SIZE)
    transcribe_s = time.perf_counter() - start

    align_s = 0.0
    if word_timestamps:
        emit_progress(96, "Aligning word timestamps...", force=True)
        start = time.perf_counter()
        align_model, align_meta = load_align()
        result = whisperx.align(result["segments"], align_model, align_meta, audio, device=DEVICE)
        align_s = time.perf_counter() - start

    emit_progress(100, "Transkripsi selesai", force=True)
    return result, transcribe_s, align_s


def _extract_word_ts(result: dict):
    word_ts = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            entry = {"word": w.get("word", ""), "start": w.get("start"), "end": w.get("end")}
            if entry["start"] is not None:
                word_ts.append(entry)
    return word_ts


def _ensure_knowledge_files():
    os.makedirs(KNOWLEDGE_DIR, exist_ok=True)
    os.makedirs(TRANSCRIPTS_MD_DIR, exist_ok=True)
    defaults = {
        "format-mom.md": "# Minutes of Meeting\n\n## Metadata\n\n- File: {{filename}}\n- Tanggal: {{created_at}}\n- Durasi: {{duration_s}} detik\n- Model STT: {{whisper_model}}\n- Koreksi AI: {{ai_correction_status}}\n\n## Ringkasan\n\n{{summary}}\n\n## Peserta / Entitas Terdeteksi\n\n{{entities}}\n\n## Transkrip Final\n\n{{final_transcript}}\n\n## Istilah Penting\n\n{{terms}}\n\n## Konsep Baru\n\n{{concepts}}\n\n## Koreksi Penting\n\n{{corrections}}\n\n## Action Items\n\n{{action_items}}\n\n## Catatan\n\n{{notes}}\n",
        "glossary.md": "# Glossary\n",
        "corrections.md": "# Corrections\n",
        "concepts.md": "# Concepts\n",
        "transcript-notes.md": "# Transcript Notes\n",
    }
    for name, content in defaults.items():
        path = os.path.join(KNOWLEDGE_DIR, name)
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)


def _list_item(values):
    if not values:
        return "- Tidak ada"
    if isinstance(values, str):
        return values or "- Tidak ada"
    lines = []
    for item in values:
        if isinstance(item, dict):
            label = item.get("term") or item.get("name") or item.get("correct") or item.get("wrong") or "Item"
            detail = item.get("meaning") or item.get("description") or item.get("reason") or ""
            lines.append(f"- {label}: {detail}" if detail else f"- {label}")
        else:
            lines.append(f"- {item}")
    return "\n".join(lines) or "- Tidak ada"


def _read_knowledge(limit=20000):
    if not AI_ENABLE_RAG:
        return ""
    _ensure_knowledge_files()
    chunks = []
    for name in ("glossary.md", "corrections.md", "concepts.md", "transcript-notes.md"):
        path = os.path.join(KNOWLEDGE_DIR, name)
        with open(path, "r", encoding="utf-8") as f:
            chunks.append(f"## {name}\n{f.read()}")
    return "\n\n".join(chunks)[:limit]


def _ai_ready():
    return bool(AI_BASE_URL and AI_API_KEY and AI_MODEL_ID)


def _call_ai_json(prompt: str):
    body = json.dumps({"model": AI_MODEL_ID, "messages": [{"role": "user", "content": prompt}], "temperature": 0}).encode("utf-8")
    req = urllib.request.Request(
        f"{AI_BASE_URL}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=AI_TIMEOUT_S) as res:
        raw_response = res.read().decode("utf-8", "replace")
    if raw_response.lstrip().startswith("data:"):
        parts = []
        for line in raw_response.splitlines():
            if not line.startswith("data: "):
                continue
            chunk = line[6:].strip()
            if chunk == "[DONE]":
                continue
            delta = json.loads(chunk).get("choices", [{}])[0].get("delta", {})
            parts.append(delta.get("content", ""))
        content = "".join(parts).strip()
    else:
        data = json.loads(raw_response)
        content = data["choices"][0]["message"]["content"].strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.IGNORECASE | re.DOTALL).strip()
    start, end = content.find("{"), content.rfind("}")
    return json.loads(content[start:end + 1] if start >= 0 and end >= 0 else content)


def _call_ai_correction(raw_text: str):
    if not AI_ENABLE_CORRECTION or not _ai_ready():
        return None, "skipped"
    _ensure_knowledge_files()
    with open(os.path.join(KNOWLEDGE_DIR, "RAG.md"), "r", encoding="utf-8") as f:
        rag = f.read()
    with open(os.path.join(KNOWLEDGE_DIR, "format-mom.md"), "r", encoding="utf-8") as f:
        mom_format = f.read()
    prompt = f"""Anda Merupakan Sekertaris yang sudah senior dengan pengalaman 20 tahun.

Tugas utama:
- Buat laporan Meeting Of Menites dengan mengikuti @backend/knowledge/format-mom.md.
- Revisi transkrip mentah menjadi catatan rapat yang lebih baik, rapi, profesional, objektif, dan mudah dipahami.
- Hasil yang ditampilkan dan disimpan sebagai `final_text` harus hasil olahan AI, bukan transkrip mentah.
- Jika ada koreksi makna atau kata pada catatan transkrip, contoh IRP menjadi ERP, selalu masukkan ke `corrections` agar backend menyimpan ke @backend/knowledge/corrections.md.
- Jika ada pengetahuan penting, contoh ERP adalah Enterprise Resource Planning, masukkan ke `concepts` agar backend menyimpan ke @backend/knowledge/concepts.md.
- Kata-kata penting beserta pengertiannya masukkan ke `terms` agar backend menyimpan ke @backend/knowledge/glossary.md.
- Gunakan @backend/knowledge/RAG.md sebelum mengolah transkrip.
- Jangan mengubah fakta rapat. Jika informasi tidak ada, tulis "Tidak disebutkan".
- Output wajib JSON valid, tanpa markdown fence.

Instruksi RAG.md:
{rag[:12000]}

Panduan format-mom.md:
{mom_format[:30000]}

Knowledge lama:
{_read_knowledge()}

Transkrip mentah:
{raw_text}

Output JSON schema:
{{"corrected_text":"string catatan rapat hasil revisi AI, bukan transkrip mentah","markdown":"string dokumen MoM final dalam Markdown sesuai format-mom.md","summary":"string","entities":["string"],"terms":[{{"term":"string","alias":["string"],"meaning":"string"}}],"corrections":[{{"wrong":"string","correct":"string","reason":"string"}}],"concepts":[{{"name":"string","description":"string"}}],"action_items":["string"],"notes":["string"]}}
"""
    try:
        return _call_ai_json(prompt), "completed"
    except Exception as e:
        logger.warning("AI correction failed: %s", e)
        return None, "failed"


def _call_ai_paraphrase(text: str, style: str):
    if not _ai_ready():
        raise RuntimeError("AI config belum siap")
    _ensure_knowledge_files()
    with open(os.path.join(KNOWLEDGE_DIR, "RAG.md"), "r", encoding="utf-8") as f:
        rag = f.read()
    prompt = f"""Anda adalah sekretaris senior berpengalaman 20 tahun.

Parafrase dokumen hasil transkrip AI berikut agar lebih {style or 'rapi, profesional, objektif, dan mudah dipahami'}.
Pertahankan fakta, struktur Markdown, keputusan, action item, PIC, deadline, istilah teknis, dan makna.
Gunakan RAG.md sebagai konteks. Jangan menambah fakta baru.
Output wajib JSON valid tanpa markdown fence.

RAG.md:
{rag[:12000]}

Dokumen:
{text}

Output JSON schema:
{{"text":"string hasil parafrase final dalam Markdown"}}
"""
    return _call_ai_json(prompt).get("text", "")


def _append_unique(path: str, marker: str, block: str):
    old = ""
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            old = f.read()
    if marker.lower() in old.lower():
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n" + block.strip() + "\n")


def _update_knowledge(job_id: str, ai_data: dict):
    if not (AI_ENABLE_KNOWLEDGE_EXTRACTION and ai_data):
        return
    _ensure_knowledge_files()
    for item in ai_data.get("terms", []) or []:
        term = item.get("term", "").strip()
        if term:
            _append_unique(os.path.join(KNOWLEDGE_DIR, "glossary.md"), f"## {term}", f"## {term}\n\n- Alias: {', '.join(item.get('alias', []) or [])}\n- Arti: {item.get('meaning', '')}\n- Sumber: job_id={job_id}")
    for item in ai_data.get("corrections", []) or []:
        wrong, correct = item.get("wrong", "").strip(), item.get("correct", "").strip()
        if wrong and correct:
            _append_unique(os.path.join(KNOWLEDGE_DIR, "corrections.md"), f"## {wrong} -> {correct}", f"## {wrong} -> {correct}\n\n- Salah dengar: {wrong}\n- Koreksi: {correct}\n- Alasan: {item.get('reason', '')}\n- Sumber: job_id={job_id}")
    for item in ai_data.get("concepts", []) or []:
        name = item.get("name", "").strip()
        if name:
            _append_unique(os.path.join(KNOWLEDGE_DIR, "concepts.md"), f"## {name}", f"## {name}\n\n- Deskripsi: {item.get('description', '')}\n- Sumber: job_id={job_id}")
    for note in ai_data.get("notes", []) or []:
        _append_unique(os.path.join(KNOWLEDGE_DIR, "transcript-notes.md"), f"- {note}", f"- {note} _(job_id={job_id})_")


def _render_markdown(job_id: str, filename: str, duration: float, final_text: str, ai_data: dict, ai_status: str):
    _ensure_knowledge_files()
    md = (ai_data or {}).get("markdown")
    if not md:
        md = f"""# Minutes of Meeting

## Informasi Rapat

| Informasi | Isi |
|---|---|
| **Nama File** | {filename} |
| **Tanggal Transkripsi** | {datetime.now().isoformat()} |
| **Durasi Audio** | {round(duration, 2)} detik |
| **Model STT** | {MODEL_SIZE} |
| **Koreksi AI** | {ai_status} |

## Ringkasan

{(ai_data or {}).get('summary') or 'Tidak ada'}

## Pembahasan

{final_text or 'Tidak ada'}

## Keputusan / Kesepakatan

Tidak disebutkan

## Tindak Lanjut (Action Items)

{_list_item((ai_data or {}).get('action_items'))}

## Catatan Tambahan

{_list_item((ai_data or {}).get('notes'))}
"""
    path = os.path.join(TRANSCRIPTS_MD_DIR, f"{job_id}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return path


def run_preflight(require_ai=False):
    _ensure_knowledge_files()
    try:
        ffmpeg_ok = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    except Exception:
        ffmpeg_ok = False
    checks = {
        "uploads_writable": os.access(UPLOAD_FOLDER, os.W_OK),
        "knowledge_readable": os.access(KNOWLEDGE_DIR, os.R_OK),
        "transcripts_md_writable": os.access(TRANSCRIPTS_MD_DIR, os.W_OK),
        "ffmpeg": ffmpeg_ok,
        "format_mom": os.path.exists(os.path.join(KNOWLEDGE_DIR, "format-mom.md")),
        "ai_config": (not require_ai) or _ai_ready(),
    }
    try:
        conn = get_db(); conn.close(); checks["database"] = True
    except Exception:
        checks["database"] = False
    return checks


def _save_transcript(original_filename: str, final_text: str, duration: float, word_ts, raw_text=None, ai_text=None, ai_summary=None, md_path=None, ai_status="skipped"):
    word_ts_json = json.dumps(word_ts, ensure_ascii=False) if word_ts else None
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO transcripts (filename, final_text, created_at, duration_s, word_timestamps, raw_text, ai_corrected_text, ai_summary, md_path, ai_correction_status) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (original_filename, final_text, datetime.now(), round(duration, 2), word_ts_json, raw_text, ai_text, ai_summary, md_path, ai_status),
    )
    conn.commit()
    new_id = cur.lastrowid
    cur.close(); conn.close()
    return new_id


def run_transcription_job(job_id: str, save_path: str, original_filename: str, word_timestamps: bool, ai_correction: bool, output_format: str):
    processed_path = None
    queued_at = time.perf_counter()
    file_size = os.path.getsize(save_path) if os.path.exists(save_path) else 0
    _set_status(job_id, "queued", queued_at=datetime.now().isoformat())
    socketio.emit("progress", {"job_id": job_id, "percent": 0, "elapsed_s": 0, "current_text": "", "stage": "Queued"}, room=job_id)

    with _transcription_lock:
        queue_s = time.perf_counter() - queued_at
        total_start = time.perf_counter()
        _set_status(job_id, "processing", started_at=datetime.now().isoformat(), queue_s=round(queue_s, 2))
        try:
            _set_status(job_id, "preflight")
            checks = run_preflight(require_ai=False)
            if not all(checks.values()):
                raise RuntimeError(f"Preflight gagal: {checks}")

            file_hash = calculate_file_hash(save_path)
            cache_key = _cache_key(file_hash, word_timestamps, ai_correction)
            cached = _read_cache(cache_key)
            if cached:
                md_path = _render_markdown(job_id, original_filename, cached["duration_s"], cached["final_text"], cached.get("ai_data"), cached.get("ai_correction_status", "skipped")) if output_format == "md" else None
                new_id = _save_transcript(original_filename, cached["final_text"], cached["duration_s"], cached.get("word_timestamps"), cached.get("raw_text"), cached.get("ai_corrected_text"), cached.get("ai_summary"), md_path, cached.get("ai_correction_status", "skipped"))
                md_url = f"/api/jobs/{job_id}/download-md" if md_path else None
                socketio.emit("done", {"job_id": job_id, "id": new_id, "filename": original_filename, **cached, "created_at": datetime.now().isoformat(), "cache_hit": True, "md_url": md_url}, room=job_id)
                _set_status(job_id, "completed", cache_hit=True, md_url=md_url)
                logger.info("job=%s cache=hit queue_s=%.2f total_s=%.2f size=%s model=%s", job_id, queue_s, time.perf_counter() - total_start, file_size, MODEL_SIZE)
                return

            socketio.emit("progress", {"job_id": job_id, "percent": 0, "elapsed_s": 0, "current_text": "", "stage": "Preprocessing audio..."}, room=job_id)
            processed_path, duration, preprocess_s = preprocess_audio(save_path)
            result, transcribe_s, align_s = transcribe_with_progress(processed_path, job_id, duration, word_timestamps)

            raw_text = " ".join(seg["text"].strip() for seg in result.get("segments", []) if seg.get("text"))
            final_text = postprocess(raw_text)
            ai_data, ai_status = (None, "skipped")
            ai_s = 0.0
            if ai_correction:
                _set_status(job_id, "correcting")
                start = time.perf_counter()
                ai_data, ai_status = _call_ai_correction(raw_text)
                ai_s = time.perf_counter() - start
                if ai_data:
                    final_text = ai_data.get("markdown") or ai_data.get("corrected_text") or final_text

            if ai_data:
                _set_status(job_id, "updating_knowledge")
                _update_knowledge(job_id, ai_data)

            word_ts = _extract_word_ts(result) if word_timestamps else []
            md_path = None
            if output_format == "md":
                _set_status(job_id, "generating_markdown")
                md_path = _render_markdown(job_id, original_filename, duration, final_text, ai_data, ai_status)
            md_url = f"/api/jobs/{job_id}/download-md" if md_path else None
            payload = {"final_text": final_text, "markdown_text": (ai_data or {}).get("markdown") or final_text, "duration_s": round(duration, 2), "word_timestamps": word_ts or None, "raw_text": None, "ai_corrected_text": final_text if ai_status == "completed" else None, "ai_summary": (ai_data or {}).get("summary"), "ai_correction_status": ai_status, "ai_data": ai_data}
            if ai_status != "failed":
                _write_cache(cache_key, payload)

            new_id = _save_transcript(original_filename, final_text, duration, word_ts, None, payload["ai_corrected_text"], payload["ai_summary"], md_path, ai_status)
            socketio.emit("done", {"job_id": job_id, "id": new_id, "filename": original_filename, **payload, "created_at": datetime.now().isoformat(), "cache_hit": False, "md_url": md_url}, room=job_id)
            _set_status(job_id, "completed", cache_hit=False, md_url=md_url, ai_correction_s=round(ai_s, 2))
            logger.info(
                "job=%s cache=miss queue_s=%.2f preprocess_s=%.2f transcribe_s=%.2f align_s=%.2f ai_s=%.2f total_s=%.2f size=%s audio_s=%.2f model=%s",
                job_id, queue_s, preprocess_s, transcribe_s, align_s, ai_s, time.perf_counter() - total_start, file_size, duration, MODEL_SIZE,
            )
        except Exception as e:
            logger.exception("[%s] Error", job_id)
            _set_status(job_id, "failed", error=str(e))
            socketio.emit("error", {"job_id": job_id, "message": str(e)}, room=job_id)
        finally:
            for p in [save_path, processed_path]:
                if p and os.path.exists(p):
                    os.remove(p)


@socketio.on("connect")
def on_connect():
    logger.info("Client terhubung: %s", request.sid)


@socketio.on("disconnect")
def on_disconnect():
    logger.info("Client putus: %s", request.sid)


@socketio.on("join_job")
def on_join_job(data):
    from flask_socketio import join_room
    job_id = data.get("job_id")
    if job_id:
        join_room(job_id)
        emit("job_status", {"job_id": job_id, **_get_status(job_id)})
        logger.info("Client %s bergabung room %s", request.sid, job_id)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "model": MODEL_SIZE,
        "batch_size": BATCH_SIZE,
        "cpu_threads": CPU_THREADS,
        "denoise": ENABLE_DENOISE,
        "ai_correction_enabled": AI_ENABLE_CORRECTION and _ai_ready(),
        "rag_enabled": AI_ENABLE_RAG,
        "knowledge_ready": os.path.isdir(KNOWLEDGE_DIR),
    })


@app.route("/api/preflight", methods=["GET"])
def preflight():
    checks = run_preflight(require_ai=str(request.args.get("ai", "false")).lower() in {"1", "true", "yes", "on"})
    return jsonify({"status": "ok" if all(checks.values()) else "failed", "checks": checks}), 200 if all(checks.values()) else 500


@app.route("/api/jobs/<job_id>", methods=["GET"])
def get_job(job_id):
    status = _get_status(job_id)
    if not status:
        return jsonify({"error": "Job tidak ditemukan"}), 404
    return jsonify({"job_id": job_id, **status})


@app.route("/api/jobs/<job_id>/download-md", methods=["GET"])
def download_job_md(job_id):
    path = os.path.join(TRANSCRIPTS_MD_DIR, f"{job_id}.md")
    if not os.path.exists(path):
        return jsonify({"error": "Markdown tidak ditemukan"}), 404
    return send_file(path, mimetype="text/markdown", as_attachment=True, download_name=f"transcript-{job_id}.md")


@app.route("/api/paraphrase", methods=["POST"])
def paraphrase_text():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    style = (data.get("style") or "").strip()
    if not text:
        return jsonify({"error": "Teks kosong"}), 400
    try:
        return jsonify({"text": _call_ai_paraphrase(text, style)})
    except Exception as e:
        logger.warning("AI paraphrase failed: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/transcripts/<int:transcript_id>/download-md", methods=["GET"])
def download_transcript_md(transcript_id):
    try:
        conn = get_db()
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT filename, md_path FROM transcripts WHERE id = %s", (transcript_id,))
        row = cur.fetchone()
        cur.close(); conn.close()
        if not row or not row.get("md_path") or not os.path.exists(row["md_path"]):
            return jsonify({"error": "Markdown tidak ditemukan"}), 404
        return send_file(row["md_path"], mimetype="text/markdown", as_attachment=True, download_name=f"transcript-{row['filename']}.md")
    except Error as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transcripts", methods=["GET"])
def get_transcripts():
    try:
        conn = get_db()
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id, filename, final_text, created_at, duration_s, word_timestamps, ai_correction_status, md_path FROM transcripts ORDER BY created_at DESC LIMIT 50")
        rows = cur.fetchall()
        cur.close(); conn.close()
        for row in rows:
            if isinstance(row["created_at"], datetime):
                row["created_at"] = row["created_at"].isoformat()
            if isinstance(row.get("word_timestamps"), str):
                row["word_timestamps"] = json.loads(row["word_timestamps"])
            if row.get("md_path"):
                row["md_url"] = f"/api/transcripts/{row['id']}/download-md"
        return jsonify(rows)
    except Error as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/upload-and-transcribe", methods=["POST"])
def upload_and_transcribe():
    if "audioFile" not in request.files:
        return jsonify({"error": "Tidak ada file audio"}), 400

    file = request.files["audioFile"]
    if not file.filename:
        return jsonify({"error": "Nama file kosong"}), 400

    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Format tidak didukung: .{ext}"}), 400

    word_timestamps = str(request.form.get("word_timestamps", "false")).lower() in {"1", "true", "yes", "on"}
    ai_correction = str(request.form.get("ai_correction", "false")).lower() in {"1", "true", "yes", "on"}
    output_format = "md" if str(request.form.get("output_format", "")).lower() == "md" else "json"
    job_id = uuid.uuid4().hex
    save_path = os.path.join(UPLOAD_FOLDER, f"{job_id}.{ext}")
    file.save(save_path)

    threading.Thread(target=run_transcription_job, args=(job_id, save_path, file.filename, word_timestamps, ai_correction, output_format), daemon=True).start()
    return jsonify({"job_id": job_id, "filename": file.filename, "status": "queued", "word_timestamps": word_timestamps, "ai_correction": ai_correction, "output_format": output_format})


if __name__ == "__main__":
    init_db()
    socketio.run(app, host="0.0.0.0", port=8081, debug=False)
