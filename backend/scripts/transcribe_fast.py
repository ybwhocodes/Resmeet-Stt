"""A single resident model serves JSONL requests; no transcript context crosses requests."""
import argparse
import json
import sys
import time


def emit(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def load_audio(path):
    import wave
    import numpy as np
    with wave.open(path, "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
            raise ValueError("Worker membutuhkan WAV mono PCM16 16 kHz.")
        return np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768.0


class NoSpeechError(ValueError):
    pass


def transcribe(model, request, batch_size, beam_size):
    from faster_whisper import BatchedInferencePipeline
    started = time.monotonic()
    # A fresh pipeline prevents per-request timestamp/VAD state from crossing jobs.
    pipeline = BatchedInferencePipeline(model) if batch_size > 1 else model
    extra = {"batch_size": batch_size} if batch_size > 1 else {}
    segments, info = pipeline.transcribe(
        load_audio(request["audio"]), language="id", beam_size=beam_size, best_of=1,
        temperature=0.0,
        condition_on_previous_text=False, without_timestamps=False, **extra,
        vad_filter=True, vad_parameters={"threshold": 0.50, "min_speech_duration_ms": 150,
            "min_silence_duration_ms": 150, "speech_pad_ms": 50},
    )
    emit({"type": "info", "duration_s": info.duration, "speech_duration_s": info.duration_after_vad})
    count = 0
    for segment in segments:
        text = segment.text.strip()
        if text:
            emit({"type": "segment", "start": segment.start, "end": segment.end, "text": text})
            count += 1
    if not count:
        raise NoSpeechError("Tidak ada percakapan yang terdeteksi dalam bagian audio.")
    emit({"type": "done", "duration_s": info.duration, "speech_duration_s": info.duration_after_vad,
          "generation_time_s": time.monotonic() - started})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio")
    parser.add_argument("--resident", action="store_true")
    parser.add_argument("--model", required=True)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--beam-size", type=int, default=1)
    args = parser.parse_args()
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=args.threads,
                         num_workers=1, local_files_only=True)
    if not args.resident:
        transcribe(model, {"audio": args.audio}, args.batch_size, args.beam_size)
        return
    emit({"type": "ready"})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            transcribe(model, request, args.batch_size, args.beam_size)
        except Exception as error:
            emit({"type": "error", "error": str(error),
                  "kind": "no_speech" if isinstance(error, NoSpeechError) else "runtime"})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "error", "error": str(error), "kind": "runtime"})
        sys.exit(1)
