#!/usr/bin/env python3
"""
transcribe_model2.py — Model 2: Faster-Whisper Turbo Engine (CTranslate2)
Part of Resmeet-STT Streamlined Dual-Engine Architecture
"""
import sys
import os
import argparse
import json
import time

def log_err(msg: str):
    print(f"[Model2-FasterWhisper] {msg}", file=sys.stderr, flush=True)

def run_transcription(audio_path: str, output_prefix: str, language: str = "id", word_timestamps: bool = False, temperature: float = 0.0):
    from faster_whisper import WhisperModel

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    model_dir = os.environ.get("MODEL_DIR", os.path.join(base_dir, "models"))
    
    # Check possible locations for faster-whisper turbo
    candidates = [
        os.path.join(model_dir, "faster-whisper-large-v3-turbo"),
        os.path.join(model_dir, "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo", "snapshots", "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"),
        "large-v3-turbo",
    ]

    selected_model = None
    for c in candidates:
        if os.path.exists(c):
            selected_model = c
            break
    if not selected_model:
        selected_model = "large-v3-turbo"

    log_err(f"Loading Faster-Whisper model from: {selected_model}")

    cpu_threads = int(os.environ.get("CPU_THREADS", "4"))
    model = WhisperModel(
        selected_model,
        device="cpu",
        compute_type="int8",
        download_root=model_dir,
        cpu_threads=cpu_threads,
    )

    log_err(f"Starting Faster-Whisper inference on {audio_path} (temp={temperature})...")
    t_start = time.time()

    segments_gen, info = model.transcribe(
        audio_path,
        language=language,
        temperature=temperature,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=300),
        word_timestamps=word_timestamps,
        beam_size=3,
        best_of=3,
        repetition_penalty=1.05,
        no_repeat_ngram_size=3,
    )

    segments_data = []
    full_text_list = []
    total_dur = max(float(info.duration or 0), 1.0)

    for seg in segments_gen:
        pct = min(int((seg.end / total_dur) * 95), 95)
        # Emit progress format recognized by whisper.ts parser
        print(f"[{format_ts(seg.start)} --> {format_ts(seg.end)}] {seg.text.strip()}", flush=True)

        seg_item = {
            "timestamps": {
                "from": format_ts(seg.start),
                "to": format_ts(seg.end),
            },
            "offsets": {
                "from": int(seg.start * 1000),
                "to": int(seg.end * 1000),
            },
            "text": seg.text.strip(),
        }

        if word_timestamps and seg.words:
            seg_item["words"] = [
                {
                    "word": w.word,
                    "timestamps": {
                        "from": format_ts(w.start),
                        "to": format_ts(w.end),
                    },
                    "offsets": {
                        "from": int(w.start * 1000),
                        "to": int(w.end * 1000),
                    },
                }
                for w in seg.words
            ]

        segments_data.append(seg_item)
        full_text_list.append(seg.text.strip())

    output_json = f"{output_prefix}.json"
    result_json = {
        "transcription": segments_data,
        "text": " ".join(full_text_list),
        "duration": round(info.duration, 2),
        "language": info.language,
        "engine": "faster-whisper-large-v3-turbo",
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(result_json, f, ensure_ascii=False, indent=2)

    elapsed = round(time.time() - t_start, 2)
    log_err(f"Completed in {elapsed}s: {len(segments_data)} segments saved to {output_json}")

def format_ts(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Model 2: Faster-Whisper Turbo Runner")
    parser.add_argument("--audio", required=True, help="Input WAV file")
    parser.add_argument("--output", required=True, help="Output prefix path (without .json)")
    parser.add_argument("--lang", default="id", help="Language code")
    parser.add_argument("--word-timestamps", action="store_true", help="Include word-level timestamps")
    parser.add_argument("--temperature", type=float, default=0.0, help="Inference temperature")
    args = parser.parse_args()

    try:
        run_transcription(args.audio, args.output, args.lang, args.word_timestamps, args.temperature)
    except Exception as e:
        log_err(f"Fatal error: {e}")
        sys.exit(1)
