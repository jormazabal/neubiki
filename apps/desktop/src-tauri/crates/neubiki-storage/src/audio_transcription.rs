//! Runtime facade extracted without changing method bodies or public contracts.
use super::*;
use super::proton_ai_error::ProtonAiFailure as Failure;

const PROTON_WAV_LIMIT: usize = 44 + 60 * 24_000 * 2;

impl LocalApi {
    pub(super) fn proton_dictate(&self, body: &Value, files: &[LocalApiFile]) -> Result<Value, Failure> {
        self.validate_proton_tool_target(body).map_err(|_| Failure::target_changed())?;
        let project = super::proton_ai_text::proton_ai_project_id(body).map_err(|_| Failure::target_changed())?;
        let _activity = self.private_work().map_err(|_| Failure::settings())?;
        self.transcribe_proton_clip(body, files, &project)
    }

    pub(super) fn transcribe_proton_clip(&self, body: &Value, files: &[LocalApiFile], project: &str) -> Result<Value, Failure> {
        if body["confirmed"] != true {
            return Err(Failure::before(400, "proton-dictation-confirmation-required", "Confirma el envío de esta grabación a OpenAI."));
        }
        let language = body["language"].as_str().unwrap_or("auto");
        if !matches!(language, "auto" | "es" | "en" | "fr" | "de" | "it" | "pt" | "ca" | "eu" | "gl") {
            return Err(Failure::invalid_input());
        }
        let invalid_audio = || Failure::before(422, "proton-dictation-audio-invalid", "Graba hasta un minuto de audio PCM compatible.");
        let [file] = files else { return Err(invalid_audio()); };
        if file.field_name != "file" || file.data_base64.len() > 4 * PROTON_WAV_LIMIT.div_ceil(3) {
            return Err(invalid_audio());
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(&file.data_base64)
            .map_err(|_| invalid_audio())?;
        let seconds = proton_wav_duration(&bytes).ok_or_else(invalid_audio)?;
        let config = self.read_config_checked().map_err(|_| Failure::settings())?;
        if config["ai"]["transcription"]["enabled"] != true {
            return Err(Failure::before(403, "proton-dictation-disabled", "Activa el dictado en Ajustes de IA."));
        }
        let model = config["ai"]["transcription"]["model"].as_str().ok_or_else(Failure::model_required)?;
        let catalog = neubiki_core::model_catalog::validate(model, "transcription").map_err(|_| Failure::model_required())?;
        let key = self.openai_key().ok_or_else(Failure::key_required)?;
        self.spend_preflight(Some(project)).map_err(|_| Failure::budget())?;
        let response = neubiki_ai::transcribe_audio(Some(&key), model, Some(language), bytes);
        if response["status"] != "completed" {
            return Err(Failure::provider_unconfirmed());
        }
        let price = &catalog["pricing"];
        let estimated = if price["unit"] == "minute" { price["input"].as_f64().map(|rate| rate * seconds / 60.0) } else { None };
        let usage_recorded = self.record_ai_usage(json!({
            "projectId": project,
            "interactionId": neubiki_core::compact_id("proton-dictation"),
            "capability": "audio", "model": model,
            "estimatedCost": estimated, "usageSource": if estimated.is_some() { "estimated" } else { "unknown" },
            "inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "durationSeconds": seconds,
        })).is_ok();
        let transcript = response["transcript"].as_str().map(str::trim)
            .filter(|text| !text.contains('\0') && text.len() <= 16 * 1024)
            .ok_or_else(Failure::provider_unconfirmed)?;
        Ok(json!({"transcript":transcript,"model":model,"durationSeconds":seconds,"usageRecorded":usage_recorded}))
    }

    pub(super) fn transcribe_audio(&self, body: Value, files: Vec<LocalApiFile>) -> Value {
        let Some(file) = files.into_iter().find(|file| file.field_name == "file") else {
            return json!({ "status": "error", "error": "missing_audio", "transcript": "", "message": "No se recibió audio para transcribir." });
        };
        let bytes = match base64::engine::general_purpose::STANDARD.decode(file.data_base64) {
            Ok(bytes) => bytes,
            Err(error) => {
                return json!({ "status": "error", "error": "invalid_audio", "transcript": "", "message": error.to_string() })
            }
        };
        if let Err(error)=self.spend_preflight(None){return json!({"status":"error","error":"usage_unavailable","message":error,"transcript":""});}
        let config=match self.read_config_checked(){Ok(config)=>config,Err(message)=>return json!({"status":"error","error":"configuration_unavailable","message":message,"transcript":""})};
        let model=config["ai"]["transcription"]["model"].as_str().unwrap_or("gpt-transcribe");
        let mut response = neubiki_ai::transcribe_audio(
            self.openai_key().as_deref(),
            model,
            body.get("language").and_then(Value::as_str),
            bytes,
        );
        if response["status"].as_str() == Some("completed") {
            if let Err(error)=self.record_ai_usage(json!({
                "projectId": null,
                "interactionId": neubiki_core::compact_id("ai-audio"),
                "capability": "audio",
                "model": model,
                "inputTokens": 0,
                "cachedInputTokens": 0,
                "outputTokens": 0,
                "reasoningTokens": 0,
                "embeddingTokens": 0,
                "totalTokens": 0,
                "estimatedCost": 0,
                "usageSource": "unknown"
            })){response["usageWarning"]=json!(error); }
        }
        response
    }
}

fn proton_wav_duration(bytes: &[u8]) -> Option<f64> {
    if !(46..=PROTON_WAV_LIMIT).contains(&bytes.len()) { return None; }
    let read = |offset| bytes.get(offset..offset + 4).and_then(|part| part.try_into().ok()).map(u32::from_le_bytes);
    if &bytes[..4] != b"RIFF" || &bytes[8..16] != b"WAVEfmt " || &bytes[36..40] != b"data"
        || read(4)? as usize != bytes.len() - 8 || read(16)? != 16 || read(20)? != 0x0001_0001
        || read(24)? != 24_000 || read(28)? != 48_000 || read(32)? != 0x0010_0002 {
        return None;
    }
    let length = read(40)? as usize;
    (length == bytes.len() - 44 && length % 2 == 0).then_some(length as f64 / 48_000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proton_dictation_accepts_bounded_pcm_and_rejects_forged_length() {
        let mut wav = vec![0u8; 48_044];
        for (offset, value) in [(0, *b"RIFF"), (8, *b"WAVE"), (12, *b"fmt "), (36, *b"data")] {
            wav[offset..offset + 4].copy_from_slice(&value);
        }
        for (offset, value) in [(4, 48_036u32), (16, 16), (20, 0x0001_0001), (24, 24_000),
            (28, 48_000), (32, 0x0010_0002), (40, 48_000)] {
            wav[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        assert_eq!(proton_wav_duration(&wav), Some(1.0));
        wav[40..44].copy_from_slice(&49_000u32.to_le_bytes());
        assert_eq!(proton_wav_duration(&wav), None);
    }
}
