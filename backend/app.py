"""
STT Backend - Python Flask + Socket.IO
WhisperX (batched faster-whisper + Silero VAD + wav2vec2 alignment) + MySQL
Progress transkripsi dikirim realtime via WebSocket ke frontend.
"""

import os
import re
import json
import uuid
import logging
import threading
import numpy as np

_cpu = str(os.cpu_count() or 4)
for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(k, _cpu)

import librosa
import soundfile as sf
import noisereduce as nr
import whisperx

from datetime import datetime
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from scipy.signal import butter, filtfilt
import mysql.connector
from mysql.connector import Error

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "stt-secret-key")
CORS(app, resources={r"/*": {"origins": "*"}})

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

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

ENV_PATH         = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
MODEL_SIZE       = os.getenv("WHISPER_MODEL", "large-v3-turbo")
MODEL_DIR        = os.getenv("MODEL_DIR", "").strip()
COMPUTE_TYPE     = os.getenv("COMPUTE_TYPE", "int8")
DEVICE           = os.getenv("DEVICE", "cpu")
CPU_THREADS      = int(os.getenv("CPU_THREADS", _cpu))
BATCH_SIZE       = int(os.getenv("BATCH_SIZE", "16"))

_DEFAULT_MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
if not MODEL_DIR:
    MODEL_DIR = _DEFAULT_MODEL_DIR

MODEL_LOCAL_PATH = os.path.join(MODEL_DIR, MODEL_SIZE)

_whisper_pipeline = None
_align_model = None
_align_metadata = None


def _update_env_file(key: str, value: str):
    new_line = f"{key}={value}\n"
    try:
        lines = open(ENV_PATH, "r", encoding="utf-8").readlines() if os.path.exists(ENV_PATH) else []
        updated = False
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("#") or "=" not in stripped:
                continue
            if stripped.split("=", 1)[0].strip() == key:
                lines[i] = new_line
                updated   = True
                break
        if not updated:
            lines.append(new_line)
        with open(ENV_PATH, "w", encoding="utf-8") as f:
            f.writelines(lines)
        logger.info(f".env diperbarui: {key}={value}")
    except Exception as e:
        logger.warning(f"Gagal update .env: {e}")


# ponytail: whisperx.load_model wraps WhisperModel + Silero VAD in one call
def load_model():
    global _whisper_pipeline, MODEL_DIR, MODEL_LOCAL_PATH
    if _whisper_pipeline is not None:
        return _whisper_pipeline

    os.makedirs(MODEL_DIR, exist_ok=True)
    model_exists = (
        os.path.isdir(MODEL_LOCAL_PATH) and
        any(f.endswith(".bin") for f in os.listdir(MODEL_LOCAL_PATH))
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

    env_model_dir = os.getenv("MODEL_DIR", "").strip()
    if not env_model_dir or env_model_dir != MODEL_DIR:
        _update_env_file("MODEL_DIR", MODEL_DIR)
        os.environ["MODEL_DIR"] = MODEL_DIR

    logger.info(f"WhisperX pipeline siap. Device={DEVICE}, compute_type={COMPUTE_TYPE}, threads={CPU_THREADS}")
    return _whisper_pipeline


def load_align():
    global _align_model, _align_metadata
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
    sqls = [
        """
        CREATE TABLE IF NOT EXISTS transcripts (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            filename        VARCHAR(255) NOT NULL,
            final_text      LONGTEXT     NOT NULL,
            created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            duration_s      FLOAT        DEFAULT NULL,
            language        VARCHAR(10)  DEFAULT 'id',
            word_timestamps JSON         DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """,
    ]
    try:
        conn = get_db()
        cur  = conn.cursor()
        for sql in sqls:
            cur.execute(sql)
        # ponytail: ALTER TABLE to add column if table already exists without it
        try:
            cur.execute("ALTER TABLE transcripts ADD COLUMN word_timestamps JSON DEFAULT NULL")
        except Exception:
            pass
        conn.commit()
        cur.close(); conn.close()
        logger.info("Database initialized.")
    except Error as e:
        logger.error(f"DB init error: {e}")


def butter_filter(audio, sr, cutoff, filter_type="highpass", order=5):
    nyq = 0.5 * sr
    b, a = butter(order, cutoff / nyq, btype=filter_type, analog=False)
    return filtfilt(b, a, audio)


def preprocess_audio(input_path: str, target_sr: int = 16000):
    audio, sr = librosa.load(input_path, sr=target_sr, mono=True)
    audio, _  = librosa.effects.trim(audio, top_db=25)
    audio     = nr.reduce_noise(y=audio, sr=sr, stationary=False, prop_decrease=0.45)
    audio     = butter_filter(audio, sr, 80,   filter_type="highpass", order=4)
    audio     = butter_filter(audio, sr, 7600, filter_type="lowpass",  order=4)
    peak      = np.max(np.abs(audio))
    if peak > 0:
        audio = audio / peak * 0.95
    audio     = np.clip(audio, -1.0, 1.0)

    output = os.path.splitext(input_path)[0] + "_processed.wav"
    sf.write(output, audio, target_sr)
    return output, len(audio) / target_sr


def transcribe_with_progress(audio_path: str, job_id: str, total_duration: float) -> dict:
    pipeline = load_model()

    def _emit(event: str, data: dict):
        socketio.emit(event, {"job_id": job_id, **data}, room=job_id)

    _emit("progress", {
        "percent": 0, "elapsed_s": 0, "current_text": "", "stage": "Memulai transkripsi…",
    })

    audio = whisperx.load_audio(audio_path)

    # ponytail: whisperx progress_callback gives 0-100 float, pipe straight to frontend
    def on_progress(pct):
        clamped = min(round(pct, 1), 95.0)
        _emit("progress", {
            "percent":      clamped,
            "elapsed_s":    round(total_duration * clamped / 100, 1),
            "current_text": "",
            "stage":        f"Memproses {clamped}%",
        })

    result = pipeline.transcribe(
        audio,
        batch_size=BATCH_SIZE,
        progress_callback=on_progress,
    )

    lang = result.get("language", "id")
    logger.info(f"[{job_id}] Bahasa terdeteksi: {lang}")

    # Step 3: alignment for word-level timestamps
    _emit("progress", {
        "percent": 96, "elapsed_s": round(total_duration, 1),
        "current_text": "", "stage": "Aligning word timestamps…",
    })

    align_model, align_meta = load_align()
    aligned = whisperx.align(
        result["segments"],
        align_model,
        align_meta,
        audio,
        device=DEVICE,
    )

    return aligned


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
    out   = []
    for i in range(0, len(parts), 2):
        s = parts[i].strip()
        p = parts[i + 1] if i + 1 < len(parts) else "."
        if s:
            out.append(s[0].upper() + s[1:] + p)
    return " ".join(out).strip()


def postprocess(text: str) -> str:
    return sentence_case(clean_text(text))


def run_transcription_job(job_id: str, save_path: str, original_filename: str):
    processed_path = None
    try:
        socketio.emit("progress", {
            "job_id": job_id, "percent": 0, "elapsed_s": 0,
            "current_text": "", "stage": "Preprocessing audio (denoise, filter)…",
        }, room=job_id)

        processed_path, duration = preprocess_audio(save_path)

        aligned = transcribe_with_progress(processed_path, job_id, duration)

        raw_text = " ".join(seg["text"].strip() for seg in aligned["segments"] if seg.get("text"))
        final_text = postprocess(raw_text)

        # ponytail: extract word timestamps from aligned segments, store as JSON
        word_ts = []
        for seg in aligned.get("segments", []):
            for w in seg.get("words", []):
                entry = {"word": w.get("word", ""), "start": w.get("start"), "end": w.get("end")}
                if entry["start"] is not None:
                    word_ts.append(entry)
        word_ts_json = json.dumps(word_ts, ensure_ascii=False) if word_ts else None

        socketio.emit("progress", {
            "job_id": job_id, "percent": 99, "elapsed_s": round(duration, 1),
            "current_text": "", "stage": "Menyimpan ke database…",
        }, room=job_id)

        conn = get_db()
        cur  = conn.cursor()
        cur.execute(
            "INSERT INTO transcripts (filename, final_text, created_at, duration_s, word_timestamps) "
            "VALUES (%s, %s, %s, %s, %s)",
            (original_filename, final_text, datetime.now(), round(duration, 2), word_ts_json)
        )
        conn.commit()
        new_id = cur.lastrowid
        cur.close(); conn.close()

        socketio.emit("done", {
            "job_id":     job_id,
            "id":         new_id,
            "filename":   original_filename,
            "final_text": final_text,
            "duration_s": round(duration, 2),
            "created_at": datetime.now().isoformat(),
        }, room=job_id)

    except Exception as e:
        logger.exception(f"[{job_id}] Error")
        socketio.emit("error", {"job_id": job_id, "message": str(e)}, room=job_id)

    finally:
        for p in [save_path, processed_path]:
            if p and os.path.exists(p):
                os.remove(p)


@socketio.on("connect")
def on_connect():
    logger.info(f"Client terhubung: {request.sid}")


@socketio.on("disconnect")
def on_disconnect():
    logger.info(f"Client putus: {request.sid}")


@socketio.on("join_job")
def on_join_job(data):
    from flask_socketio import join_room
    job_id = data.get("job_id")
    if job_id:
        join_room(job_id)
        logger.info(f"Client {request.sid} bergabung room {job_id}")


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status":       "ok",
        "device":       DEVICE,
        "compute_type": COMPUTE_TYPE,
        "model":        MODEL_SIZE,
        "batch_size":   BATCH_SIZE,
    })


@app.route("/api/transcripts", methods=["GET"])
def get_transcripts():
    try:
        conn = get_db()
        cur  = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT id, filename, final_text, created_at, duration_s, word_timestamps "
            "FROM transcripts ORDER BY created_at DESC LIMIT 50"
        )
        rows = cur.fetchall()
        cur.close(); conn.close()
        for row in rows:
            if isinstance(row["created_at"], datetime):
                row["created_at"] = row["created_at"].isoformat()
            if isinstance(row.get("word_timestamps"), str):
                row["word_timestamps"] = json.loads(row["word_timestamps"])
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

    job_id    = uuid.uuid4().hex
    save_path = os.path.join(UPLOAD_FOLDER, f"{job_id}.{ext}")
    file.save(save_path)

    t = threading.Thread(
        target=run_transcription_job,
        args=(job_id, save_path, file.filename),
        daemon=True,
    )
    t.start()

    return jsonify({"job_id": job_id, "filename": file.filename})


if __name__ == "__main__":
    init_db()
    socketio.run(app, host="0.0.0.0", port=8081, debug=False)
