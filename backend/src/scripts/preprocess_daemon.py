#!/usr/bin/env python3
"""
Resmeet Persistent Audio Preprocessor Daemon.
Keeps PyTorch, Scipy, NoiseReduce, Pydub, and Silero VAD in RAM.
Eliminates 2.8s Python import overhead per request.
Listens on 127.0.0.1:8179.
"""

import sys
import os
import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# Pre-import heavy scientific libraries once at daemon startup
print("[PreprocessDaemon] Pre-loading audio processing libraries into RAM...", file=sys.stderr)
t_start = time.time()
import soundfile as sf
import numpy as np
from scipy.signal import butter, filtfilt, medfilt
import noisereduce as nr

try:
    from pydub import AudioSegment
    HAS_PYDUB = True
except Exception:
    HAS_PYDUB = False

# Import preprocessing logic from preprocess_combo
sys.path.insert(0, os.path.dirname(__file__))
from preprocess_combo import (
    safe_normalize,
    apply_highpass,
    apply_bandpass,
    apply_spectral_smoothing,
    apply_speech_agc,
    apply_noisereduce,
    run_silero_vad_with_offsets,
    detect_speech_with_pydub,
    build_silenced_audio,
)

print(f"[PreprocessDaemon] Libraries loaded in {time.time() - t_start:.2f}s. Ready for requests.", file=sys.stderr)

class PreprocessHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default HTTP request access logging
        pass

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","daemon":"resmeet-preprocessor"}\n')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/preprocess":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        try:
            req = json.loads(post_data.decode("utf-8"))
        except Exception as e:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"Invalid JSON: {e}"}).encode("utf-8"))
            return

        input_path = req.get("input_path")
        output_path = req.get("output_path")
        combo = str(req.get("combo", "1"))

        if not input_path or not output_path or not os.path.exists(input_path):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"Input file not found: {input_path}"}).encode("utf-8"))
            return

        t0 = time.time()
        diag = {
            "combo": combo,
            "input_path": input_path,
            "output_path": output_path,
            "success": False,
            "fallback_used": False,
            "vad_segments": None,
            "vad_segment_count": 0,
            "input_duration_s": 0.0,
            "output_duration_s": 0.0,
            "processing_time_s": 0.0,
            "warnings": [],
            "error": None,
        }

        try:
            audio, sr = sf.read(input_path, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)

            diag["input_duration_s"] = round(len(audio) / sr, 3)

            # Step 1: Bandpass Vocal + Rumble Cut
            audio = apply_highpass(audio, sr, cutoff_hz=65)
            audio = apply_bandpass(audio, sr, low_hz=80, high_hz=7500)
            audio = apply_spectral_smoothing(audio, kernel_size=3)
            try:
                audio = apply_speech_agc(audio, sr, target_rms=0.08, max_gain=2.5)
            except Exception as e_agc:
                diag["warnings"].append(f"Speech AGC skipped: {e_agc}")

            # Step 2: NoiseReduce Spectral Gating
            audio = apply_noisereduce(audio, sr, prop_decrease=0.30, n_fft=1024)

            # Step 3: Silero VAD
            segments = run_silero_vad_with_offsets(
                audio, sr,
                threshold=0.50,
                min_speech_ms=200,
                min_silence_ms=300,
                speech_pad_ms=200,
            )

            if not segments and HAS_PYDUB:
                pydub_segs = detect_speech_with_pydub(input_path)
                if pydub_segs:
                    segments = pydub_segs
                    diag["warnings"].append("Silero VAD fallback: used pydub non-silent intervals")

            if segments:
                audio = build_silenced_audio(audio, sr, segments)
                diag["vad_segments"] = segments
                diag["vad_segment_count"] = len(segments)

                sidecar_path = output_path.replace(".wav", "_vad.json")
                try:
                    with open(sidecar_path, "w") as f:
                        json.dump({"vad_segments": segments, "sr": sr}, f)
                except Exception as e_sc:
                    diag["warnings"].append(f"Sidecar write skipped: {e_sc}")

            # Safe Peak Normalization
            audio = safe_normalize(audio, target_peak=0.89)

            # Write Output
            sf.write(output_path, audio.astype(np.float32), sr, subtype="PCM_16")

            diag["output_duration_s"] = round(len(audio) / sr, 3)
            diag["success"] = True

        except Exception as e:
            diag["error"] = str(e)
            diag["fallback_used"] = True
            print(f"[PreprocessDaemon] Error: {e}", file=sys.stderr)

        diag["processing_time_s"] = round(time.time() - t0, 3)

        self.send_response(200 if diag["success"] else 500)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(diag).encode("utf-8"))

def main():
    port = int(os.environ.get("PREPROCESS_PORT", 8179))
    server = HTTPServer(("127.0.0.1", port), PreprocessHandler)
    print(f"[PreprocessDaemon] Running at http://127.0.0.1:{port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
