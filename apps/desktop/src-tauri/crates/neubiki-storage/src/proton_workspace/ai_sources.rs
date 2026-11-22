use super::*;

const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 24 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AiSourceRef {
    pub node_id: String,
    pub revision_id: String,
}

pub(crate) enum AiSourceContent {
    Text(String),
    Image(String),
}

pub(crate) struct AiSource {
    pub name: String,
    pub content: AiSourceContent,
}

impl Workspace<'_> {
    pub(super) fn assistant_sources(
        &self,
        body: &Value,
        image_limit: Option<usize>,
    ) -> Result<Vec<AiSource>> {
        let Some(value) = body.get("sources") else {
            return Ok(Vec::new());
        };
        let target: DocumentScope = parse_input(body)?;
        let selection = value
            .as_array()
            .filter(|sources| sources.len() <= 3)
            .ok_or_else(Error::input)?;
        let mut seen = BTreeSet::new();
        let mut sources = Vec::with_capacity(selection.len());
        for requested in selection {
            let requested: AiSourceRef =
                serde_json::from_value(requested.clone()).map_err(|_| Error::input())?;
            if requested.node_id == target.node_id
                || !seen.insert(requested.node_id.clone())
                || !valid_revision(&requested.node_id, &requested.revision_id)
            {
                return Err(Error::input());
            }
            let source = self.assistant_source(&target, &requested, image_limit)?;
            if matches!(source.content, AiSourceContent::Image(_))
                && sources
                    .iter()
                    .any(|source: &AiSource| matches!(source.content, AiSourceContent::Image(_)))
            {
                return Err(source_error("Elige una sola imagen por consulta."));
            }
            sources.push(source);
        }
        self.check_selection(&target.account_id, &target.root_id)?;
        Ok(sources)
    }

    pub(super) fn assistant_source(
        &self,
        target: &DocumentScope,
        requested: &AiSourceRef,
        image_limit: Option<usize>,
    ) -> Result<AiSource> {
        if !valid_revision(&requested.node_id, &requested.revision_id) {
            return Err(Error::input());
        }
        let scope = DocumentScope {
            account_id: target.account_id.clone(),
            root_id: target.root_id.clone(),
            node_id: requested.node_id.clone(),
        };
        let source = self.document(&scope)?;
        let mut request = source.request();
        request["search"] = json!(true);
        request["expectedRevisionId"] = json!(requested.revision_id);
        let remote: RemoteRead =
            self.provider(&scope.account_id, "drive.workspaceRead", request)?;
        validate_node(&remote.node)?;
        if remote.node.node_id != scope.node_id
            || remote.node.kind != NodeKind::File
            || super::super::path_policy::reserved(std::ffi::OsStr::new(&remote.node.name))
            || remote.node.revision_id.as_deref() != Some(remote.revision_id.as_str())
            || remote.revision_id != requested.revision_id
            || remote.ancestor_ids.as_ref().and_then(|ids| ids.first()) != Some(&scope.root_id)
            || remote.content_base64.len() > 4 * MAX_SOURCE_BYTES.div_ceil(3)
        {
            return Err(source_error(
                "La fuente cambió o ya no está disponible en la carpeta de trabajo.",
            ));
        }
        let bytes = BASE64
            .decode(&remote.content_base64)
            .map_err(|_| Error::invalid_response())?;
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err(source_error("Cada fuente admite hasta 2 MiB."));
        }
        let content = source_content(&remote.node.name, bytes, remote.content_base64, image_limit)?;
        Ok(AiSource {
            name: remote.node.name,
            content,
        })
    }
}

fn source_content(
    name: &str,
    bytes: Vec<u8>,
    base64: String,
    image_limit: Option<usize>,
) -> Result<AiSourceContent> {
    let extension = name
        .rsplit_once('.')
        .map_or("", |(_, extension)| extension)
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        let Some(limit) = image_limit else {
            return Err(source_error(
                "Activa Visión en Configuración de IA para enviar una imagen.",
            ));
        };
        if bytes.len() > limit {
            return Err(source_error(
                "La imagen supera el límite de tamaño de Visión.",
            ));
        }
        let mime = checked_image_type(&base64).map_err(Error::local)?;
        let expected = match extension.as_str() {
            "png" => "image/png",
            "webp" => "image/webp",
            _ => "image/jpeg",
        };
        if mime != expected {
            return Err(source_error("La imagen no coincide con su formato."));
        }
        return Ok(AiSourceContent::Image(format!(
            "data:{mime};base64,{base64}"
        )));
    }
    let text = match extension.as_str() {
        "md" | "markdown" | "mdown" | "txt" | "csv" | "tsv" | "log" | "json" => {
            String::from_utf8(bytes)
                .map_err(|_| source_error("La fuente no está codificada en UTF-8."))?
        }
        "pdf" => {
            let pages = neubiki_docs::extract_pdf_pages_bounded(&bytes, MAX_SOURCE_BYTES)
                .map_err(|_| source_error("No se pudo extraer texto del PDF."))?;
            let mut text = String::new();
            for (page, page_text) in pages {
                if !page_text.trim().is_empty() {
                    text.push_str(&format!("\n\nPágina {page}\n{page_text}"));
                }
                if text.len() > MAX_TEXT_BYTES {
                    break;
                }
            }
            text
        }
        "docx" | "xlsx" => neubiki_docs::extract_office_body_text_bounded(&bytes, MAX_SOURCE_BYTES)
            .map_err(|_| source_error("No se pudo extraer texto de la fuente de Office."))?,
        "nbnote" | "knote" => {
            let structured = std::str::from_utf8(&bytes)
                .map_err(|_| source_error("No se pudo leer la nota manuscrita."))?;
            let pages = super::super::local_search::note_text_pages(structured).map_err(|_| {
                source_error("No se pudo leer el texto guardado de la nota manuscrita.")
            })?;
            let mut text = String::new();
            for (page, _, page_text) in pages {
                text.push_str(&format!("\n\nPágina {page}\n{page_text}"));
                if text.len() > MAX_TEXT_BYTES {
                    break;
                }
            }
            text
        }
        _ => {
            return Err(source_error(
                "El formato de esta fuente no es compatible con el asistente.",
            ))
        }
    };
    if text.trim().is_empty() || text.contains('\0') || text.len() > MAX_TEXT_BYTES {
        return Err(source_error(
            "La fuente debe contener texto legible de hasta 24 KiB.",
        ));
    }
    Ok(AiSourceContent::Text(text))
}

fn source_error(detail: &'static str) -> Error {
    Error::new(422, "proton-ai-source", detail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn proton_assistant_requires_the_reviewed_source_revision_and_project_ancestry() {
        let temporary = tempfile::tempdir().unwrap();
        let reads = Cell::new(0);
        let current_revision = Cell::new("volume~source~saved");
        let parent = Cell::new("volume~root");
        let provider = |_: &str, action: &str, request: Value| match action {
            "drive.workspaceFolder" => {
                Ok(json!({"nodeId":"volume~root", "name":"Proyecto", "type":"folder"}))
            }
            "drive.workspaceRead" => {
                reads.set(reads.get() + 1);
                assert_eq!(request["rootId"], "volume~root");
                assert_eq!(request["nodeId"], "volume~source");
                assert_eq!(request["expectedRevisionId"], "volume~source~saved");
                assert_eq!(request["search"], true);
                Ok(json!({
                    "node":{"nodeId":"volume~source","name":"Resumen.md","type":"file","revisionId":current_revision.get()},
                    "revisionId":current_revision.get(), "ancestorIds":[parent.get()],
                    "contentBase64": BASE64.encode("# Contenido guardado")
                }))
            }
            _ => panic!("Unexpected provider action"),
        };
        let workspace = Workspace {
            directory: temporary.path().join("workspace"),
            invoke: &provider,
            can_write: false,
        };
        workspace
            .handle(
                "select",
                json!({"accountId":"account","rootId":"volume~root"}),
            )
            .unwrap();
        let request = json!({
            "accountId":"account", "rootId":"volume~root", "nodeId":"volume~target",
            "sources":[{"nodeId":"volume~source","revisionId":"volume~source~saved"}]
        });
        let attached = workspace.assistant_sources(&request, None).unwrap();
        assert_eq!(attached[0].name, "Resumen.md");
        assert!(
            matches!(&attached[0].content, AiSourceContent::Text(text) if text == "# Contenido guardado")
        );
        current_revision.set("volume~source~changed");
        assert!(workspace.assistant_sources(&request, None).is_err());
        current_revision.set("volume~source~saved");
        parent.set("volume~other");
        assert!(workspace.assistant_sources(&request, None).is_err());
        let mut malformed = request;
        malformed["sources"][0]["content"] =
            json!("An arbitrary client cannot supply source bytes.");
        assert!(workspace.assistant_sources(&malformed, None).is_err());
        assert_eq!(reads.get(), 3);
    }
}
