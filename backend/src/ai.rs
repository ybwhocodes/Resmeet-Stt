use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DialogTurn {
    pub time: String,
    pub speaker: String,
    pub text: String,
}

pub async fn call_chat_completion(
    base_url: &str,
    api_key: &str,
    model_id: &str,
    system_prompt: &str,
    user_prompt: &str,
    timeout_s: u64,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(timeout_s))
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    let endpoint = if base_url.ends_with("/chat/completions") {
        base_url.to_string()
    } else {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    };

    let payload = json!({
        "model": model_id,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "temperature": 0.3
    });

    let res = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("HTTP request error: {}", e))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("AI Provider returned error: {}", err_text));
    }

    let res_json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse AI JSON: {}", e))?;

    let content = res_json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    Ok(content)
}

pub async fn test_ai_connection(
    base_url: &str,
    api_key: &str,
    model_id: &str,
) -> Result<String, String> {
    call_chat_completion(
        base_url,
        api_key,
        model_id,
        "You are an AI assistant in Laya Decision Engine.",
        "Ping! Balas hanya dengan kata: OK",
        60,
    )
    .await
}

/// Laya Decision Engine: Chronological Dialogue Context Smoothing
/// Takes speech segments and turns them into sequential [MM:SS - MM:SS] speaker turns,
/// predicting speaker identity and smoothing disfluencies while strictly preserving original meaning.
pub async fn smooth_dialogue_flow(
    raw_segments_text: &str,
    base_url: &str,
    api_key: &str,
    model_id: &str,
) -> Result<Vec<DialogTurn>, String> {
    let system_prompt = r#"Anda adalah Laya Dialogue & Decision Engine (Context-Smoothing & Speaker Attribution Module).
Tugas Anda adalah merapikan transkrip percakapan audio mentah menjadi alur dialog urut kronologis per giliran bicara.
Aturan Wajib:
1. Setiap giliran pembicara harus memiliki format JSON Array of Objects:
   [
     { "time": "MM:SS - MM:SS", "speaker": "Pembicara 1", "text": "..." },
     { "time": "MM:SS - MM:SS", "speaker": "Pembicara 2", "text": "..." }
   ]
2. Rapikan gagap, pengulangan kata tanpa sengaja, dan perjelas konteks kalimat berdasarkan ucapan sebelumnya.
3. HANYA memperjelas konteks dan tata bahasa lisan. JANGAN MERUBAH arti atau konteks obrolan sama sekali.
4. Jangan menambahkan fakta atau opini baru.
5. Balas HANYA dengan valid JSON Array murni tanpa markdown triple backticks."#;

    let response = call_chat_completion(
        base_url,
        api_key,
        model_id,
        system_prompt,
        raw_segments_text,
        120,
    )
    .await?;

    let cleaned = response.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    if let Ok(turns) = serde_json::from_str::<Vec<DialogTurn>>(cleaned) {
        return Ok(turns);
    }

    // If parse fails, return an empty vec to fallback to client-side extractor
    Ok(vec![])
}

/// Laya Decision Engine: MoM Paraphrase & Synthesis
/// Produces structured corporate Minutes of Meeting with calibrated decisions and action items.
pub async fn call_ai_paraphrase(
    dialog_text: &str,
    style: &str,
    custom_prompt: Option<&str>,
    base_url: &str,
    api_key: &str,
    model_id: &str,
) -> Result<String, String> {
    let style_instruction = if let Some(custom) = custom_prompt.filter(|p| !p.trim().is_empty()) {
        format!("Instruksi Khusus Pengguna: {}", custom.trim())
    } else {
        match style {
            "detail_deskriptif" => {
                "Gaya Detail & Deskriptif: Uraikan latar belakang lengkap, argumentasi peserta, rincian teknis, dan insight mendalam (minimal 3 paragraf per topik pembahasan).".to_string()
            }
            "ringkasan_eksekutif" => {
                "Gaya Ringkasan Eksekutif: Format strategis untuk dewan manajemen dan pengambil keputusan, sorot isu utama, pro-kontra, dan timeline tindak lanjut berbobot.".to_string()
            }
            _ => {
                "Gaya Poin-poin Penting: Deskripsi to-the-point, ringkas berbobot, terstruktur rapi dengan action items langsung.".to_string()
            }
        }
    };

    let system_prompt = format!(
        "Anda adalah Notulis Eksekutif Berbasis Laya Decision Engine (https://github.com/NandhaKishorM/laya.git).\n\
Tugas Anda adalah merangkum transkrip percakapan rapat menjadi Minutes of Meeting (MoM) resmi korporat berkualitas tinggi.\n\
Pedoman Gaya & Arahan: {}\n\n\
Format Dokumen MoM yang Dihasilkan:\n\
# 📋 Minutes of Meeting (MoM)\n\
## 📌 Ringkasan Eksekutif & Agenda Utama\n\
## 🎯 Pembahasan Topik & Argumen Kunci\n\
## ⚖️ Keputusan Terkalibrasi (Calibrated Decisions)\n\
## ⚡ Tindak Lanjut & Action Items (PIC & Target Waktu)",
        style_instruction
    );

    call_chat_completion(
        base_url,
        api_key,
        model_id,
        &system_prompt,
        dialog_text,
        120,
    )
    .await
}
