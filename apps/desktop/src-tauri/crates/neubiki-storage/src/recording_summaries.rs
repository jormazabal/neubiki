//! Private meeting summaries. Provider results are proposals until explicitly reviewed.
use super::*;
use neubiki_ai::proton_text::{self, TextAction};
use neubiki_ai_skills::{AiSkillSelectorChoice, AiSkillSelectorProposal};
use neubiki_recording::model::MEETING_USAGE_SCOPE;
use std::{collections::HashSet, io::Read, sync::Mutex};

const SKILL_ID: &str = "neubiki.meeting_summary";
const MAX_SUMMARY_BYTES: usize = 16 * 1024;
static SAVES: Mutex<()> = Mutex::new(());

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Generate {
    source_revision: String,
    mode: String,
    guidance: String,
    confirmed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Save {
    source_revision: String,
    expected_revision: Option<String>,
    mode: String,
    skill_version: String,
    markdown: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Summary {
    schema_version: u8,
    session_id: String,
    source_revision: String,
    revision: String,
    skill_id: String,
    skill_version: String,
    mode: String,
    markdown: String,
    saved_at: String,
}

fn skill(mode: &str) -> Result<(String, String), String> {
    let detail = neubiki_ai_skills::get_ai_skill(SKILL_ID)
        .ok_or("La habilidad de reuniones no está disponible.")?;
    let context = neubiki_ai_skills::select_skills_for_request(
        &json!({"expectedAction":"summarize_meeting","executionMode":"quick"}),
        Some(&AiSkillSelectorProposal {
            selected: vec![AiSkillSelectorChoice {
                skill_id: SKILL_ID.into(),
                mode_id: mode.into(),
                action: "summarize_meeting".into(),
                confidence: "high".into(),
                reason: "Modo elegido en la revisión de la reunión.".into(),
            }],
        }),
    );
    if context.used_skill_ids != [SKILL_ID] || context.prompt_guidance.is_empty() {
        return Err("El modo elegido no es válido para resumir reuniones.".into());
    }
    Ok((detail.manifest.version, context.prompt_guidance))
}

fn check_source<'a>(source: &'a Value, revision: &str) -> Result<&'a [Value], String> {
    if source["sourceRevision"] != revision {
        return Err("La transcripción cambió. Vuelve a abrir la revisión.".into());
    }
    let segments = source["segments"]
        .as_array()
        .filter(|items| {
            items.iter().any(|item| {
                item["text"]
                    .as_str()
                    .is_some_and(|text| !text.trim().is_empty())
            })
        })
        .ok_or("La reunión aún no tiene texto transcrito confirmado.")?;
    Ok(segments.as_slice())
}

fn check_markdown(markdown: &str, segments: &[Value]) -> Result<(), String> {
    if markdown.trim().is_empty() || markdown.len() > MAX_SUMMARY_BYTES || markdown.contains('\0') {
        return Err("El resumen está vacío o supera el límite de 16 KiB.".into());
    }
    let ids = segments
        .iter()
        .filter(|item| {
            item["text"]
                .as_str()
                .is_some_and(|text| !text.trim().is_empty())
        })
        .filter_map(|value| value["id"].as_str())
        .collect::<HashSet<_>>();
    let mut references = markdown.split("[fragment-").skip(1).peekable();
    if references.peek().is_none()
        || references.any(|value| {
            value
                .split_once(']')
                .is_none_or(|(number, _)| !ids.contains(format!("fragment-{number}").as_str()))
        })
    {
        return Err("Conserva en el resumen referencias válidas como [fragment-1].".into());
    }
    Ok(())
}

fn read_summary(path: &Path, session_id: &str) -> Result<Option<Summary>, String> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("No se pudo consultar el resumen guardado.".into()),
    };
    if !meta.is_file() || batch::linked(&meta) || meta.len() > 64 * 1024 {
        return Err("El resumen guardado no es compatible. Se conserva el archivo.".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(64 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|_| "No se pudo leer el resumen guardado.")?;
    let summary: Summary = serde_json::from_slice(&bytes)
        .map_err(|_| "El resumen guardado no es legible. Se conserva el archivo.")?;
    if bytes.len() > 64 * 1024
        || summary.schema_version != 1
        || summary.session_id != session_id
        || summary.skill_id != SKILL_ID
    {
        return Err("El resumen guardado no corresponde a esta reunión.".into());
    }
    Ok(Some(summary))
}

impl LocalApi {
    fn private_recording_source(&self, id: &str) -> Result<(PathBuf, Value), String> {
        let root = self.app_data_dir.join(if cfg!(debug_assertions) {
            "recordings-dev"
        } else {
            "recordings"
        });
        let source = neubiki_recording::transcript_source(&root, id)?;
        if source["meeting"] != true || source["projectId"] != MEETING_USAGE_SCOPE {
            return Err("La grabación no pertenece a la grabadora de reuniones.".into());
        }
        Ok((root.join(id).join("summary.json"), source))
    }

    pub(super) fn read_recording_summary(&self, id: &str) -> Result<Value, String> {
        let (path, _) = self.private_recording_source(id)?;
        Ok(json!(read_summary(&path, id)?))
    }

    pub(super) fn recording_publication_markdown(
        &self, id: &str, source_revision: &str, summary_revision: Option<&str>,
    ) -> Result<(String, bool), String> {
        let (path, source) = self.private_recording_source(id)?;
        let segments = check_source(&source, source_revision)?;
        let partial = source["unconfirmedCount"].as_u64().unwrap_or(0) > 0;
        let rate = source["sampleRate"].as_u64().filter(|rate| *rate > 0).ok_or("Frecuencia de captura no disponible.")?;
        let mut output = String::new();
        if let Some(revision) = summary_revision {
            let summary = read_summary(&path, id)?.filter(|summary| summary.revision == revision && summary.source_revision == source_revision)
                .ok_or("El resumen guardado cambió. Vuelve a abrirlo para revisar la publicación.")?;
            check_markdown(&summary.markdown, segments)?;
            output.push_str(&summary.markdown);
            output.push_str("\n\n## Fragmentos de referencia\n\nLos intervalos corresponden a fragmentos de la captura.\n");
        } else {
            output.push_str("# Transcripción de la reunión\n\nLos intervalos corresponden a fragmentos de la captura.\n");
        }
        if partial {
            output.push_str("\n> Transcripción parcial. El documento incluye solo los fragmentos confirmados.\n");
        }
        for fragment in segments {
            let text = fragment["text"].as_str().ok_or("Fragmento sin texto verificable.")?.trim();
            if text.is_empty() { continue; }
            let start = fragment["start"].as_u64().ok_or("Intervalo de captura no verificable.")?;
            let end = start.checked_add(fragment["samples"].as_u64().ok_or("Intervalo de captura no verificable.")?)
                .ok_or("Intervalo de captura no representable.")?;
            let id = fragment["id"].as_str().ok_or("Referencia de fragmento no disponible.")?;
            output.push_str(&format!("\n### {id} · {}–{}\n", publication_time(start / rate), publication_time(end / rate)));
            if summary_revision.is_none() {
                // Quote arbitrary transcription literally to avoid treating it as Markdown markup.
                for line in text.lines() {
                    output.push_str("\n> ");
                    for ch in line.chars() {
                        if matches!(ch, '\\' | '`' | '*' | '_' | '{' | '}' | '[' | ']' | '(' | ')' | '#' | '+' | '-' | '.' | '!' | '|' | '<' | '>' | '&') { output.push('\\'); }
                        output.push(ch);
                    }
                }
                output.push('\n');
            }
        }
        Ok((output, partial))
    }

    pub(super) fn generate_recording_summary(
        &self,
        id: &str,
        body: Value,
    ) -> Result<Value, String> {
        let request: Generate =
            serde_json::from_value(body).map_err(|_| "Solicitud de resumen no válida.")?;
        if !request.confirmed {
            return Err("Confirma el envío de la transcripción a OpenAI.".into());
        }
        if request.guidance.len() > 2000 || request.guidance.contains('\0') {
            return Err("Limita las indicaciones adicionales a 2 KiB.".into());
        }
        let (_, source) = self.private_recording_source(id)?;
        let segments = check_source(&source, &request.source_revision)?;
        let (version, instructions) = skill(&request.mode)?;
        let key = self
            .openai_key()
            .ok_or("Configura una clave de OpenAI en Ajustes de IA.")?;
        if request.guidance.contains(&key)
            || segments.iter().any(|item| {
                item["text"]
                    .as_str()
                    .is_some_and(|text| text.contains(&key))
            })
        {
            return Err("La fuente contiene la clave configurada. Se ha detenido el envío.".into());
        }
        let input = json!({
            "partial": source["unconfirmedCount"].as_u64().unwrap_or(0) > 0,
            "guidance":request.guidance,
            "fragments":segments.iter()
                .filter(|item| item["text"].as_str().is_some_and(|text| !text.trim().is_empty()))
                .map(|item| json!({"id":item["id"],"text":item["text"]})).collect::<Vec<_>>(),
        });
        if input.to_string().len() > 120 * 1024 {
            return Err(
                "La transcripción supera el límite de un resumen. Se conserva el texto completo."
                    .into(),
            );
        }
        let _activity = self.private_work()?;
        self.spend_preflight(Some(MEETING_USAGE_SCOPE))?;
        let config = self.read_config_checked()?;
        let model = config["ai"]["model"]
            .as_str()
            .ok_or("Falta configurar el modelo de texto.")?;
        let completion = proton_text::complete(
            &key,
            model,
            &instructions,
            &input,
            &[TextAction::Answer],
            2800,
        );
        if let Some(usage) = completion.usage {
            self.record_ai_usage_records(
                MEETING_USAGE_SCOPE,
                &neubiki_core::compact_id("meeting-summary"),
                &json!({"usageRecords":[usage]}),
            )?;
        }
        let reply = completion.reply?;
        check_markdown(&reply.text, segments)?;
        let (_, current) = self.private_recording_source(id)?;
        check_source(&current, &request.source_revision)?;
        Ok(
            json!({"sessionId":id,"sourceRevision":request.source_revision,"skillId":SKILL_ID,"skillVersion":version,"mode":request.mode,"markdown":reply.text}),
        )
    }

    pub(super) fn save_recording_summary(&self, id: &str, body: Value) -> Result<Value, String> {
        let request: Save =
            serde_json::from_value(body).map_err(|_| "Resumen para guardar no válido.")?;
        let _save = SAVES
            .lock()
            .map_err(|_| "No se pudo coordinar el guardado del resumen.")?;
        let (path, source) = self.private_recording_source(id)?;
        check_markdown(
            &request.markdown,
            check_source(&source, &request.source_revision)?,
        )?;
        let (version, _) = skill(&request.mode)?;
        if request.skill_version != version {
            return Err("La versión de la habilidad cambió. Vuelve a generar el resumen.".into());
        }
        let existing = read_summary(&path, id)?;
        if let Some(summary) = existing.as_ref().filter(|current| {
            current.source_revision == request.source_revision
                && current.mode == request.mode
                && current.skill_version == version
                && current.markdown == request.markdown
        }) {
            return Ok(json!(summary));
        }
        if existing.as_ref().map(|item| item.revision.as_str())
            != request.expected_revision.as_deref()
        {
            return Err(
                "Hay otra revisión guardada. Vuelve a abrirla antes de sustituirla.".into(),
            );
        }
        let value = Summary {
            schema_version: 1,
            session_id: id.into(),
            source_revision: request.source_revision,
            revision: neubiki_core::compact_id("meeting"),
            skill_id: SKILL_ID.into(),
            skill_version: version,
            mode: request.mode,
            markdown: request.markdown,
            saved_at: neubiki_core::now_iso(),
        };
        neubiki_recording::atomic_json(&path, &value)?;
        Ok(json!(value))
    }
}

fn publication_time(seconds: u64) -> String {
    format!("{:02}:{:02}:{:02}", seconds / 3600, seconds % 3600 / 60, seconds % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use neubiki_recording::model::{Chunk, Destination, Session, Settings, Status};

    fn fixture(dir: &Path) -> (LocalApi, Session) {
        let api = LocalApi::new(dir.into(), "0.0.0".into(), "test".into());
        let root = dir.join(if cfg!(debug_assertions) {
            "recordings-dev"
        } else {
            "recordings"
        });
        let mut session = Session::new(
            Settings::default(),
            Some(Destination {
                project_id: MEETING_USAGE_SCOPE.into(),
                folder_id: None,
                name: "Reunión".into(),
            }),
        );
        session.meeting = true;
        session.status = Status::Completed;
        session.samples = 24_000;
        session.chunks = vec![Chunk {
            usage_receipt: None,
            usage_recorded: false,
            sha256: None,
            start: 0,
            samples: 24_000,
            status: "completed".into(),
            text: Some("El equipo revisó el plan.".into()),
            languages: vec!["es".into()],
        }];
        let path = root.join(&session.id);
        std::fs::create_dir_all(&path).unwrap();
        neubiki_recording::atomic_json(&path.join("session.json"), &session).unwrap();
        (api, session)
    }

    #[test]
    fn meeting_summary_validates_consent_source_and_format_before_provider_access() {
        let dir = tempfile::tempdir().unwrap();
        let (api, session) = fixture(dir.path());
        let (_, source) = api.private_recording_source(&session.id).unwrap();
        let mut request =
            json!({"sourceRevision":"stale","mode":"summary","guidance":"","confirmed":false});
        assert!(api
            .generate_recording_summary(&session.id, request.clone())
            .unwrap_err()
            .contains("Confirma"));
        request["confirmed"] = json!(true);
        assert!(api
            .generate_recording_summary(&session.id, request.clone())
            .unwrap_err()
            .contains("cambió"));
        request["sourceRevision"] = source["sourceRevision"].clone();
        request["mode"] = json!("unsupported");
        assert!(api
            .generate_recording_summary(&session.id, request)
            .unwrap_err()
            .contains("modo"));
        assert!(skill("summary").unwrap().1.contains("fragment"));
        assert!(skill("minutes").is_ok());
        assert!(api.read_recording_summary(&session.id).unwrap().is_null());
    }

    #[test]
    fn meeting_summary_saves_validated_markdown_and_rejects_a_conflicting_revision() {
        let dir = tempfile::tempdir().unwrap();
        let (api, session) = fixture(dir.path());
        let (path, source) = api.private_recording_source(&session.id).unwrap();
        let mut request = json!({
            "sourceRevision":source["sourceRevision"],"mode":"minutes","skillVersion":skill("minutes").unwrap().0,
            "expectedRevision":null,"markdown":"## Acta\nEl equipo revisó el plan. [fragment-2]"
        });
        assert!(api
            .save_recording_summary(&session.id, request.clone())
            .is_err());
        assert!(!path.exists());
        request["markdown"] = json!("## Acta\nEl equipo revisó el plan. [fragment-1]");
        let first = api
            .save_recording_summary(&session.id, request.clone())
            .unwrap();
        assert_eq!(
            api.save_recording_summary(&session.id, request.clone())
                .unwrap(),
            first
        );
        request["markdown"] = json!("## Acta revisada\nEl equipo revisó el plan. [fragment-1]");
        assert!(api
            .save_recording_summary(&session.id, request.clone())
            .is_err());
        assert_eq!(api.read_recording_summary(&session.id).unwrap(), first);
        request["expectedRevision"] = first["revision"].clone();
        let updated = api.save_recording_summary(&session.id, request).unwrap();
        assert_ne!(updated["revision"], first["revision"]);
        assert_eq!(api.read_recording_summary(&session.id).unwrap(), updated);
        assert_eq!(
            api.private_recording_source(&session.id).unwrap().1["sourceRevision"],
            source["sourceRevision"]
        );
    }
}
