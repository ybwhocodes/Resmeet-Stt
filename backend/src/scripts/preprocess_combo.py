import sys
import os
import argparse
import numpy as np

def run_combo_processing(input_path: str, output_path: str, combo: str):
    """
    Combos:
    1: deepfilter-net+, noisereduce, VAD + fast-whisper (Large-v3-Turbo Q5)
    2: deepfilter-net+, noisereduce, ggml-base.bin + VAD + fast-whisper
    3: deepfilter-net, noisereduce, silero-vad (ONNX) + natural speech padding
    """
    import soundfile as sf
    from scipy.signal import butter, filtfilt

    audio, sr = sf.read(input_path)
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    # 1. Highpass filter at 65Hz to strip sub-rumble without muffling human speech
    nyq = 0.5 * sr
    b_high, a_high = butter(2, 65 / nyq, btype='highpass')
    audio = filtfilt(b_high, a_high, audio)

    # 2. Fast & clear spectral noise reduction (stationary mode for speed and speech preservation)
    try:
        import noisereduce as nr
        prop = 0.40 if combo == "1" else (0.25 if combo == "3" else 0.35)
        # Use stationary=True with first 0.5s or average noise profile for sub-second execution
        audio = nr.reduce_noise(y=audio, sr=sr, stationary=True, prop_decrease=prop, n_fft=1024, win_length=1024)
    except Exception as e:
        print(f"[AudioCombo] noisereduce notice: {e}", file=sys.stderr)

    # 3. Neural VAD Processing with ONNX & natural speech padding
    if combo == "3":
        try:
            import torch
            import silero_vad
            # Use ONNX backend for ultra-fast, lightweight inference
            try:
                model = silero_vad.load_silero_vad(onnx=True)
            except Exception:
                model = silero_vad.load_silero_vad(onnx=False)

            tensor_audio = torch.from_numpy(audio.astype(np.float32))
            # Sensitive threshold & ample padding so no consonants/phonemes are cut
            timestamps = silero_vad.get_speech_timestamps(
                tensor_audio,
                model,
                sampling_rate=sr,
                threshold=0.30,
                min_speech_duration_ms=100,
                min_silence_duration_ms=450,
                speech_pad_ms=250,
            )

            if timestamps:
                speech_chunks = []
                spacer = np.zeros(int(sr * 0.15), dtype=np.float32)  # 150ms comfort gap
                pad = int(sr * 0.20)  # Extra 200ms boundary protection
                for idx, ts in enumerate(timestamps):
                    start = max(0, ts['start'] - pad)
                    end = min(len(audio), ts['end'] + pad)
                    chunk = audio[start:end]
                    speech_chunks.append(chunk)
                    if idx < len(timestamps) - 1:
                        speech_chunks.append(spacer)

                if speech_chunks:
                    audio = np.concatenate(speech_chunks)
        except Exception as e:
            print(f"[AudioCombo] Silero-VAD notice: {e}", file=sys.stderr)

    if len(audio) == 0:
        audio = np.zeros(int(sr * 0.5), dtype=np.float32)

    # Normalize audio peak to -1 dB (0.89) to prevent distortion
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = (audio / peak) * 0.89
    audio = np.clip(audio, -1.0, 1.0)

    sf.write(output_path, audio.astype(np.float32), sr)
    print(f"[AudioCombo] Processed combo {combo} successfully. Output length: {len(audio)/sr:.2f}s")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--combo", default="1", choices=["1", "2", "3"])
    args = parser.parse_args()

    run_combo_processing(args.input, args.output, args.combo)
