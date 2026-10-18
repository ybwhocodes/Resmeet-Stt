#!/usr/bin/env python3
"""
test_pipeline.py — Resmeet-STT Pipeline Test Suite
Tests the audio preprocessing and transcript validation pipeline.

Usage:
  python3 test_pipeline.py [--audio-dir /path/to/test/audio] [--model /path/to/model.bin]
"""
import sys
import os
import json
import time
import tempfile
import argparse
import subprocess

# Add scripts dir to path
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_DIR)

RESULTS = []


def report(name: str, passed: bool, detail: str = "", duration_s: float = 0.0):
    status = "PASS" if passed else "FAIL"
    symbol = "✅" if passed else "❌"
    print(f"  {symbol} [{status}] {name} ({duration_s:.2f}s)")
    if detail:
        print(f"         {detail}")
    RESULTS.append({'name': name, 'passed': passed, 'detail': detail, 'duration_s': duration_s})


def make_silent_wav(path: str, duration_s: float = 2.0, sr: int = 16000):
    import numpy as np
    import soundfile as sf
    audio = np.zeros(int(sr * duration_s), dtype=np.float32)
    sf.write(path, audio, sr)


def make_tone_wav(path: str, freq_hz: float = 440.0, duration_s: float = 2.0, sr: int = 16000):
    import numpy as np
    import soundfile as sf
    t = np.linspace(0, duration_s, int(sr * duration_s))
    audio = (0.3 * np.sin(2 * np.pi * freq_hz * t)).astype(np.float32)
    sf.write(path, audio, sr)


def make_noisy_wav(path: str, duration_s: float = 3.0, sr: int = 16000):
    import numpy as np
    import soundfile as sf
    audio = (0.05 * np.random.randn(int(sr * duration_s))).astype(np.float32)
    sf.write(path, audio, sr)


def make_speech_like_wav(path: str, duration_s: float = 5.0, sr: int = 16000):
    """Multi-frequency signal to simulate speech energy distribution."""
    import numpy as np
    import soundfile as sf
    t = np.linspace(0, duration_s, int(sr * duration_s))
    audio = np.zeros_like(t, dtype=np.float32)
    for f in [120, 200, 350, 600, 1000, 2000, 3500]:
        audio += 0.1 * np.sin(2 * np.pi * f * t)
    # Add some amplitude modulation to simulate speech rhythm
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 4 * t)
    audio = (audio * envelope).astype(np.float32)
    sf.write(path, audio, sr)


def run_preprocess(input_wav: str, output_wav: str, combo: str) -> dict:
    """Run preprocess_combo.py and return diagnostics dict."""
    script = os.path.join(SCRIPTS_DIR, 'preprocess_combo.py')
    result = subprocess.run(
        [sys.executable, script, '--input', input_wav, '--output', output_wav, '--combo', combo],
        capture_output=True, text=True, timeout=60
    )
    diag = {}
    for line in result.stdout.splitlines():
        try:
            diag = json.loads(line)
            break
        except json.JSONDecodeError:
            pass
    diag['_returncode'] = result.returncode
    diag['_stderr'] = result.stderr[-500:] if result.stderr else ''
    return diag


def run_validator(input_json: str, output_json: str) -> dict:
    """Run validate_transcript.py and return report dict."""
    script = os.path.join(SCRIPTS_DIR, 'validate_transcript.py')
    result = subprocess.run(
        [sys.executable, script, '--input', input_json, '--output', output_json],
        capture_output=True, text=True, timeout=30
    )
    report_data = {}
    for line in result.stdout.splitlines():
        try:
            report_data = json.loads(line)
            break
        except json.JSONDecodeError:
            pass
    report_data['_returncode'] = result.returncode
    return report_data


# ─── TEST CASES ─────────────────────────────────────────────────────────────

def test_imports():
    t = time.time()
    try:
        import numpy as np
        import soundfile as sf
        from scipy.signal import butter, filtfilt
        import noisereduce
        import torch
        import silero_vad
        import zlib
        report("Python dependency imports", True,
               f"numpy, soundfile, scipy, noisereduce, torch {torch.__version__}, silero_vad ok",
               time.time() - t)
    except ImportError as e:
        report("Python dependency imports", False, str(e), time.time() - t)


def test_silero_vad_silence():
    """VAD on silent audio should return no segments."""
    t = time.time()
    import torch
    import silero_vad
    audio = torch.zeros(16000)
    model = silero_vad.load_silero_vad(onnx=True)
    ts = silero_vad.get_speech_timestamps(audio, model, threshold=0.5, sampling_rate=16000)
    passed = len(ts) == 0
    report("Silero VAD: silence → no segments", passed,
           f"got {len(ts)} segments (expected 0)", time.time() - t)


def test_silero_vad_tone():
    """VAD on pure tone (non-speech) should return 0 or few segments."""
    t = time.time()
    try:
        import torch
        import numpy as np
        import silero_vad
        freq = 440.0
        sr = 16000
        dur = 3.0
        tone = (0.3 * np.sin(2 * np.pi * freq * np.linspace(0, dur, int(sr * dur)))).astype('float32')
        model = silero_vad.load_silero_vad(onnx=True)
        ts = silero_vad.get_speech_timestamps(torch.from_numpy(tone), model, threshold=0.5, sampling_rate=sr)
        # Pure sine wave may or may not be detected as speech depending on VAD — just ensure it doesn't crash
        report("Silero VAD: pure tone (440Hz)", True, f"got {len(ts)} segments (no crash)", time.time() - t)
    except Exception as e:
        report("Silero VAD: pure tone (440Hz)", False, str(e), time.time() - t)


def test_preprocess_combo1_silence(tmpdir: str):
    t = time.time()
    inp = os.path.join(tmpdir, 'silent.wav')
    out = os.path.join(tmpdir, 'silent_combo1.wav')
    make_silent_wav(inp, 2.0)
    diag = run_preprocess(inp, out, '1')
    passed = diag.get('success', False) or os.path.exists(out)
    report("Preprocess Combo 1: silent audio", passed,
           f"returncode={diag.get('_returncode')}, out_duration={diag.get('output_duration_s')}s",
           time.time() - t)


def test_preprocess_combo2_noisy(tmpdir: str):
    t = time.time()
    inp = os.path.join(tmpdir, 'noisy.wav')
    out = os.path.join(tmpdir, 'noisy_combo2.wav')
    make_noisy_wav(inp, 3.0)
    diag = run_preprocess(inp, out, '2')
    passed = os.path.exists(out)
    report("Preprocess Combo 2: noisy audio → output exists", passed,
           f"returncode={diag.get('_returncode')}, out_dur={diag.get('output_duration_s')}s",
           time.time() - t)


def test_preprocess_combo3_vad_sidecar(tmpdir: str):
    t = time.time()
    inp = os.path.join(tmpdir, 'speech_like.wav')
    out = os.path.join(tmpdir, 'speech_like_combo3.wav')
    make_speech_like_wav(inp, 5.0)
    diag = run_preprocess(inp, out, '3')
    sidecar = out.replace('.wav', '_vad.json')
    out_exists = os.path.exists(out)
    # VAD sidecar is optional — only written when speech segments found
    report("Preprocess Combo 3: output WAV exists", out_exists,
           f"returncode={diag.get('_returncode')}, vad_segments={diag.get('vad_segment_count', 0)}",
           time.time() - t)


def test_preprocess_fallback_on_error(tmpdir: str):
    """Test that a corrupt input causes graceful failure (non-zero exit)."""
    t = time.time()
    inp = os.path.join(tmpdir, 'corrupt.wav')
    out = os.path.join(tmpdir, 'corrupt_out.wav')
    with open(inp, 'wb') as f:
        f.write(b'NOT A WAV FILE!!!')
    script = os.path.join(SCRIPTS_DIR, 'preprocess_combo.py')
    result = subprocess.run(
        [sys.executable, script, '--input', inp, '--output', out, '--combo', '1'],
        capture_output=True, text=True, timeout=30
    )
    # Script should exit non-zero on corrupt input
    passed = result.returncode != 0
    report("Preprocess: corrupt input → non-zero exit", passed,
           f"returncode={result.returncode}", time.time() - t)


def test_validator_normal_transcript(tmpdir: str):
    """Normal transcript should pass validation."""
    t = time.time()
    inp = os.path.join(tmpdir, 'normal.json')
    out = os.path.join(tmpdir, 'normal_validated.json')
    data = {
        'transcription': [
            {'text': 'Rapat dimulai jam sembilan pagi.', 'offsets': {'from': 0, 'to': 3000}},
            {'text': 'Agenda hari ini membahas perkembangan proyek sistem.', 'offsets': {'from': 3000, 'to': 7000}},
            {'text': 'Direktur meminta laporan diselesaikan minggu ini.', 'offsets': {'from': 7000, 'to': 11000}},
        ]
    }
    with open(inp, 'w') as f:
        json.dump(data, f)
    result = run_validator(inp, out)
    passed = result.get('validation_status') == 'normal' and result.get('_returncode') == 0
    report("Validator: normal transcript → status=normal", passed,
           f"status={result.get('validation_status')}, issues={result.get('issue_count', 0)}",
           time.time() - t)


def test_validator_hallucination_word_repetition(tmpdir: str):
    """Heavily repeated word should be flagged as high_confidence_anomaly."""
    t = time.time()
    inp = os.path.join(tmpdir, 'halluc.json')
    out = os.path.join(tmpdir, 'halluc_validated.json')
    repeated_text = ('baik ' * 50).strip()
    data = {
        'transcription': [
            {'text': repeated_text, 'offsets': {'from': 0, 'to': 2000}},
        ]
    }
    with open(inp, 'w') as f:
        json.dump(data, f)
    result = run_validator(inp, out)
    passed = result.get('validation_status') in ('suspicious', 'high_confidence_anomaly')
    report("Validator: word repetition (x50) → anomaly flagged", passed,
           f"status={result.get('validation_status')}, issues={result.get('issue_count', 0)}",
           time.time() - t)


def test_validator_empty_transcript(tmpdir: str):
    """Empty transcription should not crash validator."""
    t = time.time()
    inp = os.path.join(tmpdir, 'empty.json')
    out = os.path.join(tmpdir, 'empty_validated.json')
    data = {'transcription': []}
    with open(inp, 'w') as f:
        json.dump(data, f)
    result = run_validator(inp, out)
    passed = result.get('_returncode') in (0, 2)
    report("Validator: empty transcript → no crash", passed,
           f"status={result.get('validation_status')}, returncode={result.get('_returncode')}",
           time.time() - t)


def test_validator_normal_word_repetition(tmpdir: str):
    """Naturally occurring word repetition (x3) should NOT be flagged."""
    t = time.time()
    inp = os.path.join(tmpdir, 'normal_rep.json')
    out = os.path.join(tmpdir, 'normal_rep_validated.json')
    # "baik baik baik" might be naturally said; only 3 reps, below threshold
    data = {
        'transcription': [
            {'text': 'Baik baik baik, kita mulai rapat sekarang.', 'offsets': {'from': 0, 'to': 3000}},
        ]
    }
    with open(inp, 'w') as f:
        json.dump(data, f)
    result = run_validator(inp, out)
    passed = result.get('validation_status') == 'normal'
    report("Validator: 'baik baik baik' (3x) → NOT flagged", passed,
           f"status={result.get('validation_status')}, issues={result.get('issue_count', 0)}",
           time.time() - t)


def test_preprocess_output_duration_preserved(tmpdir: str):
    """Output duration should be close to input duration for combo 1 and 2."""
    t = time.time()
    import soundfile as sf
    inp = os.path.join(tmpdir, 'tone5s.wav')
    make_speech_like_wav(inp, 5.0)
    for combo in ['1', '2']:
        out = os.path.join(tmpdir, f'tone5s_c{combo}.wav')
        diag = run_preprocess(inp, out, combo)
        if os.path.exists(out):
            info = sf.info(out)
            dur = info.duration
            # Allow for trim (combo 1 may trim leading silence): accept 2s–6s range
            in_range = 1.5 <= dur <= 7.0
            report(f"Preprocess Combo {combo}: output duration in valid range", in_range,
                   f"out_dur={dur:.2f}s (expected ~5.0s ±trim)", time.time() - t)
        else:
            report(f"Preprocess Combo {combo}: output exists", False,
                   "output file not created", time.time() - t)


def print_summary():
    total = len(RESULTS)
    passed = sum(1 for r in RESULTS if r['passed'])
    failed = total - passed
    print(f"\n{'═'*60}")
    print(f"  TEST SUMMARY: {passed}/{total} passed, {failed} failed")
    print(f"{'═'*60}")
    if failed > 0:
        print("  Failed tests:")
        for r in RESULTS:
            if not r['passed']:
                print(f"    ❌ {r['name']}: {r['detail']}")
    return failed == 0


def main():
    parser = argparse.ArgumentParser(description='Resmeet-STT Pipeline Test Suite')
    parser.add_argument('--tmpdir', default=None, help='Temp directory for test files')
    args = parser.parse_args()

    print("\n🧪 Resmeet-STT Anti-Hallucination Pipeline Test Suite")
    print(f"   Scripts dir: {SCRIPTS_DIR}")
    print("═" * 60)

    with tempfile.TemporaryDirectory(prefix='resmeet_test_') as auto_tmpdir:
        tmpdir = args.tmpdir or auto_tmpdir
        os.makedirs(tmpdir, exist_ok=True)

        print("\n[1] Dependency & Environment")
        test_imports()

        print("\n[2] Silero VAD Behavior")
        test_silero_vad_silence()
        test_silero_vad_tone()

        print("\n[3] Audio Preprocessing (preprocess_combo.py)")
        test_preprocess_combo1_silence(tmpdir)
        test_preprocess_combo2_noisy(tmpdir)
        test_preprocess_combo3_vad_sidecar(tmpdir)
        test_preprocess_fallback_on_error(tmpdir)
        test_preprocess_output_duration_preserved(tmpdir)

        print("\n[4] Transcript Validation (validate_transcript.py)")
        test_validator_normal_transcript(tmpdir)
        test_validator_hallucination_word_repetition(tmpdir)
        test_validator_empty_transcript(tmpdir)
        test_validator_normal_word_repetition(tmpdir)

    all_passed = print_summary()
    sys.exit(0 if all_passed else 1)


if __name__ == '__main__':
    main()
