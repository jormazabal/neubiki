use super::*;
use std::{fs::File, io::Read};
use time::OffsetDateTime;

const RETENTION_SECONDS: i64 = 7 * 24 * 60 * 60;
const MAX_RECORD_BYTES: u64 = 16 * 1024 * 1024;
const MAX_STORE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IDENTITIES: usize = 256;
static NOTE_AI_GATE: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    schema_version: u8,
    id: String,
    scope: DocumentScope,
    base_revision_id: String,
    page_id: String,
    page_sha256: String,
    base_text: String,
    kind: String,
    phase: String,
    model: String,
    created_at: i64,
    png: Option<String>,
    text: Option<String>,
    strokes: Option<Vec<Value>>,
    generated_elements: Option<Value>,
    corrected_text: Option<String>,
    applied_generation: Option<u64>,
    previous_generation: Option<u64>,
    applied_sha256: Option<String>,
    message: String,
}

struct NoteSource {
    content: Value,
    page: Value,
    revision: String,
    generation: Option<u64>,
    last_generation: u64,
}

impl Workspace<'_> {
    pub(super) fn sweep_note_ai(&self) -> Result<()> {
        let _store = NOTE_AI_GATE.lock().map_err(|_| private_location())?;
        if !check_regular_directory(&self.directory)?
            || !check_regular_directory(&self.directory.join("note-ai"))?
        {
            return Ok(());
        }
        for id in self.note_ai_ids()? {
            self.read_note_ai(&id)?;
        }
        Ok(())
    }

    pub(super) fn generate_note_ai(
        &self,
        api: &LocalApi,
        kind: &str,
        body: &Value,
        files: &[LocalApiFile],
    ) -> Result<Value> {
        self.generate_note_ai_with(
            api,
            kind,
            body,
            |key, model, png| neubiki_ai::handwritten_ocr::recognize_page(Some(key), model, png),
            generate_drawing,
            || {
                api.transcribe_proton_clip(
                    body,
                    files,
                    &super::super::proton_ai_text::proton_ai_project_id(body)?,
                ).map_err(|error| error.detail().to_owned())
            },
        )
    }

    fn generate_note_ai_with(
        &self,
        api: &LocalApi,
        kind: &str,
        body: &Value,
        recognize: impl FnOnce(&str, &str, &str) -> Value,
        draw: impl FnOnce(&str, &str, &str, &Value, &str, &Value) -> Value,
        transcribe: impl FnOnce() -> std::result::Result<Value, String>,
    ) -> Result<Value> {
        if body["confirmed"] != true || !matches!(kind, "ocr" | "drawing" | "transcription") {
            return Err(Error::input());
        }
        let scope: DocumentScope = parse_input(body)?;
        let document = self.document(&scope)?;
        self.sweep_note_ai()?;
        let id = attempt_id(body)?;
        let page_id = token(body, "pageId")?;
        let _private = api.private_work().map_err(Error::local)?;
        let project =
            super::super::proton_ai_text::proton_ai_project_id(body).map_err(Error::local)?;
        let config = permissions(api, kind)?;
        let key = api.openai_key().ok_or_else(|| {
            Error::new(
                409,
                "proton-note-ai-key",
                "Configura la clave de IA antes de enviar la página.",
            )
        })?;
        let model = match kind {
            "ocr" => config["ai"]["vision"]["model"].as_str(),
            "transcription" => config["ai"]["transcription"]["model"].as_str(),
            _ => config["ai"]["model"].as_str(),
        }
        .ok_or_else(Error::input)?
        .to_owned();
        neubiki_core::model_catalog::validate(
            &model,
            match kind {
                "ocr" => "vision",
                "transcription" => "transcription",
                _ => "text",
            },
        )
        .map_err(Error::local)?;
        let prompt = if kind == "drawing" {
            body["prompt"]
                .as_str()
                .map(str::trim)
                .filter(|text| {
                    !text.is_empty()
                        && text.len() <= 4096
                        && !text.contains('\0')
                        && !text.contains(&key)
                })
                .ok_or_else(|| {
                    Error::new(
                        422,
                        "proton-drawing-prompt",
                        "Describe el dibujo con un máximo de 4 KiB.",
                    )
                })?
        } else {
            ""
        };
        {
            let _store = NOTE_AI_GATE.lock().map_err(|_| private_location())?;
            if let Some(record) = self.read_note_ai(&id)? {
                check_owner(&record, &scope)?;
                if record.kind != kind || record.page_id != page_id {
                    return Err(Error::input());
                }
                return Ok(public(&record));
            }
        }
        let source = self.note_ai_source(&document, page_id)?;
        if source.revision != token(body, "baseRevisionId")?
            || source.generation != generation(body, "expectedGeneration")?
        {
            return Err(Error::generation());
        }
        let base_text = source.content["ocr"]["textByPage"][page_id]
            .as_str()
            .unwrap_or("")
            .to_owned();
        let page_sha256 = fingerprint(&source.page)?;
        let png = if kind == "transcription" {
            Vec::new()
        } else {
            neubiki_docs::handwritten_note_png(&source.content, Some(page_id), 0.8)
                .map_err(Error::local)?
                .1
        };
        if png.len() > 4 * 1024 * 1024 {
            return Err(Error::new(
                413,
                "proton-note-ai-image-large",
                "La imagen de página supera 4 MiB. Los trazos se conservan.",
            ));
        }
        api.spend_preflight(Some(&project)).map_err(Error::local)?;
        let mut record = Record {
            schema_version: 1,
            id,
            scope,
            base_revision_id: source.revision,
            page_id: page_id.into(),
            page_sha256,
            base_text,
            kind: kind.into(),
            phase: "started".into(),
            model,
            created_at: OffsetDateTime::now_utc().unix_timestamp(),
            png: if png.is_empty() {
                None
            } else {
                Some(BASE64.encode(png))
            },
            text: None,
            strokes: None,
            generated_elements: None,
            corrected_text: None,
            applied_generation: None,
            previous_generation: None,
            applied_sha256: None,
            message: "Envío iniciado. Consulta el resultado antes de volver a enviar.".into(),
        };
        {
            let _store = NOTE_AI_GATE.lock().map_err(|_| private_location())?;
            if let Some(previous) = self.read_note_ai(&record.id)? {
                check_owner(&previous, &record.scope)?;
                if previous.kind != kind || previous.page_id != record.page_id {
                    return Err(Error::input());
                }
                return Ok(public(&previous));
            }
            self.write_note_ai(&record, true).map_err(Error::unconfirmed)?;
        }
        // No document/store guard is held while the provider waits.
        permissions(api, kind).map_err(Error::unconfirmed)?;
        api.spend_preflight(Some(&project)).map_err(|detail| Error::local(detail).unconfirmed())?;
        let outcome = if kind == "ocr" {
            recognize(&key, &record.model, record.png.as_deref().unwrap_or(""))
        } else if kind == "transcription" {
            match transcribe() {
                Ok(result) => {
                    json!({"status":"ready","text":result["transcript"],"usageRecorded":result["usageRecorded"]})
                }
                Err(_) => json!({"status":"uncertain"}),
            }
        } else {
            draw(
                &key,
                &record.model,
                prompt,
                &source.content,
                page_id,
                &config["ai"]["handwrittenDrawing"],
            )
        };
        record.phase = match outcome["status"].as_str() {
            Some("ready") => "ready",
            Some("unavailable") => "unavailable",
            Some("failed") => "failed",
            _ => "uncertain",
        }
        .into();
        if record.phase == "ready" {
            if kind != "drawing" {
                let text = outcome["text"].as_str().filter(|text| valid_text(text));
                if let Some(text) = text {
                    let next_text = if kind == "transcription" && !record.base_text.is_empty() {
                        format!("{}\n\n{text}", record.base_text)
                    } else {
                        text.into()
                    };
                    if valid_text(&next_text) {
                        record.text = Some(next_text);
                    } else {
                        record.phase = "failed".into();
                    }
                } else {
                    record.phase = "failed".into();
                }
            } else if outcome["strokes"]
                .as_array()
                .is_some_and(|items| !items.is_empty() && items.len() <= 5000)
            {
                record.strokes = outcome["strokes"].as_array().cloned();
                record.generated_elements = outcome.get("generatedElements").cloned();
            } else {
                record.phase = "failed".into();
            }
        }
        record.message = if record.phase == "ready" {
            "Propuesta preparada. Revísala antes de aplicarla al borrador.".into()
        } else {
            "No se confirmó una propuesta completa. Puedes consultar este intento.".into()
        };
        if kind == "transcription" && outcome["usageRecorded"] == false {
            record
                .message
                .push_str(" El consumo quedó pendiente de registrar.");
        }
        if outcome["usage"].is_object() {
            if api
                .record_ai_usage_records(
                    &project,
                    &record.id,
                    &json!({"usageRecords":[outcome["usage"].clone()]}),
                )
                .is_err()
            {
                record
                    .message
                    .push_str(" El consumo quedó pendiente de registrar.");
            }
        }
        let _store = NOTE_AI_GATE.lock().map_err(|_| private_location().unconfirmed())?;
        self.write_note_ai(&record, false).map_err(Error::unconfirmed)?;
        Ok(public(&record))
    }

    pub(super) fn note_ai_action(
        &self,
        api: &LocalApi,
        action: &str,
        body: &Value,
    ) -> Result<Value> {
        let scope: DocumentScope = parse_input(body)?;
        let document = self.document(&scope)?;
        if action == "note-ai-catalog" {
            let _store = NOTE_AI_GATE.lock().map_err(|_| private_location())?;
            let mut items = Vec::new();
            for id in self.note_ai_ids()? {
                if let Some(record) = self.read_note_ai(&id)? {
                    if record.scope == scope && record.phase != "expired" {
                        let mut metadata = public(&record);
                        for key in ["text", "sourceDataUrl", "strokes", "generatedElements"] {
                            metadata[key] = Value::Null;
                        }
                        items.push(metadata);
                    }
                }
            }
            items.sort_by(|left, right| {
                right["createdAt"].as_i64().cmp(&left["createdAt"].as_i64())
            });
            return Ok(json!({"items":items}));
        }
        let id = attempt_id(body)?;
        let _store = NOTE_AI_GATE.lock().map_err(|_| private_location())?;
        let mut record = self.read_note_ai(&id)?.ok_or_else(|| {
            Error::new(
                404,
                "proton-note-ai-missing",
                "El intento no está disponible.",
            )
        })?;
        check_owner(&record, &scope)?;
        if record.phase == "applying" {
            let _draft = gate()?;
            let journal = self.load_journal(&document)?;
            if journal.is_handwritten()
                && journal
                    .draft
                    .as_ref()
                    .is_some_and(|draft| Some(draft.generation) == record.applied_generation)
                && serde_json::from_str::<Value>(&journal.markdown)
                    .ok()
                    .is_some_and(|note| {
                        fingerprint(&note).ok().as_ref() == record.applied_sha256.as_ref()
                    })
            {
                record.phase = "applied".into();
                record.message = "Aplicación observada en el borrador conservado.".into();
                self.write_note_ai(&record, false)?;
            }
        }
        if action == "note-ai-check" {
            if record.phase == "applied" {
                let _draft = gate()?;
                let journal = self.load_journal(&document)?;
                if journal
                    .draft
                    .as_ref()
                    .is_some_and(|draft| Some(draft.generation) == record.applied_generation)
                {
                    return Ok(
                        json!({"receipt":public(&record),"draft":journal.draft_value(),"previousGeneration":record.previous_generation}),
                    );
                }
            }
            return Ok(json!({"receipt":public(&record)}));
        }
        if action != "note-ai-apply" || body["confirmed"] != true {
            return Err(Error::input());
        }
        if record.phase != "ready" {
            return Ok(json!({"receipt":public(&record)}));
        }
        permissions(api, &record.kind)?;
        let current = self.note_ai_source(&document, &record.page_id)?;
        if current.revision != record.base_revision_id
            || fingerprint(&current.page)? != record.page_sha256
            || current.content["ocr"]["textByPage"][&record.page_id]
                .as_str()
                .unwrap_or("")
                != record.base_text
            || current.generation != generation(body, "expectedGeneration")?
        {
            return Err(Error::new(
                409,
                "proton-note-ai-source-changed",
                "La página o su revisión cambió. La propuesta se conserva para revisión.",
            ));
        }
        let mut next = current.content;
        if record.kind != "drawing" {
            let text = body["text"]
                .as_str()
                .filter(|text| valid_text(text))
                .ok_or_else(Error::input)?;
            next["ocr"]["textByPage"][&record.page_id] = json!(text);
            next["ocr"]["status"] = json!("updated");
            next["ocr"]["updatedAt"] = json!(neubiki_core::now_iso());
            let total: usize = next["ocr"]["textByPage"]
                .as_object()
                .ok_or_else(Error::input)?
                .values()
                .map(|text| text.as_str().map(str::len).unwrap_or(usize::MAX / 1024))
                .sum();
            if total > 512 * 1024 {
                return Err(Error::new(
                    413,
                    "proton-note-ai-text-large",
                    "La nota supera 512 KiB de texto reconocido.",
                ));
            }
            record.corrected_text = Some(text.into());
        } else {
            let page = next["pages"]
                .as_array_mut()
                .and_then(|pages| pages.iter_mut().find(|page| page["id"] == record.page_id))
                .ok_or_else(Error::input)?;
            page["strokes"]
                .as_array_mut()
                .ok_or_else(Error::input)?
                .extend(record.strokes.clone().ok_or_else(Error::input)?);
            if let Some(elements) = &record.generated_elements {
                page["generatedElements"] = elements.clone();
            }
            page["updatedAt"] = json!(neubiki_core::now_iso());
        }
        next["updatedAt"] = json!(neubiki_core::now_iso());
        handwritten::serialize_note(&next)?;
        record.phase = "applying".into();
        record.applied_generation = current.last_generation.checked_add(1);
        record.previous_generation = current.generation;
        record.applied_sha256 = Some(fingerprint(&next)?);
        record.message = "Aplicación pendiente de comprobar.".into();
        self.write_note_ai(&record, false)?;
        let result = self.draft(&document, &json!({
            "baseRevisionId":current.revision,"expectedGeneration":current.generation,
            "documentName": if is_handwritten(body["documentName"].as_str().unwrap_or("")) { body["documentName"].as_str().unwrap() } else { "Nota manuscrita.nbnote" },
            "handwritten":next,
        }))?;
        record.phase = "applied".into();
        record.applied_generation = result["generation"].as_u64();
        record.applied_sha256 = Some(fingerprint(&next)?);
        record.message =
            "Propuesta aplicada al borrador. Guarda la nota para compartirla en Proton.".into();
        self.write_note_ai(&record, false)?;
        Ok(
            json!({"draft":result,"previousGeneration":current.generation,"receipt":public(&record)}),
        )
    }

    fn note_ai_source(&self, document: &Document<'_>, page_id: &str) -> Result<NoteSource> {
        let remote = self.remote_read(document, None)?;
        if !is_handwritten(&remote.node.name) {
            return Err(Error::input());
        }
        let note = read_preview_note(&remote, &document.id)?;
        let _draft = gate()?;
        self.check_selection(&document.scope.account_id, &document.scope.root_id)?;
        let journal = self.load_journal(document)?;
        if journal.attempt.is_some()
            || journal
                .draft
                .as_ref()
                .is_some_and(|draft| draft.conflict || draft.base_revision_id != remote.revision_id)
        {
            return Err(Error::new(
                409,
                "proton-note-ai-conflict",
                "Resuelve el guardado o el conflicto antes de trabajar con la página.",
            ));
        }
        let generation = journal.draft.as_ref().map(|draft| draft.generation);
        let content = if generation.is_some() {
            if !journal.is_handwritten() {
                return Err(Error::input());
            }
            serde_json::from_str::<Value>(&journal.markdown).map_err(|_| private_location())?
        } else {
            note
        };
        let page = content["pages"]
            .as_array()
            .and_then(|pages| pages.iter().find(|page| page["id"] == page_id))
            .ok_or_else(|| {
                Error::new(
                    409,
                    "proton-note-ai-page-changed",
                    "La página seleccionada ya no está disponible.",
                )
            })?
            .clone();
        Ok(NoteSource {
            content,
            page,
            revision: remote.revision_id,
            generation,
            last_generation: journal.last_generation,
        })
    }

    fn note_ai_directory(&self) -> Result<PathBuf> {
        ensure_directory(&self.directory)?;
        let directory = self.directory.join("note-ai");
        ensure_directory(&directory)?;
        Ok(directory)
    }

    fn note_ai_ids(&self) -> Result<Vec<String>> {
        let directory = self.note_ai_directory()?;
        let mut ids = Vec::new();
        let mut total = 0;
        for entry in fs::read_dir(directory).map_err(|_| private_location())? {
            let entry = entry.map_err(|_| private_location())?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| private_location())?;
            let id = name
                .strip_suffix(".json")
                .filter(|id| valid_id(id))
                .ok_or_else(private_location)?;
            let meta = fs::symlink_metadata(entry.path()).map_err(|_| private_location())?;
            if !meta.is_file() || batch::linked(&meta) || meta.len() > MAX_RECORD_BYTES {
                return Err(private_location());
            }
            total += meta.len();
            ids.push(id.into());
            if ids.len() > MAX_IDENTITIES || total > MAX_STORE_BYTES {
                return Err(private_location());
            }
        }
        Ok(ids)
    }

    fn read_note_ai(&self, id: &str) -> Result<Option<Record>> {
        let path = self.note_ai_directory()?.join(format!("{id}.json"));
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(private_location()),
        };
        if !meta.is_file() || batch::linked(&meta) || meta.len() > MAX_RECORD_BYTES {
            return Err(private_location());
        }
        let mut bytes = Vec::new();
        File::open(&path)
            .and_then(|file| file.take(MAX_RECORD_BYTES + 1).read_to_end(&mut bytes))
            .map_err(|_| private_location())?;
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err(private_location());
        }
        let mut record: Record = serde_json::from_slice(&bytes).map_err(|_| private_location())?;
        if record.schema_version != 1
            || record.id != id
            || !valid_id(id)
            || !matches!(record.kind.as_str(), "ocr" | "drawing" | "transcription")
            || !matches!(
                record.phase.as_str(),
                "started"
                    | "applying"
                    | "applied"
                    | "ready"
                    | "uncertain"
                    | "failed"
                    | "unavailable"
                    | "expired"
            )
            || !valid_revision(&record.scope.node_id, &record.base_revision_id)
            || record.page_sha256.len() != 64
            || record.created_at < 0
            || record.created_at
                > OffsetDateTime::now_utc()
                    .unix_timestamp()
                    .saturating_add(60)
            || Workspace::document_key(&record.scope).is_err()
            || record.text.as_deref().is_some_and(|text| !valid_text(text))
        {
            return Err(private_location());
        }
        if OffsetDateTime::now_utc()
            .unix_timestamp()
            .saturating_sub(record.created_at)
            >= RETENTION_SECONDS
            && record.phase != "expired"
        {
            record.phase = "expired".into();
            record.png = None;
            record.text = None;
            record.strokes = None;
            record.generated_elements = None;
            record.corrected_text = None;
            record.base_text.clear();
            record.message = "La propuesta caducó a los siete días.".into();
            self.write_note_ai(&record, false)?;
        }
        Ok(Some(record))
    }

    fn write_note_ai(&self, record: &Record, create: bool) -> Result<()> {
        let bytes = serde_json::to_vec(record).map_err(|_| private_location())?;
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err(Error::new(
                413,
                "proton-note-ai-large",
                "La propuesta supera el límite privado de 16 MiB.",
            ));
        }
        let directory = self.note_ai_directory()?;
        let ids = self.note_ai_ids()?;
        if create && ids.len() >= MAX_IDENTITIES {
            return Err(Error::new(
                413,
                "proton-note-ai-full",
                "El registro de propuestas alcanzó su capacidad.",
            ));
        }
        let mut total = bytes.len() as u64;
        for id in ids.iter().filter(|id| *id != &record.id) {
            total += fs::symlink_metadata(directory.join(format!("{id}.json")))
                .map_err(|_| private_location())?
                .len();
        }
        if total > MAX_STORE_BYTES {
            return Err(Error::new(
                413,
                "proton-note-ai-full",
                "El registro privado de propuestas está lleno.",
            ));
        }
        let path = directory.join(format!("{}.json", record.id));
        if create {
            atomic_io::create(&path, &bytes)
        } else {
            atomic_io::write(&path, &bytes)
        }
        .map_err(|_| private_location())
    }
}

fn public(record: &Record) -> Value {
    json!({"attemptId":record.id,"pageId":record.page_id,"kind":record.kind,
        "phase":if matches!(record.phase.as_str(),"started"|"applying") {"uncertain"} else {record.phase.as_str()},
        "message":record.message,"createdAt":record.created_at,"expiresAt":record.created_at + RETENTION_SECONDS,
        "text":record.corrected_text.as_ref().or(record.text.as_ref()),
        "sourceDataUrl":record.png.as_ref().map(|png|format!("data:image/png;base64,{png}")),
        "strokes":record.strokes,"generatedElements":record.generated_elements,
        "appliedGeneration":record.applied_generation,"appliedSha256":record.applied_sha256})
}

fn check_owner(record: &Record, scope: &DocumentScope) -> Result<()> {
    if record.scope == *scope {
        Ok(())
    } else {
        Err(Error::new(
            403,
            "proton-note-ai-scope",
            "El intento pertenece a otro documento.",
        ))
    }
}

fn permissions(api: &LocalApi, kind: &str) -> Result<Value> {
    let config = api.read_config_checked().map_err(Error::local)?;
    let ai = &config["ai"];
    if ai["permissions"]["editHandwrittenNotes"] != true
        || kind == "ocr" && ai["vision"]["enabled"] != true
        || kind == "transcription" && ai["transcription"]["enabled"] != true
        || kind == "drawing"
            && (ai["permissions"]["drawHandwrittenNotes"] != true
                || ai["handwrittenDrawing"]["enabled"] != true)
    {
        return Err(Error::new(
            403,
            "proton-note-ai-permission",
            "Activa la capacidad y el permiso de edición de notas manuscritas en Configuración.",
        ));
    }
    Ok(config)
}

fn attempt_id(body: &Value) -> Result<String> {
    token(body, "attemptId").and_then(|id| {
        if valid_id(id) {
            Ok(id.into())
        } else {
            Err(Error::input())
        }
    })
}

fn valid_id(id: &str) -> bool {
    id.starts_with("note-ai-")
        && id.len() <= 96
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn valid_text(text: &str) -> bool {
    text.len() <= 256 * 1024 && text.chars().count() <= 64_000 && !text.contains('\0')
}

fn fingerprint(value: &Value) -> Result<String> {
    serde_json::to_vec(value)
        .map(|bytes| super::super::sha256_hex(&bytes))
        .map_err(|_| private_location())
}

fn generate_drawing(
    key: &str,
    model: &str,
    prompt: &str,
    note: &Value,
    page_id: &str,
    config: &Value,
) -> Value {
    let page = note["pages"]
        .as_array()
        .and_then(|pages| pages.iter().find(|page| page["id"] == page_id));
    let Some(page) = page else {
        return json!({"status":"failed"});
    };
    let completion = neubiki_ai::proton_text::complete(key, model,
        "Create a semantic scene for editable handwritten strokes in Neubiki. Return kind=answer and put only a JSON object in text, without code fences. The object has route and sceneSpec:{elements:[]}. route is drawing_flow, drawing_architecture, drawing_timeline, drawing_matrix, drawing_mindmap, drawing_wireframe or drawing_creative_sketch. Each element has id and type. Types are shape (shape: square, triangle, circle, ellipse, diamond, star), diagram_node (text), connector (from,to), text_block (text), annotation (text), label (text), symbol (symbol: house,sun,dog,cat,person,face,tree,cloud,server,laptop,database,rocket,starship,spacecraft), portrait, fill_region or shadow_region (target,fill). Roles are primary_outline,secondary_sketch,text,connector,accent,highlight,shadow,fill_light,fill_dense. Use portrait/symbol for illustrative objects rather than diagrams of parts. Keep at most 32 elements and short text. Do not include raw coordinates, raw strokes, file actions or replacement instructions.",
        &json!({"prompt":prompt,"pageSize":page["size"],"existingStrokeCount":page["strokes"].as_array().map(Vec::len)}),
        &[neubiki_ai::proton_text::TextAction::Answer], 7000);
    let usage = completion.usage;
    let output = (|| -> std::result::Result<Value, String> {
        let reply = completion.reply?;
        let scene: Value = serde_json::from_str(&reply.text)
            .map_err(|_| "La propuesta no contiene una escena estructurada.")?;
        let elements = scene["sceneSpec"]["elements"]
            .as_array()
            .filter(|elements| !elements.is_empty() && elements.len() <= 32)
            .ok_or("La escena no tiene elementos válidos.")?;
        if elements
            .iter()
            .any(|element| !element.is_object() || element["id"].as_str().is_none())
        {
            return Err("La escena contiene elementos inválidos.".into());
        }
        let route = scene["route"]
            .as_str()
            .filter(|route| {
                matches!(
                    *route,
                    "drawing_flow"
                        | "drawing_architecture"
                        | "drawing_timeline"
                        | "drawing_matrix"
                        | "drawing_mindmap"
                        | "drawing_wireframe"
                        | "drawing_creative_sketch"
                )
            })
            .ok_or("El tipo de dibujo no es compatible.")?;
        if route == "drawing_creative_sketch" && config["creativeSketchEnabled"] != true {
            return Err("El dibujo creativo está desactivado.".into());
        }
        let result = neubiki_drawing::apply_handwritten_drawing(
            note,
            &json!({
                "targetPageId":page_id,"replacementPolicy":"append_only","route":route,"sceneSpec":scene["sceneSpec"],
            }),
            config,
        )?;
        let next = result["content"]["pages"]
            .as_array()
            .and_then(|pages| pages.iter().find(|page| page["id"] == page_id))
            .ok_or("La propuesta no contiene la página.")?;
        let original = page["strokes"]
            .as_array()
            .ok_or("La página no contiene trazos.")?;
        let strokes = next["strokes"]
            .as_array()
            .filter(|strokes| strokes.starts_with(original) && strokes.len() > original.len())
            .ok_or("La propuesta no conserva los trazos existentes.")?;
        super::super::document_validation::handwritten(&result["content"])?;
        Ok(
            json!({"status":"ready","strokes":strokes[original.len()..],"generatedElements":next["generatedElements"]}),
        )
    })();
    let mut result = output.unwrap_or_else(|message| json!({"status":"failed","message":message}));
    result["usage"] = json!(usage);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn proton_note_ai_ocr_keeps_other_pages_and_reconciles_an_applied_receipt() {
        let temp = tempfile::tempdir().unwrap();
        let api = LocalApi::new(temp.path().join("profile"), "qa".into(), "tests".into());
        api.update_credentials(|credentials| {
            credentials.insert(
                "openaiKey".into(),
                json!("synthetic-never-used-provider-key"),
            );
        })
        .unwrap();
        let mut config = api.read_config_checked().unwrap()["ai"].clone();
        config["permissions"]["editHandwrittenNotes"] = json!(true);
        config["vision"]["enabled"] = json!(true);
        api.update_ai_config(config).unwrap();
        let mut original = handwritten::new_note("Test.nbnote");
        let mut second = original["pages"][0].clone();
        second["id"] = json!("page-2");
        original["pages"].as_array_mut().unwrap().push(second);
        let data = RefCell::new(original.clone());
        let provider = |_: &str, action: &str, _: Value| match action {
            "drive.workspaceFolder" => {
                Ok(json!({"nodeId":"v~root","name":"Project","type":"folder"}))
            }
            "drive.workspaceRead" => Ok(
                json!({"node":{"nodeId":"v~note","name":"Test.nbnote","type":"file","revisionId":"v~note~base"},
                "revisionId":"v~note~base","contentBase64":BASE64.encode(data.borrow().to_string())}),
            ),
            _ => panic!("Unexpected provider action {action}"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &provider,
            can_write: true,
        };
        let scope = json!({"accountId":"account","rootId":"v~root","nodeId":"v~note"});
        workspace.handle("select", scope.clone()).unwrap();
        let mut request = scope.clone();
        request["pageId"] = json!("page-1");
        request["baseRevisionId"] = json!("v~note~base");
        request["expectedGeneration"] = Value::Null;
        request["attemptId"] = json!("note-ai-fixture-ocr");
        request["confirmed"] = json!(true);
        let calls = Cell::new(0);
        let recognized = workspace
            .generate_note_ai_with(
                &api,
                "ocr",
                &request,
                |_, _, image| {
                    calls.set(calls.get() + 1);
                    assert!(!image.is_empty());
                    json!({"status":"ready","text":"Source text"})
                },
                |_, _, _, _, _, _| panic!("Drawing cannot run during OCR"),
                || panic!("Audio cannot run during OCR"),
            )
            .unwrap();
        assert_eq!(recognized["phase"], "ready");
        assert_eq!(calls.get(), 1);
        workspace
            .generate_note_ai_with(
                &api,
                "ocr",
                &request,
                |_, _, _| panic!("Existing attempt cannot repeat a provider call"),
                |_, _, _, _, _, _| panic!("Drawing cannot run during OCR"),
                || panic!("Audio cannot run during OCR"),
            )
            .unwrap();
        let mut changed = original.clone();
        changed["pages"][1]["title"] = json!("Later page title");
        let mut draft = scope.clone();
        draft["baseRevisionId"] = json!("v~note~base");
        draft["expectedGeneration"] = Value::Null;
        draft["documentName"] = json!("Test.nbnote");
        draft["handwritten"] = changed.clone();
        workspace.handle("draft", draft).unwrap();
        request["expectedGeneration"] = json!(1);
        request["documentName"] = json!("Test.nbnote");
        request["text"] = json!("Reviewed text");
        let result = workspace
            .note_ai_action(&api, "note-ai-apply", &request)
            .unwrap();
        assert_eq!(result["draft"]["handwritten"]["pages"], changed["pages"]);
        assert_eq!(
            result["draft"]["handwritten"]["ocr"]["textByPage"]["page-1"],
            "Reviewed text"
        );
        assert_eq!(result["draft"]["generation"], 2);
        assert_eq!(result["receipt"]["phase"], "applied");
        assert_eq!(
            workspace
                .note_ai_action(&api, "note-ai-check", &request)
                .unwrap()["draft"]["generation"],
            2
        );
        assert_eq!(*data.borrow(), original);

        let mut expired = workspace
            .read_note_ai("note-ai-fixture-ocr")
            .unwrap()
            .unwrap();
        expired.created_at = OffsetDateTime::now_utc().unix_timestamp() - RETENTION_SECONDS;
        workspace.write_note_ai(&expired, false).unwrap();
        assert_eq!(
            workspace
                .note_ai_action(&api, "note-ai-check", &request)
                .unwrap()["receipt"]["phase"],
            "expired"
        );
        let retired = workspace
            .read_note_ai("note-ai-fixture-ocr")
            .unwrap()
            .unwrap();
        assert!(
            retired.png.is_none() && retired.text.is_none() && retired.corrected_text.is_none()
        );

        let mut config = api.read_config_checked().unwrap()["ai"].clone();
        config["transcription"]["enabled"] = json!(true);
        api.update_ai_config(config).unwrap();
        request["attemptId"] = json!("note-ai-fixture-audio");
        request["expectedGeneration"] = json!(2);
        let transcript = workspace
            .generate_note_ai_with(
                &api,
                "transcription",
                &request,
                |_, _, _| panic!("Audio cannot invoke vision"),
                |_, _, _, _, _, _| panic!("Audio cannot invoke drawing"),
                || Ok(json!({"transcript":"Dictated addition","usageRecorded":true})),
            )
            .unwrap();
        assert_eq!(transcript["text"], "Reviewed text\n\nDictated addition");
        assert!(transcript["sourceDataUrl"].is_null());
        assert!(workspace
            .note_ai_action(&api, "note-ai-catalog", &scope)
            .unwrap()["items"][0]["text"]
            .is_null());

        // A changed target page must never be overwritten by an old proposal.
        let mut note = result["draft"]["handwritten"].clone();
        note["pages"][0]["title"] = json!("Changed while reviewing dictation");
        let mut changed_request = scope.clone();
        changed_request["baseRevisionId"] = json!("v~note~base");
        changed_request["expectedGeneration"] = json!(2);
        changed_request["handwritten"] = note;
        changed_request["documentName"] = json!("Test.nbnote");
        workspace.handle("draft", changed_request).unwrap();
        request["expectedGeneration"] = json!(3);
        request["text"] = transcript["text"].clone();
        assert!(workspace
            .note_ai_action(&api, "note-ai-apply", &request)
            .is_err());
        assert_eq!(*data.borrow(), original);
    }
}
