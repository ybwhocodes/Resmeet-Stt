use crate::models::KnowledgeRecord;
use serde::Serialize;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NlpSuggestion {
    pub knowledge_id: Uuid,
    pub category: String,
    pub matched_text: String,
    pub canonical_term: String,
    pub match_type: String,
    pub confidence: f32,
    pub context: String,
    pub occurrences: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NlpAnalysis {
    pub suggestions: Vec<NlpSuggestion>,
    pub preview_text: String,
    pub glossary_count: usize,
    pub rag_context_prompt: String,
}

pub fn parse_aliases(raw: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    raw.split([',', ';', '\n', '|'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter(|s| seen.insert(s.to_lowercase()))
        .map(ToString::to_string)
        .collect()
}

#[derive(Clone, Debug)]
struct WordSpan {
    norm: String,
    start: usize,
    end: usize,
}

fn normalize_token(token: &str) -> String {
    token
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

fn tokenize_with_spans(text: &str) -> Vec<WordSpan> {
    let mut spans = Vec::new();
    let mut current_start: Option<usize> = None;

    for (idx, ch) in text.char_indices() {
        if ch.is_whitespace() {
            if let Some(start) = current_start.take() {
                let raw = &text[start..idx];
                let norm = normalize_token(raw);
                if !norm.is_empty() {
                    let trimmed_start = raw
                        .char_indices()
                        .find(|(_, c)| c.is_alphanumeric())
                        .map(|(offset, _)| start + offset)
                        .unwrap_or(start);
                    let trimmed_end = raw
                        .char_indices()
                        .rev()
                        .find(|(_, c)| c.is_alphanumeric())
                        .map(|(offset, c)| start + offset + c.len_utf8())
                        .unwrap_or(idx);
                    spans.push(WordSpan {
                        norm,
                        start: trimmed_start,
                        end: trimmed_end,
                    });
                }
            }
        } else if current_start.is_none() {
            current_start = Some(idx);
        }
    }

    if let Some(start) = current_start {
        let idx = text.len();
        let raw = &text[start..idx];
        let norm = normalize_token(raw);
        if !norm.is_empty() {
            let trimmed_start = raw
                .char_indices()
                .find(|(_, c)| c.is_alphanumeric())
                .map(|(offset, _)| start + offset)
                .unwrap_or(start);
            let trimmed_end = raw
                .char_indices()
                .rev()
                .find(|(_, c)| c.is_alphanumeric())
                .map(|(offset, c)| start + offset + c.len_utf8())
                .unwrap_or(idx);
            spans.push(WordSpan {
                norm,
                start: trimmed_start,
                end: trimmed_end,
            });
        }
    }

    spans
}

fn normalize_phrase_words(phrase: &str) -> Vec<String> {
    phrase
        .split_whitespace()
        .map(normalize_token)
        .filter(|w| !w.is_empty())
        .collect()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    if a_chars.is_empty() {
        return b_chars.len();
    }
    if b_chars.is_empty() {
        return a_chars.len();
    }
    let mut prev: Vec<usize> = (0..=b_chars.len()).collect();
    let mut curr = vec![0usize; b_chars.len() + 1];
    for (i, ca) in a_chars.iter().enumerate() {
        curr[0] = i + 1;
        for (j, cb) in b_chars.iter().enumerate() {
            let cost = usize::from(ca != cb);
            curr[j + 1] = (curr[j] + 1).min(prev[j + 1] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[b_chars.len()]
}

fn similarity(a: &str, b: &str) -> f32 {
    let max_len = a.chars().count().max(b.chars().count());
    if max_len == 0 {
        return 1.0;
    }
    let dist = levenshtein(a, b);
    1.0 - (dist as f32 / max_len as f32)
}

pub fn analyze_transcript(text: &str, entries: &[KnowledgeRecord]) -> NlpAnalysis {
    let active_entries: Vec<&KnowledgeRecord> = entries.iter().filter(|e| e.is_active).collect();
    if active_entries.is_empty() {
        return NlpAnalysis {
            suggestions: Vec::new(),
            preview_text: text.to_string(),
            glossary_count: 0,
            rag_context_prompt: String::new(),
        };
    }

    let tokens = tokenize_with_spans(text);
    let mut suggestions = Vec::new();
    let mut replacements: Vec<(usize, usize, String)> = Vec::new();
    let mut covered_ranges: Vec<(usize, usize)> = Vec::new();

    // 1. Exact alias & canonical phrase detection
    for entry in &active_entries {
        let canonical_clean = entry.title.trim();
        if canonical_clean.is_empty() {
            continue;
        }
        let canonical_words = normalize_phrase_words(canonical_clean);
        let aliases = parse_aliases(&entry.aliases);

        for alias in &aliases {
            let alias_words = normalize_phrase_words(alias);
            if alias_words.is_empty() || alias_words == canonical_words {
                continue;
            }
            let width = alias_words.len();
            if tokens.len() < width {
                continue;
            }
            let mut count = 0usize;
            let mut sample_matched = String::new();
            for window in tokens.windows(width) {
                if window.iter().zip(&alias_words).all(|(w, a)| w.norm == *a) {
                    let start = window.first().unwrap().start;
                    let end = window.last().unwrap().end;
                    if !covered_ranges.iter().any(|(cs, ce)| start < *ce && end > *cs) {
                        if sample_matched.is_empty() {
                            sample_matched = text[start..end].to_string();
                        }
                        count += 1;
                        covered_ranges.push((start, end));
                        replacements.push((start, end, canonical_clean.to_string()));
                    }
                }
            }
            if count > 0 {
                suggestions.push(NlpSuggestion {
                    knowledge_id: entry.id,
                    category: entry.category.clone(),
                    matched_text: sample_matched,
                    canonical_term: canonical_clean.to_string(),
                    match_type: "alias_eksak".to_string(),
                    confidence: 1.0,
                    context: entry.content.clone(),
                    occurrences: count,
                });
            }
        }
    }

    // 2. Fuzzy NLP similarity detection (catches undocumented STT typos like "Pak Samut" -> "Pak Samsut")
    for entry in &active_entries {
        let canonical_clean = entry.title.trim();
        let canonical_words = normalize_phrase_words(canonical_clean);
        if canonical_words.is_empty() {
            continue;
        }
        let canonical_joined = canonical_words.join(" ");
        if canonical_joined.chars().count() < 5 {
            continue;
        }
        let width = canonical_words.len();
        if tokens.len() < width {
            continue;
        }

        let mut best_score = 0.0f32;
        let mut fuzzy_matches: Vec<(usize, usize, String)> = Vec::new();
        for window in tokens.windows(width) {
            let start = window.first().unwrap().start;
            let end = window.last().unwrap().end;
            if covered_ranges.iter().any(|(cs, ce)| start < *ce && end > *cs) {
                continue;
            }
            let candidate_joined = window
                .iter()
                .map(|w| w.norm.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            if candidate_joined == canonical_joined {
                continue;
            }
            // For multi-word names/phrases, require the first short prefix/title or overall phrase similarity >= 0.80
            let sim = similarity(&candidate_joined, &canonical_joined);
            let words_compatible = if width > 1 {
                window.iter().zip(&canonical_words).all(|(w, c)| {
                    w.norm == *c || similarity(&w.norm, c) >= 0.65
                })
            } else {
                true
            };
            if sim >= 0.78 && words_compatible {
                best_score = best_score.max(sim);
                fuzzy_matches.push((start, end, text[start..end].to_string()));
            }
        }

        if !fuzzy_matches.is_empty() {
            let sample = fuzzy_matches[0].2.clone();
            let count = fuzzy_matches.len();
            for (s, e, _) in fuzzy_matches {
                covered_ranges.push((s, e));
            }
            suggestions.push(NlpSuggestion {
                knowledge_id: entry.id,
                category: entry.category.clone(),
                matched_text: sample,
                canonical_term: canonical_clean.to_string(),
                match_type: "kemiripan_nlp".to_string(),
                confidence: (best_score * 100.0).round() / 100.0,
                context: entry.content.clone(),
                occurrences: count,
            });
        }
    }

    // 3. Exact canonical term hits (provides RAG contextual guidance even without typos)
    let mut existing_canonical: HashSet<Uuid> = suggestions.iter().map(|s| s.knowledge_id).collect();
    for entry in &active_entries {
        if existing_canonical.contains(&entry.id) {
            continue;
        }
        let canonical_clean = entry.title.trim();
        let canonical_words = normalize_phrase_words(canonical_clean);
        let width = canonical_words.len();
        if width == 0 || tokens.len() < width {
            continue;
        }
        let count = tokens
            .windows(width)
            .filter(|w| w.iter().zip(&canonical_words).all(|(tok, cw)| tok.norm == *cw))
            .count();
        if count > 0 {
            existing_canonical.insert(entry.id);
            suggestions.push(NlpSuggestion {
                knowledge_id: entry.id,
                category: entry.category.clone(),
                matched_text: canonical_clean.to_string(),
                canonical_term: canonical_clean.to_string(),
                match_type: "konteks_terdeteksi".to_string(),
                confidence: 1.0,
                context: entry.content.clone(),
                occurrences: count,
            });
        }
    }

    // Apply exact alias replacements to build preview text (reverse byte order to keep offsets valid)
    replacements.sort_by(|a, b| b.0.cmp(&a.0));
    let mut preview_text = text.to_string();
    let mut last_start = usize::MAX;
    for (start, end, target) in replacements {
        if end <= last_start && end <= preview_text.len() {
            preview_text.replace_range(start..end, &target);
            last_start = start;
        }
    }

    let rag_context_prompt = format_rag_prompt(&active_entries, &suggestions);

    NlpAnalysis {
        suggestions,
        preview_text,
        glossary_count: active_entries.len(),
        rag_context_prompt,
    }
}

fn format_rag_prompt(entries: &[&KnowledgeRecord], suggestions: &[NlpSuggestion]) -> String {
    if entries.is_empty() && suggestions.is_empty() {
        return String::new();
    }

    let mut lines = Vec::new();
    let corrections: Vec<&NlpSuggestion> = suggestions
        .iter()
        .filter(|s| s.match_type != "konteks_terdeteksi")
        .collect();

    if !corrections.is_empty() {
        lines.push("REKOMENDASI PERBAIKAN ISTILAH / NAMA DARI KNOWLEDGE NLP:".to_string());
        for s in corrections {
            let ctx = if s.context.trim().is_empty() {
                String::new()
            } else {
                format!(" | Konteks: {}", s.context.trim())
            };
            let confidence_pct = (s.confidence * 100.0).round() as u32;
            lines.push(format!(
                "- \"{}\" -> perbaiki menjadi \"{}\" (Kategori: {}, Metode: {}, Kemiripan: {}%, Muncul: {}x{})",
                s.matched_text, s.canonical_term, s.category, s.match_type, confidence_pct, s.occurrences, ctx
            ));
        }
    }

    lines.push("GLOSARIUM KNOWLEDGE / RAG REFERENSI AKTIF:".to_string());
    for entry in entries.iter().take(40) {
        let aliases = parse_aliases(&entry.aliases);
        let alias_note = if aliases.is_empty() {
            String::new()
        } else {
            format!(" (alias/salah dengar STT: {})", aliases.join(", "))
        };
        let desc = if entry.content.trim().is_empty() {
            String::new()
        } else {
            format!(" — {}", entry.content.trim())
        };
        lines.push(format!(
            "- [{}] {}{}{}",
            entry.category,
            entry.title.trim(),
            alias_note,
            desc
        ));
    }

    lines.join("\n")
}

pub fn build_cleanup_rag_note(text: &str, entries: &[KnowledgeRecord]) -> Option<String> {
    let analysis = analyze_transcript(text, entries);
    if analysis.rag_context_prompt.is_empty() {
        return None;
    }
    Some(format!(
        "\n\nACUAN KNOWLEDGE & NLP RAG:\nGunakan daftar istilah baku berikut untuk memperbaiki salah dengar STT (misalnya nama orang, proyek, singkatan, atau istilah teknis) secara konsisten tanpa menambah fakta baru. Jika menemukan kemiripan nama/istilah yang ambigu, utamakan bentuk baku yang paling sesuai konteks.\n{}",
        analysis.rag_context_prompt
    ))
}

pub fn build_paraphrase_rag_block(text: &str, entries: &[KnowledgeRecord]) -> Option<String> {
    let analysis = analyze_transcript(text, entries);
    if analysis.rag_context_prompt.is_empty() {
        return None;
    }
    Some(format!(
        "<knowledge_rag>\nGunakan basis pengetahuan (Knowledge/RAG) dan saran NLP di bawah ini sebagai acuan penulisan nama, istilah teknis, serta perbaikan kalimat yang kurang jelas dari transkrip. Jika ditemukan kata salah dengar STT (seperti pada bagian Rekomendasi Perbaikan), gunakan istilah baku yang direkomendasikan dan tandai di bagian Catatan Tambahan hanya jika identitasnya masih meragukan.\n{}\n</knowledge_rag>",
        analysis.rag_context_prompt
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample_entry(title: &str, aliases: &str, content: &str) -> KnowledgeRecord {
        let now = Utc::now().naive_utc();
        KnowledgeRecord {
            id: Uuid::new_v4(),
            user_id: None,
            category: "Nama / PIC".to_string(),
            title: title.to_string(),
            aliases: aliases.to_string(),
            content: content.to_string(),
            source: Some("Direktori Tim".to_string()),
            is_active: true,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn exact_aliases_and_fuzzy_names_produce_nlp_recommendations() {
        let entries = vec![
            sample_entry(
                "Pak Samsut",
                "Pak Sammut, Pak Samsul",
                "Kepala Gudang Operasional",
            ),
            sample_entry("Resmeet STT", "Resmit STT", "Aplikasi transkripsi rapat"),
        ];
        let input = "Laporan dari Pak Sammut dan Pak Samsul terkait Pak Samut pada proyek Resmeet STT.";
        let analysis = analyze_transcript(input, &entries);

        assert_eq!(analysis.glossary_count, 2);
        assert!(analysis.preview_text.contains("Pak Samsut dan Pak Samsut"));
        assert!(analysis
            .suggestions
            .iter()
            .any(|s| s.canonical_term == "Pak Samsut" && s.match_type == "alias_eksak"));
        assert!(analysis
            .suggestions
            .iter()
            .any(|s| s.canonical_term == "Pak Samsut" && s.match_type == "kemiripan_nlp" && s.matched_text == "Pak Samut"));
        assert!(analysis
            .suggestions
            .iter()
            .any(|s| s.canonical_term == "Resmeet STT" && s.match_type == "konteks_terdeteksi"));
        assert!(analysis.rag_context_prompt.contains("Pak Samsut"));
    }

    #[test]
    fn inactive_entries_are_ignored_in_analysis() {
        let mut entry = sample_entry("Pak Samsut", "Pak Sammut", "Gudang");
        entry.is_active = false;
        let analysis = analyze_transcript("Pak Sammut hadir", &[entry]);
        assert_eq!(analysis.glossary_count, 0);
        assert!(analysis.suggestions.is_empty());
        assert_eq!(analysis.preview_text, "Pak Sammut hadir");
    }
}
