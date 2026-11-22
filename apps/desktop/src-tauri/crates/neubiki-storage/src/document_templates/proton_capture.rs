//! Review and capture only verified saved Proton data. The existing portable renderer owns the result.
use super::super::proton_workspace::{SavedTemplateAsset, SavedTemplateSource};
use super::*;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::{
    io::Cursor,
    time::{Duration, Instant},
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    account_id: String,
    root_id: String,
    node_id: String,
    revision_id: String,
}
impl Source {
    fn body(&self) -> Value {
        json!({"accountId":self.account_id,"rootId":self.root_id,"nodeId":self.node_id,"revisionId":self.revision_id})
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Save {
    account_id: String,
    root_id: String,
    node_id: String,
    revision_id: String,
    operation_id: String,
    digest: String,
    name: String,
    description: String,
    acknowledge: bool,
}
impl Save {
    fn source(&self) -> Source {
        Source {
            account_id: self.account_id.clone(),
            root_id: self.root_id.clone(),
            node_id: self.node_id.clone(),
            revision_id: self.revision_id.clone(),
        }
    }
    fn id(&self) -> Result<String, String> {
        if !self.operation_id.starts_with("template-capture-")
            || self.operation_id.len() > 100
            || !request_scope::portable_id(&self.operation_id)
            || self.digest.len() != 64
            || !self.digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            || self.name.trim().is_empty()
            || self.name.len() > 240
            || self.name.chars().any(char::is_control)
            || self.description.len() > 2000
        {
            return Err("Identidad o revisión de captura no válida".into());
        }
        Ok(format!("custom-{}", self.operation_id))
    }
}
struct Prepared {
    source: Value,
    markdown: String,
    attachments: Vec<Attachment>,
    resources: Vec<Value>,
    digest: String,
}
impl Prepared {
    fn public(&self) -> Value {
        json!({"schemaVersion":1,"source":self.source,"markdown":self.markdown,"resources":self.resources,"digest":self.digest,
        "privateDraftsIncluded":false,"complete":true,"checkedAt":neubiki_core::now_iso()})
    }
}
impl LocalApi {
    pub(crate) fn prepare_proton_template_capture(&self, body: Value) -> Result<Value, String> {
        validate_runtime_input(&body, &[])?;
        let source: Source = serde_json::from_value(body)
            .map_err(|_| "La captura necesita la identidad y revisión guardada del documento")?;
        Ok(self.proton_capture_prepared(&source)?.public())
    }
    fn proton_capture_prepared(&self, source: &Source) -> Result<Prepared, String> {
        let body = source.body();
        prepare(
            source,
            &|| self.proton_template_source(&body),
            &|relative| self.proton_template_asset(&body, relative),
        )
    }
    pub(crate) fn capture_proton_template(&self, body: Value) -> Result<Value, String> {
        validate_runtime_input(&body, &[])?;
        let input: Save =
            serde_json::from_value(body).map_err(|_| "Revisa la captura antes de guardarla")?;
        let id = input.id()?;
        if !input.acknowledge {
            return Err(
                "Confirma que quieres reutilizar este contenido y sus recursos en el dispositivo"
                    .into(),
            );
        }
        // Even a no-op save requires the same saved revision and resources. Querying an existing result is separate.
        let prepared = self.proton_capture_prepared(&input.source())?;
        if prepared.digest != input.digest {
            return Err(
                "El documento o uno de sus recursos cambió. Vuelve a revisar la captura.".into(),
            );
        }
        self.proton_batch_scope(&input.source().body())?;
        let template = self.capture_document_template_owned(
            json!({"name":input.name,"description":input.description,"markdown":prepared.markdown,
            "resources":prepared.attachments,"reviewedResources":true}),
            Some(&id),
            Some(&input.digest),
        )?;
        Ok(
            json!({"schemaVersion":1,"operationId":input.operation_id,"digest":input.digest,"state":"saved","template":template,"checkedAt":neubiki_core::now_iso()}),
        )
    }
    pub(crate) fn check_proton_template_capture(&self, body: Value) -> Result<Value, String> {
        validate_runtime_input(&body, &[])?;
        let input: Save = serde_json::from_value(body)
            .map_err(|_| "Consulta la captura con su identidad revisada")?;
        let id = input.id()?;
        self.proton_batch_scope(&input.source().body())?;
        let _write = CATALOG_WRITE
            .lock()
            .map_err(|_| "No se puede comprobar el catálogo de plantillas")?;
        let (state, template) = match self.proton_capture_record(&id)? {
            None => ("not-recorded", Value::Null),
            Some((record, raw, retired)) => {
                if record.capture_digest.as_deref() != Some(input.digest.as_str())
                    || record.name != input.name.trim()
                    || record.description != input.description.trim()
                {
                    return Err(
                        "La captura registrada no coincide con la operación revisada".into(),
                    );
                }
                (
                    if retired { "retired" } else { "saved" },
                    view(&record, &sha256_hex(&raw), true),
                )
            }
        };
        Ok(
            json!({"schemaVersion":1,"operationId":input.operation_id,"digest":input.digest,"state":state,"template":template,"checkedAt":neubiki_core::now_iso()}),
        )
    }
    pub(super) fn proton_capture_record(&self, id: &str) -> Result<Option<(Record, Vec<u8>, bool)>, String> {
        let path = record_path(self, id)?;
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                let (record, raw) = read(&path)?;
                return Ok(Some((record, raw, false)));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("No se puede comprobar la captura conservada".into()),
        }
        let archive = folder(self, true)?;
        if !archive.exists() {
            return Ok(None);
        }
        let prefix = format!("{}-", sha256_hex(id.as_bytes()));
        let mut found = None;
        for (index, entry) in fs::read_dir(archive)
            .map_err(|_| "No se puede comprobar el catálogo retirado")?
            .take(4097)
            .enumerate()
        {
            if index == 4096 {
                return Err("El catálogo retirado supera el límite de comprobación; se conservan las capturas sin repetirlas".into());
            }
            let entry = entry.map_err(|_| "Captura retirada no disponible")?;
            if !entry.file_name().to_string_lossy().starts_with(&prefix) {
                continue;
            }
            let raw = read_bytes(&entry.path())?;
            let record: Record =
                serde_json::from_slice(&raw).map_err(|_| "Captura retirada no compatible")?;
            validate(&record)?;
            if record.id != id || found.is_some() {
                return Err("La captura retirada requiere revisión; no se repite".into());
            }
            found = Some((record, raw, true));
        }
        Ok(found)
    }
}
fn relative(target: &str) -> Result<(String, String), String> {
    let end = target.find(['?', '#']).unwrap_or(target.len());
    let (raw, suffix) = target.split_at(end);
    if raw.is_empty() || raw.starts_with('/') || raw.len() > 4096 {
        return Err("Un recurso no tiene una ruta relativa válida en Proton".into());
    }
    let mut parts = vec![];
    for part in raw.split('/') {
        let mut decoded = Vec::new();
        let raw = part.as_bytes();
        let mut cursor = 0;
        while cursor < raw.len() {
            if raw[cursor] == b'%' {
                let pair = raw
                    .get(cursor + 1..cursor + 3)
                    .ok_or("Ruta de recurso con escape incompleto")?;
                let high = (pair[0] as char)
                    .to_digit(16)
                    .ok_or("Escape de recurso no válido")?;
                let low = (pair[1] as char)
                    .to_digit(16)
                    .ok_or("Escape de recurso no válido")?;
                decoded.push((high * 16 + low) as u8);
                cursor += 3;
            } else {
                decoded.push(raw[cursor]);
                cursor += 1;
            }
        }
        let part =
            String::from_utf8(decoded).map_err(|_| "La ruta del recurso no es UTF-8 válido")?;
        if part.is_empty()
            || part.len() > 255
            || part.contains(['/', '\\', ':'])
            || part.chars().any(char::is_control)
        {
            return Err("Una ruta de recurso contiene una parte no compatible".into());
        }
        parts.push(part);
    }
    if parts.len() > 128 {
        return Err("La ruta del recurso supera128 partes".into());
    }
    Ok((parts.join("/"), suffix.into()))
}
fn image(bytes: &[u8]) -> Result<(&'static str, u32, u32), String> {
    if bytes.len() > 512 * 1024 {
        return Err("Cada imagen de plantilla admite hasta512KiB".into());
    }
    let format =
        image::guess_format(bytes).map_err(|_| "Una imagen no tiene formato reconocible")?;
    let mime = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err("La plantilla admite imágenes PNG, JPEG y WebP".into()),
    };
    let (width, height) = image::ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| "No se pueden comprobar las dimensiones de la imagen")?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 16_000_000 {
        return Err("La imagen supera16 millones de píxeles".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| "La imagen está incompleta o fuera del límite de memoria")?;
    Ok((mime, width, height))
}
fn prepare(
    source: &Source,
    read_document: &dyn Fn() -> Result<SavedTemplateSource, String>,
    read_asset: &dyn Fn(&str) -> Result<SavedTemplateAsset, String>,
) -> Result<Prepared, String> {
    let started = Instant::now();
    let deadline = || {
        if started.elapsed() > Duration::from_secs(60) {
            Err("La captura superó su tiempo de lectura; vuelve a revisarla".to_owned())
        } else {
            Ok(())
        }
    };
    let saved = read_document()?;
    if saved.revision_id != source.revision_id || saved.markdown.len() > MAX_MARKDOWN {
        return Err("La revisión guardada cambió o supera1MiB".into());
    }
    let spans = neubiki_docs::markdown_destinations(&saved.markdown);
    if spans.len() > 128 {
        return Err("La captura admite hasta128 referencias explícitas".into());
    }
    let mut assets = BTreeMap::<String, SavedTemplateAsset>::new();
    let mut attachments = BTreeMap::<String, Attachment>::new();
    let mut images = BTreeSet::new();
    let mut resources = vec![];
    let mut replacements = vec![];
    let mut projected = saved.markdown.len();
    for span in spans {
        deadline()?;
        let target = span.target.trim();
        let lower = target.to_ascii_lowercase();
        if placeholders(target)
            .iter()
            .any(|(start, end, _)| *start == 0 && *end == target.len())
        {
            continue;
        }
        if !span.is_image
            && (target.starts_with('#')
                || lower.starts_with("https://")
                || lower.starts_with("http://")
                || lower.starts_with("mailto:"))
        {
            continue;
        }
        let (bytes, asset_path, suffix) = if lower.starts_with("data:image/") {
            let (_, bytes) = super::super::image_data_url_bytes(target)
                .ok_or("Una imagen incrustada no es raster compatible")?;
            (bytes, None, String::new())
        } else {
            let (path, suffix) = relative(target)?;
            if !assets.contains_key(&path) {
                if assets.len() >= 24 {
                    return Err(
                        "La captura admite hasta24 rutas de recursos (16 imágenes y8 adjuntos)"
                            .into(),
                    );
                }
                let asset = read_asset(&path)?;
                if assets.values().any(|old| {
                    old.node_id == asset.node_id
                        && (old.revision_id != asset.revision_id || old.bytes != asset.bytes)
                }) {
                    return Err("Un recurso cambió durante la captura".into());
                }
                assets.insert(path.clone(), asset);
            }
            (assets[&path].bytes.clone(), Some(path), suffix)
        };
        let (replacement, kind, name, sha) = if span.is_image || lower.starts_with("data:image/") {
            let (mime, width, height) = image(&bytes)?;
            let sha = sha256_hex(&bytes);
            if images.insert(sha.clone()) {
                if images.len() > 16 {
                    return Err("La captura admite hasta16 imágenes diferentes".into());
                }
                resources.push(json!({"kind":"image","name":asset_path.as_ref().map(|path|assets[path].name.as_str()),"path":asset_path,"bytes":bytes.len(),"sha256":sha,"mimeType":mime,"width":width,"height":height,"embedded":asset_path.is_none()}));
            }
            (
                format!("data:{mime};base64,{}", BASE64.encode(&bytes)),
                "image",
                String::new(),
                sha,
            )
        } else {
            let asset = &assets[asset_path.as_ref().ok_or("Adjunto sin origen")?];
            let attachment = attachments::captured(&asset.name, &bytes)?;
            let token = attachment.path.clone();
            let sha = attachment.sha256.clone();
            let name = attachment.name.clone();
            if !attachments.contains_key(&token) {
                if attachments.len() >= 8 {
                    return Err("La captura admite hasta8 adjuntos explícitos".into());
                }
                resources.push(json!({"kind":"attachment","name":name,"path":asset_path,"bytes":bytes.len(),"sha256":sha,"mimeType":attachment.mime_type,"embedded":false}));
                attachments.insert(token.clone(), attachment);
            }
            let replacement = format!("{token}{suffix}");
            attachments::matches_target(&attachments[&token], &replacement)?;
            (replacement, "attachment", name, sha)
        };
        let _ = (kind, name, sha);
        projected = projected
            .saturating_sub(span.range.len())
            .saturating_add(replacement.len());
        if projected > MAX_MARKDOWN {
            return Err("Texto e imágenes embebidas de la plantilla superan1MiB".into());
        }
        replacements.push((span.range, replacement));
    }
    let mut markdown = saved.markdown.clone();
    for (range, replacement) in replacements.into_iter().rev() {
        markdown.replace_range(range, &replacement);
    }
    let attachments = attachments.into_values().collect::<Vec<_>>();
    attachments::validate(&attachments, &markdown)?;
    portable_with_resources(&markdown, true, &attachments)?;
    variables(&markdown)?;
    let mut bindings = vec![];
    for (path, asset) in &assets {
        deadline()?;
        let current = read_asset(path)?;
        if current != *asset {
            return Err("Un recurso cambió de identidad, revisión o contenido. Vuelve a revisar la captura.".into());
        }
        bindings.push(json!({"path":path,"nodeId":asset.node_id,"revisionId":asset.revision_id,"name":asset.name,"sha256":sha256_hex(&asset.bytes)}));
    }
    deadline()?;
    let current = read_document()?;
    if current.revision_id != saved.revision_id
        || current.name != saved.name
        || current.markdown != saved.markdown
    {
        return Err("El documento guardado cambió durante la captura".into());
    }
    let identity = json!({"accountId":source.account_id,"rootId":source.root_id,"nodeId":source.node_id,"revisionId":source.revision_id,"name":saved.name});
    let digest = sha256_hex(
        &serde_json::to_vec(&json!([identity, markdown, bindings]))
            .map_err(|_| "Captura no representable")?,
    );
    Ok(Prepared {
        source: identity,
        markdown,
        attachments,
        resources,
        digest,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    fn scope() -> Source {
        Source {
            account_id: "account".into(),
            root_id: "v~root".into(),
            node_id: "v~doc".into(),
            revision_id: "v~doc~r1".into(),
        }
    }
    fn document() -> SavedTemplateSource {
        SavedTemplateSource {
            name: "Acta.md".into(),
            revision_id: "v~doc~r1".into(),
            markdown: "# Acta\n[Anexo](Anexo%20com%C3%BAn.txt#seccion)".into(),
        }
    }
    fn asset(revision: &str) -> SavedTemplateAsset {
        SavedTemplateAsset {
            node_id: "v~asset".into(),
            revision_id: revision.into(),
            name: "Anexo común.txt".into(),
            bytes: b"Texto exacto".to_vec(),
        }
    }
    #[test]
    fn captures_supported_relative_attachment_and_verifies_identity_twice() {
        let reads = Cell::new(0);
        let source_reads = Cell::new(0);
        let result = prepare(
            &scope(),
            &|| {
                source_reads.set(source_reads.get() + 1);
                Ok(document())
            },
            &|path| {
                assert_eq!(path, "Anexo común.txt");
                reads.set(reads.get() + 1);
                Ok(asset("v~asset~r1"))
            },
        )
        .unwrap();
        assert_eq!(reads.get(), 2);
        assert_eq!(source_reads.get(), 2);
        assert_eq!(result.attachments.len(), 1);
        let bytes = b"Texto exacto";
        let expected = format!(
            "neubiki-template-resource:{}/Anexo%20com%C3%BAn.txt#seccion",
            sha256_hex(bytes)
        );
        assert!(result.markdown.contains(&expected));
        assert_eq!(
            BASE64.decode(&result.attachments[0].data_base64).unwrap(),
            bytes
        );
        let changed = prepare(
            &Source {
                root_id: "v~other".into(),
                ..scope()
            },
            &|| Ok(document()),
            &|_| Ok(asset("v~asset~r1")),
        )
        .unwrap();
        assert_ne!(result.digest, changed.digest);
    }
    #[test]
    fn captures_relative_png_as_exact_embedded_bytes() {
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([243, 112, 33, 255]),
        ))
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
        let result = prepare(
            &scope(),
            &|| {
                Ok(SavedTemplateSource {
                    name: "Acta.md".into(),
                    revision_id: "v~doc~r1".into(),
                    markdown: "![Logo](assets/logo.png)".into(),
                })
            },
            &|path| {
                assert_eq!(path, "assets/logo.png");
                Ok(SavedTemplateAsset {
                    node_id: "v~png".into(),
                    revision_id: "v~png~r1".into(),
                    name: "logo.png".into(),
                    bytes: png.clone(),
                })
            },
        )
        .unwrap();
        assert!(result
            .markdown
            .contains(&format!("data:image/png;base64,{}", BASE64.encode(&png))));
        assert!(result.attachments.is_empty());
        assert_eq!(result.resources[0]["sha256"], sha256_hex(&png));
        assert_eq!(result.resources[0]["width"], 1);
    }
    #[test]
    fn rejects_resource_or_document_revision_change_and_never_downloads_external_images() {
        let reads = Cell::new(0);
        assert!(prepare(&scope(), &|| Ok(document()), &|_| {
            reads.set(reads.get() + 1);
            Ok(asset(if reads.get() == 1 {
                "v~asset~r1"
            } else {
                "v~asset~r2"
            }))
        })
        .err()
        .unwrap()
        .contains("recurso cambió"));
        let source_reads = Cell::new(0);
        assert!(prepare(
            &scope(),
            &|| {
                source_reads.set(source_reads.get() + 1);
                let mut source = document();
                if source_reads.get() == 2 {
                    source.revision_id = "v~doc~r2".into();
                }
                Ok(source)
            },
            &|_| Ok(asset("v~asset~r1"))
        )
        .err()
        .unwrap()
        .contains("documento guardado cambió"));
        let mut external = document();
        external.markdown = "![Logo](https://example.invalid/logo.png)".into();
        assert!(prepare(
            &scope(),
            &|| Ok(SavedTemplateSource {
                name: external.name.clone(),
                revision_id: external.revision_id.clone(),
                markdown: external.markdown.clone()
            }),
            &|_| panic!("Must not fetch an external image")
        )
        .is_err());
    }
    #[test]
    fn local_capture_receipt_is_idempotent_private_and_retirement_does_not_reuse_identity() {
        let directory = tempfile::tempdir().unwrap();
        let api = LocalApi::new(directory.path().join("state"), "qa".into(), "test".into());
        let workspace = api.pd_private_root().join("proton-workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("selection.json"),json!({"schemaVersion":1,"accountId":"account","root":{"nodeId":"v~root","type":"folder","name":"Proyecto"}}).to_string()).unwrap();
        let digest = "a".repeat(64);
        let id = "custom-template-capture-qa";
        let input =
            json!({"name":"Acta reusable","description":"Detalle","markdown":"# Contenido exacto"});
        let first = api
            .capture_document_template_owned(input.clone(), Some(id), Some(&digest))
            .unwrap();
        let again = api
            .capture_document_template_owned(input.clone(), Some(id), Some(&digest))
            .unwrap();
        assert_eq!(first["id"], again["id"]);
        assert_eq!(first["revision"], again["revision"]);
        let query = json!({"accountId":"account","rootId":"v~root","nodeId":"v~doc","revisionId":"v~doc~r1","operationId":"template-capture-qa","digest":digest,"name":"Acta reusable","description":"Detalle","acknowledge":true});
        assert_eq!(
            api.check_proton_template_capture(query.clone()).unwrap()["state"],
            "saved"
        );
        let portable = api
            .export_document_template_transfer(id, first["revision"].as_str().unwrap())
            .unwrap();
        assert!(!portable["content"]
            .as_str()
            .unwrap()
            .contains("captureDigest"));
        api.retire_document_template(id, json!({"revision":first["revision"]}))
            .unwrap();
        assert_eq!(
            api.check_proton_template_capture(query).unwrap()["state"],
            "retired"
        );
        assert!(api
            .capture_document_template_owned(input, Some(id), Some(&digest))
            .unwrap_err()
            .contains("retirada"));
    }
}
