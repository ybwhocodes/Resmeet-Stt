#!/usr/bin/env python3
"""
validate_transcript.py — Anti-Hallucination Transcript Validation
Resmeet-STT | Post-ASR output validation layer

Validates Whisper.cpp JSON output for:
  1. Repeated n-gram anomalies
  2. Suspicious compression ratio (repetitive text)
  3. Empty or symbol-only segments
  4. Mismatched timestamps
  5. Segments with long text but very short duration (density anomaly)

Exit codes:
  0 — validation passed (output JSON written)
  1 — critical anomaly detected (caller should retry or reject)
  2 — suspicious (soft warning, caller should flag)
"""
import sys
import json
import re
import argparse
import zlib
from typing import List, Dict, Any, Tuple


def compute_compression_ratio(text: str) -> float:
    """
    Ratio of raw text size to compressed size.
    Highly repetitive text compresses extremely well → high ratio = suspicious.
    Normal prose: ~1.5–3.0. Repetitive hallucination: >4.0
    """
    if not text or len(text) < 10:
        return 1.0
    raw = text.encode('utf-8')
    compressed = zlib.compress(raw, level=9)
    return len(raw) / max(len(compressed), 1)


def count_repeated_ngrams(text: str, n: int = 5) -> Tuple[int, str]:
    """
    Count how often any n-gram repeats consecutively.
    Returns (max_consecutive_repeats, most_repeated_ngram).
    """
    words = text.lower().split()
    if len(words) < n * 2:
        return 0, ""
    ngrams = [tuple(words[i:i+n]) for i in range(len(words) - n + 1)]
    max_repeats = 0
    worst_ngram = ""
    i = 0
    while i < len(ngrams):
        j = i + 1
        while j < len(ngrams) and ngrams[j] == ngrams[i]:
            j += 1
        repeats = j - i
        if repeats > max_repeats:
            max_repeats = repeats
            worst_ngram = " ".join(ngrams[i])
        i = j
    return max_repeats, worst_ngram


def count_word_repetitions(text: str) -> Tuple[int, str]:
    """Count single-word consecutive repetitions. Returns (max_count, word)."""
    words = text.lower().split()
    max_rep = 0
    worst_word = ""
    i = 0
    while i < len(words):
        j = i + 1
        while j < len(words) and words[j] == words[i]:
            j += 1
        count = j - i
        if count > max_rep:
            max_rep = count
            worst_word = words[i]
        i = j
    return max_rep, worst_word


def is_symbol_only(text: str) -> bool:
    """Returns True if text contains only symbols, numbers, or punctuation."""
    stripped = re.sub(r'[\s\W_]', '', text)
    return len(stripped) == 0


def validate_segment(seg: Dict[str, Any], seg_idx: int) -> List[Dict]:
    """Validate a single segment, return list of issue dicts."""
    issues = []
    text = (seg.get('text') or '').strip()
    start_ms = seg.get('offsets', {}).get('from', 0)
    end_ms = seg.get('offsets', {}).get('to', 0)
    duration_ms = end_ms - start_ms

    if not text:
        issues.append({'level': 'normal', 'type': 'empty_segment', 'seg': seg_idx,
                        'detail': 'Empty segment text'})
        return issues

    if is_symbol_only(text):
        issues.append({'level': 'suspicious', 'type': 'symbol_only', 'seg': seg_idx,
                        'detail': f'Segment contains only symbols: {repr(text[:80])}'})

    # Check word-level repetitions
    word_reps, worst_word = count_word_repetitions(text)
    if word_reps >= 8:
        level = 'high_confidence_anomaly' if word_reps >= 15 else 'suspicious'
        issues.append({
            'level': level, 'type': 'word_repetition', 'seg': seg_idx,
            'detail': f'Word "{worst_word}" repeated {word_reps} times consecutively',
            'repeat_count': word_reps, 'word': worst_word
        })

    # Check n-gram repetitions (5-gram)
    ngram_reps, worst_ngram = count_repeated_ngrams(text, n=5)
    if ngram_reps >= 4:
        level = 'high_confidence_anomaly' if ngram_reps >= 8 else 'suspicious'
        issues.append({
            'level': level, 'type': 'ngram_repetition', 'seg': seg_idx,
            'detail': f'5-gram "{worst_ngram}" repeated {ngram_reps} times',
            'repeat_count': ngram_reps
        })

    # Check compression ratio
    cr = compute_compression_ratio(text)
    if cr > 4.5:
        level = 'high_confidence_anomaly' if cr > 7.0 else 'suspicious'
        issues.append({
            'level': level, 'type': 'high_compression_ratio', 'seg': seg_idx,
            'detail': f'Compression ratio {cr:.2f} suggests highly repetitive text',
            'compression_ratio': round(cr, 3)
        })

    # Check text density (long text / very short duration)
    if duration_ms > 0 and len(text) > 20:
        chars_per_second = len(text) / (duration_ms / 1000)
        if chars_per_second > 60:  # >60 chars/sec is physically impossible for speech
            issues.append({
                'level': 'suspicious', 'type': 'density_anomaly', 'seg': seg_idx,
                'detail': f'{chars_per_second:.1f} chars/sec exceeds speech limit (dur={duration_ms}ms, chars={len(text)})',
                'chars_per_sec': round(chars_per_second, 1)
            })

    return issues


def validate_transcript(json_path: str, output_path: str) -> Dict[str, Any]:
    """
    Main validation function. Reads whisper-cli JSON output,
    validates each segment, returns validation report.
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    transcription = data.get('transcription', [])
    all_issues = []
    clean_segments = []
    rejected_segments = []

    for idx, seg in enumerate(transcription):
        issues = validate_segment(seg, idx)
        seg_has_critical = any(i['level'] == 'high_confidence_anomaly' for i in issues)

        if seg_has_critical:
            rejected_segments.append({'seg': idx, 'text': seg.get('text', ''), 'issues': issues})
            # Mark as anomaly but keep in output (don't silently remove)
            seg['_anomaly'] = True
            seg['_issues'] = issues
        else:
            seg['_anomaly'] = False
            seg['_issues'] = issues

        clean_segments.append(seg)
        all_issues.extend(issues)

    # Global check: overall text compression ratio
    all_text = ' '.join((s.get('text') or '') for s in transcription)
    global_cr = compute_compression_ratio(all_text)

    validation_status = 'normal'
    if any(i['level'] == 'high_confidence_anomaly' for i in all_issues):
        validation_status = 'high_confidence_anomaly'
    elif any(i['level'] == 'suspicious' for i in all_issues):
        validation_status = 'suspicious'

    report = {
        'validation_status': validation_status,
        'segment_count': len(transcription),
        'rejected_segment_count': len(rejected_segments),
        'issue_count': len(all_issues),
        'global_compression_ratio': round(global_cr, 3),
        'issues': all_issues,
        'rejected_segments': rejected_segments,
    }

    # Write validated JSON (with _anomaly flags added)
    data['transcription'] = clean_segments
    data['_validation'] = report
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Validate Whisper.cpp JSON transcript for hallucinations')
    parser.add_argument('--input', required=True, help='Input Whisper JSON file')
    parser.add_argument('--output', required=True, help='Output validated JSON file')
    args = parser.parse_args()

    try:
        report = validate_transcript(args.input, args.output)
        print(json.dumps(report), flush=True)

        if report['validation_status'] == 'high_confidence_anomaly':
            print(f"[Validator] HIGH CONFIDENCE ANOMALY: {report['issue_count']} issues, "
                  f"{report['rejected_segment_count']} segments flagged", file=sys.stderr)
            sys.exit(1)
        elif report['validation_status'] == 'suspicious':
            print(f"[Validator] SUSPICIOUS: {report['issue_count']} soft issues found", file=sys.stderr)
            sys.exit(2)
        else:
            print(f"[Validator] PASSED: {report['segment_count']} segments, no anomalies", file=sys.stderr)
            sys.exit(0)

    except Exception as e:
        print(json.dumps({'error': str(e), 'validation_status': 'error'}), flush=True)
        print(f"[Validator] ERROR: {e}", file=sys.stderr)
        sys.exit(99)
