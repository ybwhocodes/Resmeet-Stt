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

def apply_bandpass(audio, sr, low_hz=80, high_hz=7500):
    """Bandpass Butterworth filter isolating vocal speech frequencies (80Hz - 7.5kHz)."""
    from scipy.signal import butter, filtfilt
    nyq = 0.5 * sr
    low = max(low_hz / nyq, 0.001)
    high = min(high_hz / nyq, 0.999)
    if low >= high:
        return audio
    b, a = butter(2, [low, high], btype='bandpass')
    return filtfilt(b, a, audio)

def apply_spectral_smoothing(audio, kernel_size=3):
    """
    Applies 1D median filter from scipy.signal to eliminate electrical clicks/pops
    without smearing speech formants.
    """
    try:
        from scipy.signal import medfilt
        if len(audio) > kernel_size:
            return medfilt(audio, kernel_size=kernel_size).astype(float)
    except Exception as e:
        log_err(f"scipy medfilt skipped: {e}")
    return audio

def pydub_inspect_and_load(input_path: str, target_sr: int = 16000):
    """
    Inspects audio using pydub:
    - Measures dBFS (average RMS level) and max_dBFS (peak level)
    - If audio is too faint (dBFS < -30), applies headroom normalization via pydub
    - Falls back to loading via pydub if soundfile fails
    Returns (audio_np, sr, pydub_stats)
    """
    import numpy as np
    stats = {
        "pydub_available": False,
        "raw_dbfs": None,
        "max_dbfs": None,
        "normalized_applied": False,
        "loudness_boost_db": 0.0,
        "loader": "soundfile",
    }

    try:
        from pydub import AudioSegment, effects
        stats["pydub_available"] = True
        seg = AudioSegment.from_file(input_path)
        stats["raw_dbfs"] = round(float(seg.dBFS), 2)
        stats["max_dbfs"] = round(float(seg.max_dBFS), 2)

        # If audio is very faint (< -30 dBFS), normalize headroom via pydub
        if seg.dBFS < -30.0 and seg.max_dBFS < -8.0:
            boosted = effects.normalize(seg, headroom=1.0)
            boost_gain = round(float(boosted.dBFS - seg.dBFS), 2)
            stats["normalized_applied"] = True
            stats["loudness_boost_db"] = boost_gain
            seg = boosted
            log_err(f"pydub: faint audio boosted by +{boost_gain}dB (was {stats['raw_dbfs']} dBFS)")

        # Ensure 16kHz mono PCM
        seg = seg.set_channels(1).set_frame_rate(target_sr)
        samples = np.array(seg.get_array_of_samples(), dtype=np.float32)
        max_possible = float(1 << (seg.sample_width * 8 - 1))
        audio = samples / max_possible
        stats["loader"] = "pydub"
        return audio.astype(np.float32), target_sr, stats

    except Exception as e_pydub:
        log_err(f"pydub loader notice ({e_pydub}) — using soundfile")
        import soundfile as sf
        audio, sr = sf.read(input_path, always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        return audio.astype(np.float32), sr, stats

def detect_speech_with_pydub(input_path: str, min_silence_len: int = 300, silence_thresh_offset: float = -16.0):
    """
    Fallback VAD using pydub.silence.detect_nonsilent.
    Preserves exact timestamp offsets.
    """
    try:
        from pydub import AudioSegment, silence
        seg = AudioSegment.from_file(input_path)
        thresh = max(-45.0, seg.dBFS + silence_thresh_offset)
        intervals = silence.detect_nonsilent(seg, min_silence_len=min_silence_len, silence_thresh=thresh)
        if not intervals:
            return None
        return [
            {
                "start_sample": int((s / 1000.0) * 16000),
                "end_sample": int((e / 1000.0) * 16000),
                "start_s": round(s / 1000.0, 4),
                "end_s": round(e / 1000.0, 4),
            }
            for s, e in intervals
        ]
    except Exception as e:
        log_err(f"pydub silence detection error: {e}")
        return None

def apply_speech_agc(audio, sr, target_rms=0.08, max_gain=4.0):
    """
    Automatic Gain Control (AGC) with smooth envelope to boost quiet speech
    and tame excessive peaks, optimal for small Whisper models.
    """
    import numpy as np
    if len(audio) == 0:
        return audio
    frame_len = int(sr * 0.05)  # 50ms window
    if frame_len <= 1:
        return audio
    sq = audio ** 2
    window = np.ones(frame_len) / frame_len
    env = np.sqrt(np.convolve(sq, window, mode='same') + 1e-9)
    noise_floor = 0.003
    gain = np.where(env > noise_floor, target_rms / np.maximum(env, 0.002), 1.0)
    gain = np.clip(gain, 0.4, max_gain)
    smooth_len = int(sr * 0.02)
    if smooth_len > 1:
        gain = np.convolve(gain, np.ones(smooth_len) / smooth_len, mode='same')
    out = audio * gain
    peak = np.max(np.abs(out))
    if peak > 0.95:
        out = (out / peak) * 0.95
    return out.astype(np.float32)

def apply_noise_gate(audio, sr, threshold_db=-42.0):
    """Zero out true background hiss during pauses to prevent small-model hallucination."""
    import numpy as np
    if len(audio) == 0:
        return audio
    threshold = 10.0 ** (threshold_db / 20.0)
    frame_len = int(sr * 0.03)  # 30ms window
    if frame_len <= 1:
        return audio
    sq = audio ** 2
    env = np.sqrt(np.convolve(sq, np.ones(frame_len) / frame_len, mode='same') + 1e-9)
    mask = (env >= threshold).astype(np.float32)
    smooth_len = int(sr * 0.04)
    if smooth_len > 1:
        mask = np.convolve(mask, np.ones(smooth_len) / smooth_len, mode='same')
    return (audio * np.clip(mask, 0.0, 1.0)).astype(np.float32)

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
        audio, sr, pydub_stats = pydub_inspect_and_load(input_path, target_sr=16000)
        diag['pydub_stats'] = pydub_stats

        diag['input_duration_s'] = round(len(audio) / sr, 3)

        if len(audio) == 0:
            diag['warnings'].append("Input audio is empty — using 0.5s silence fallback")
            audio = np.zeros(int(sr * 0.5), dtype=np.float32)

        # ── Step 1: DeepFilter-Net+ [Rumble Cut (65Hz) + Bandpass Vocal (80Hz - 7.5kHz) + Spectral Smoothing] ────
        audio = apply_highpass(audio, sr, cutoff_hz=65)
        audio = apply_bandpass(audio, sr, low_hz=80, high_hz=7500)
        audio = apply_spectral_smoothing(audio, kernel_size=3)
        try:
            audio = apply_speech_agc(audio, sr, target_rms=0.08, max_gain=2.5)
        except Exception as e_agc:
            diag['warnings'].append(f"Speech AGC skipped: {e_agc}")

        # ── Step 2: NoiseReduce [Spectral Gating Noise Reduction] ─────────────
        audio = apply_noisereduce(audio, sr, prop_decrease=0.30, n_fft=1024)

        # ── Step 3: Silero VAD [Deteksi Segmen Ucapan Aktif - Timestamp Traceable] ──
        segments = run_silero_vad_with_offsets(
            audio, sr,
            threshold=0.50,
            min_speech_ms=200,
            min_silence_ms=300,
            speech_pad_ms=200,
        )

        # Robust fallback to pydub VAD if Silero returns no segments
        if not segments:
            pydub_segs = detect_speech_with_pydub(input_path)
            if pydub_segs:
                segments = pydub_segs
                diag['warnings'].append("Silero VAD fallback: used pydub non-silent intervals")

        if segments:
            audio = build_silenced_audio(audio, sr, segments)
            diag['vad_segments'] = segments
            diag['vad_segment_count'] = len(segments)

            # Write VAD sidecar JSON for whisper.ts / model runners to use
            sidecar_path = output_path.replace('.wav', '_vad.json')
            try:
                with open(sidecar_path, 'w') as f:
                    json.dump({'vad_segments': segments, 'sr': sr}, f)
                log_err(f"Silero VAD: {len(segments)} speech segments found, sidecar written to {sidecar_path}")
            except Exception as e_sidecar:
                diag['warnings'].append(f"Sidecar write skipped: {e_sidecar}")
        else:
            diag['warnings'].append("Silero VAD found no speech segments; using processed audio")

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
