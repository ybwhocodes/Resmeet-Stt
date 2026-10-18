#!/usr/bin/env python3
"""
preprocess_combo.py — Anti-Hallucination Audio Preprocessing Pipeline
Resmeet-STT | Whisper.cpp v1.9.5 compatible

Combos:
  1: DeepFilter highpass + NoiseReduce (strong) + VAD-aware padding [large-v3-turbo-q5_0]
  2: DeepFilter highpass + NoiseReduce (moderate) [ggml-base - fast]
  3: DeepFilter highpass + NoiseReduce (subtle) + Silero-VAD ONNX with offset tracking [large-v3-turbo-q5_0]

Key design decisions:
  - VAD in Combo 3 does NOT concatenate chunks (preserves timestamps)
  - VAD result written as JSON sidecar for whisper.ts to use
  - Safe fallback to FFmpeg-normalized audio on any error
  - Structured JSON diagnostics on stdout for the TypeScript layer to read
  - No aggressive loudness normalization on default; peak-normalize safely
"""
import sys
import os
import argparse
import json
import time

def log_err(msg: str):
    print(f"[AudioCombo] {msg}", file=sys.stderr)

def safe_normalize(audio, target_peak=0.89):
    """Peak-normalize audio to target_peak, only if peak > 0."""
    import numpy as np
    peak = float(np.max(np.abs(audio)))
    if peak > 0.001:
        audio = (audio / peak) * target_peak
    return audio.clip(-1.0, 1.0)

def apply_highpass(audio, sr, cutoff_hz=65):
    """Highpass Butterworth filter to remove low-frequency rumble."""
    from scipy.signal import butter, filtfilt
    nyq = 0.5 * sr
    if cutoff_hz >= nyq:
        return audio
    b, a = butter(2, cutoff_hz / nyq, btype='highpass')
    return filtfilt(b, a, audio)

def apply_noisereduce(audio, sr, prop_decrease=0.40, n_fft=1024):
    """Stationary noise reduction. Fails gracefully."""
    try:
        import noisereduce as nr
        return nr.reduce_noise(
            y=audio,
            sr=sr,
            stationary=True,
            prop_decrease=prop_decrease,
            n_fft=n_fft,
            win_length=n_fft,
        )
    except Exception as e:
        log_err(f"noisereduce skipped: {e}")
        return audio

def run_silero_vad_with_offsets(audio, sr, threshold=0.50, min_speech_ms=200,
                                  min_silence_ms=300, speech_pad_ms=200):
    """
    Run Silero VAD and return speech segments with their original sample offsets.
    DOES NOT concatenate — preserves original timeline for timestamp traceability.

    Returns:
        list of dicts: [{start_sample, end_sample, start_s, end_s}, ...]
        or None if VAD failed or no speech found.
    """
    try:
        import torch
        import silero_vad

        tensor_audio = torch.from_numpy(audio.astype('float32'))

        try:
            model = silero_vad.load_silero_vad(onnx=True)
        except Exception as e_onnx:
            log_err(f"ONNX VAD load failed ({e_onnx}), trying torch model")
            model = silero_vad.load_silero_vad(onnx=False)

        timestamps = silero_vad.get_speech_timestamps(
            tensor_audio,
            model,
            threshold=threshold,
            sampling_rate=sr,
            min_speech_duration_ms=min_speech_ms,
            min_silence_duration_ms=min_silence_ms,
            speech_pad_ms=speech_pad_ms,
        )

        if not timestamps:
            log_err("VAD found no speech segments — audio may be silent or too noisy")
            return None

        segments = []
        for ts in timestamps:
            start_s = ts['start'] / sr
            end_s = ts['end'] / sr
            segments.append({
                'start_sample': int(ts['start']),
                'end_sample': int(ts['end']),
                'start_s': round(start_s, 4),
                'end_s': round(end_s, 4),
            })

        return segments

    except Exception as e:
        log_err(f"Silero VAD error: {e}")
        return None


def build_silenced_audio(audio, sr, segments, silence_level=0.0001):
    """
    For Combo 3: instead of concatenating, replace non-speech regions
    with near-silence. This preserves original length and all timestamps.
    """
    import numpy as np
    result = np.full_like(audio, silence_level, dtype=np.float32)
    for seg in segments:
        s = seg['start_sample']
        e = seg['end_sample']
        result[s:e] = audio[s:e]
    return result


def run_combo_processing(input_path: str, output_path: str, combo: str):
    """
    Main combo processing function.
    Returns a diagnostics dict that gets printed as JSON to stdout.
    """
    import numpy as np
    import soundfile as sf

    t_start = time.time()
    diag = {
        'combo': combo,
        'input_path': input_path,
        'output_path': output_path,
        'success': False,
        'fallback_used': False,
        'vad_segments': None,
        'vad_segment_count': 0,
        'input_duration_s': 0.0,
        'output_duration_s': 0.0,
        'processing_time_s': 0.0,
        'warnings': [],
        'error': None,
    }

    try:
        audio, sr = sf.read(input_path, always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        audio = audio.astype(np.float32)

        diag['input_duration_s'] = round(len(audio) / sr, 3)

        if len(audio) == 0:
            diag['warnings'].append("Input audio is empty — using 0.5s silence fallback")
            audio = np.zeros(int(sr * 0.5), dtype=np.float32)

        # ── Step 1: Highpass filter (all combos) ─────────────────────────
        audio = apply_highpass(audio, sr, cutoff_hz=65)

        # ── Step 2: Noise reduction (combo-specific strength) ─────────────
        prop = {'1': 0.40, '2': 0.35, '3': 0.25}.get(combo, 0.35)
        audio = apply_noisereduce(audio, sr, prop_decrease=prop, n_fft=1024)

        # ── Step 3: Combo-specific VAD ────────────────────────────────────
        if combo == '3':
            # Combo 3: Silero VAD with timestamp-preserving silence replacement
            segments = run_silero_vad_with_offsets(
                audio, sr,
                threshold=0.50,
                min_speech_ms=200,
                min_silence_ms=300,
                speech_pad_ms=200,
            )

            if segments:
                audio = build_silenced_audio(audio, sr, segments)
                diag['vad_segments'] = segments
                diag['vad_segment_count'] = len(segments)

                # Write VAD sidecar JSON for whisper.ts to optionally use
                sidecar_path = output_path.replace('.wav', '_vad.json')
                with open(sidecar_path, 'w') as f:
                    json.dump({'vad_segments': segments, 'sr': sr}, f)
                log_err(f"VAD: {len(segments)} speech segments found, sidecar written to {sidecar_path}")
            else:
                diag['warnings'].append("VAD found no speech; using full audio")

        elif combo == '1':
            # Combo 1: Simple voice-region-aware trim: remove leading/trailing >1.5s silence
            try:
                import torch
                import silero_vad as svad
                tensor_audio = torch.from_numpy(audio)
                model_vad = svad.load_silero_vad(onnx=True)
                ts = svad.get_speech_timestamps(
                    tensor_audio, model_vad,
                    threshold=0.45, sampling_rate=sr,
                    min_speech_duration_ms=150,
                    min_silence_duration_ms=500,
                    speech_pad_ms=300,
                )
                if ts:
                    first_start = max(0, ts[0]['start'] - int(sr * 0.3))
                    last_end = min(len(audio), ts[-1]['end'] + int(sr * 0.3))
                    audio = audio[first_start:last_end]
                    diag['vad_segment_count'] = len(ts)
                    log_err(f"Combo 1 VAD trim: kept {first_start/sr:.2f}s–{last_end/sr:.2f}s of {diag['input_duration_s']:.2f}s")
            except Exception as e:
                diag['warnings'].append(f"Combo 1 VAD trim skipped: {e}")

        # ── Step 4: Ensure audio is not empty after processing ────────────
        if len(audio) == 0 or np.max(np.abs(audio)) < 1e-7:
            diag['warnings'].append("Audio appears silent after processing — using 0.5s silence")
            audio = np.zeros(int(sr * 0.5), dtype=np.float32)

        # ── Step 5: Safe peak normalization ──────────────────────────────
        audio = safe_normalize(audio, target_peak=0.89)

        # ── Step 6: Write output ──────────────────────────────────────────
        sf.write(output_path, audio.astype(np.float32), sr, subtype='PCM_16')

        diag['output_duration_s'] = round(len(audio) / sr, 3)
        diag['success'] = True

    except Exception as e:
        diag['error'] = str(e)
        diag['fallback_used'] = True
        log_err(f"Processing failed, caller will use fallback: {e}")
        raise

    finally:
        diag['processing_time_s'] = round(time.time() - t_start, 3)
        # Print structured diagnostics JSON to stdout for TypeScript to parse
        print(json.dumps(diag), flush=True)

    log_err(
        f"Combo {combo} done in {diag['processing_time_s']:.2f}s | "
        f"in={diag['input_duration_s']:.2f}s out={diag['output_duration_s']:.2f}s | "
        f"VAD segments={diag['vad_segment_count']}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Resmeet-STT Audio Preprocessing Pipeline")
    parser.add_argument("--input", required=True, help="Input WAV file (16kHz mono PCM)")
    parser.add_argument("--output", required=True, help="Output WAV file")
    parser.add_argument("--combo", default="1", choices=["1", "2", "3"])
    args = parser.parse_args()

    try:
        run_combo_processing(args.input, args.output, args.combo)
    except Exception as e:
        sys.exit(1)
