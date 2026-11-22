//! Immutable, scoped template snapshots. No catalogue overwrite or permissions management.
use super::*;
const SUFFIX: &str = ".neubiki-templates.json";
const MAX_SNAPSHOT: usize = 8 * 1024 * 1024;
const MAX_RECEIPT: u64 = 64 * 1024;
const MAX_RECEIPTS: usize = 2048;
const MAX_RECEIPT_BYTES: u64 = 32 * 1024 * 1024;
static ACTIVE: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());
struct Lease(PathBuf);
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            active.remove(&self.0);
        }
    }
}
fn lease(path: &Path) -> Result<Lease> {
    let mut active = ACTIVE.lock().map_err(|_| private_location())?;
    if !active.insert(path.into()) {
        return Err(Error::new(
            409,
            "template-snapshot-busy",
            "La operación sigue en curso. Consulta su resultado.",
        ));
    }
    Ok(Lease(path.into()))
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    id: String,
    revision: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Choice {
    index: usize,
    name: String,
}
fn hash(value: &Value) -> Result<String> {
    Ok(super::super::sha256_hex(
        &serde_json::to_vec(value).map_err(|_| Error::input())?,
    ))
}
fn digest(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn invalid(detail: String) -> Error {
    Error::new(422, "template-snapshot-invalid", &detail)
}
fn entries(body: &Value) -> Result<Vec<Entry>> {
    let entries: Vec<Entry> =
        serde_json::from_value(body["entries"].clone()).map_err(|_| Error::input())?;
    if entries.is_empty()
        || entries.len() > 32
        || entries.iter().any(|entry| {
            entry.id.len() > 160
                || !entry.id.starts_with("custom-")
                || !digest(&json!(entry.revision))
        })
        || entries
            .iter()
            .map(|entry| &entry.id)
            .collect::<BTreeSet<_>>()
            .len()
            != entries.len()
    {
        return Err(Error::input());
    }
    Ok(entries)
}
fn choices(body: &Value) -> Result<Vec<Choice>> {
    let value = if body["entries"].is_null() {
        json!([])
    } else {
        body["entries"].clone()
    };
    let entries: Vec<Choice> = serde_json::from_value(value).map_err(|_| Error::input())?;
    if entries.len() > 32
        || entries.iter().any(|entry| {
            entry.index >= 32
                || entry.name.trim().is_empty()
                || entry.name.len() > 240
                || entry.name.chars().any(char::is_control)
        })
        || entries
            .iter()
            .map(|entry| entry.index)
            .collect::<BTreeSet<_>>()
            .len()
            != entries.len()
        || entries
            .iter()
            .map(|entry| entry.name.trim().to_lowercase())
            .collect::<BTreeSet<_>>()
            .len()
            != entries.len()
    {
        return Err(Error::input());
    }
    Ok(entries)
}
fn filename(body: &Value) -> Result<&str> {
    let name = tree_name(body, "name")?;
    if name.starts_with('.')
        || name.len() > 240
        || name.len() <= SUFFIX.len()
        || !name.to_ascii_lowercase().ends_with(SUFFIX)
    {
        return Err(Error::new(
            422,
            "template-snapshot-name",
            "Escribe un nombre nuevo terminado en .neubiki-templates.json.",
        ));
    }
    super::super::portable_paths::component(name).map_err(invalid)?;
    Ok(name)
}
fn operation<'a>(body: &'a Value, purpose: &str) -> Result<&'a str> {
    let id = token(body, "operationId")?;
    let prefix = if purpose == "publish" {
        "template-publish-"
    } else {
        "template-import-"
    };
    if !id.starts_with(prefix) || id.len() > 100 || !super::super::request_scope::portable_id(id) {
        return Err(Error::input());
    }
    Ok(id)
}
fn compact_template(value: &Value) -> Value {
    if value.is_null() {
        Value::Null
    } else {
        json!({"id":value["id"],"name":value["name"],"revision":value["revision"]})
    }
}
fn compact_outcomes(value: &Value) -> Result<Vec<Value>> {
    Ok(value["outcomes"].as_array().ok_or_else(Error::invalid_response)?.iter().map(|row|
    json!({"index":row["index"],"name":row["name"],"status":row["status"],"message":row["message"],"template":compact_template(&row["template"])})).collect())
}
fn fingerprint(meta: &Value, name: &str) -> Result<String> {
    let resources = meta["resources"]
        .as_array()
        .ok_or_else(Error::invalid_response)?
        .iter()
        .map(|resource| {
            json!([
                resource["path"],
                resource["name"],
                resource["mimeType"],
                resource["sha256"],
                resource["bytes"]
            ])
        })
        .collect::<Vec<_>>();
    hash(&json!([
        name.trim().to_lowercase(),
        meta["description"],
        meta["markdown"],
        resources
    ]))
}
impl LocalApi {
    pub(crate) fn proton_shared_templates(
        &self,
        action: &str,
        body: Value,
    ) -> std::result::Result<Value, String> {
        super::super::validate_runtime_input(&body, &[])?;
        self.with_proton_workspace(|workspace| workspace.shared_templates(self, action, &body))
            .map_err(|error| error.detail)
    }
}
impl Workspace<'_> {
    fn shared_templates(&self, api: &LocalApi, action: &str, body: &Value) -> Result<Value> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        match action {
            "list" => self.shared_template_list(body),
            "publish-review" => self.shared_template_publish_review(api, body),
            "publish" => self.shared_template_publish(api, body),
            "publish-check" => self.shared_template_publish_check(api, body),
            "import-review" => self
                .shared_template_import_review(api, body)
                .map(|(view, _)| view),
            "import" => self.shared_template_import(api, body),
            "import-check" => self.shared_template_import_check(api, body),
            _ => Err(Error::input()),
        }
    }
    fn receipt_path(&self, body: &Value, purpose: &str) -> Result<PathBuf> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        let operation = operation(body, purpose)?;
        Ok(self.directory.join("shared-template-intents").join(format!(
            "{}.json",
            hash(&json!([purpose, account, root, operation]))?
        )))
    }
    fn read_template_receipt(&self, path: &Path) -> Result<Option<Value>> {
        if !check_regular_directory(&self.directory.join("shared-template-intents"))? {
            return Ok(None);
        }
        match fs::symlink_metadata(path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Ok(meta) if meta.is_file() && !batch::linked(&meta) && meta.len() <= MAX_RECEIPT => (),
            _ => return Err(private_location()),
        }
        let bytes = super::super::export_execution::bounded_read(path, MAX_RECEIPT)
            .map_err(Error::local)?;
        let receipt: Value = serde_json::from_slice(&bytes).map_err(|_| private_location())?;
        let purpose = receipt["purpose"]
            .as_str()
            .filter(|purpose| matches!(*purpose, "publish" | "import"))
            .ok_or_else(private_location)?;
        if receipt["schemaVersion"] != 1
            || !digest(&receipt["intentDigest"])
            || !digest(&receipt["digest"])
            || self.receipt_path(&receipt, purpose)? != path
            || receipt["state"].as_str().is_none_or(|state| {
                !matches!(
                    state,
                    "pending" | "confirmed" | "observed" | "conflict" | "complete" | "partial"
                )
            })
        {
            return Err(private_location());
        }
        if purpose == "publish" {
            filename(&receipt)?;
        } else if receipt["plan"].as_array().is_none_or(|plan| {
            plan.is_empty()
                || plan.len() > 32
                || plan.iter().any(|entry| {
                    !digest(&entry["fingerprint"])
                        || entry["name"]
                            .as_str()
                            .is_none_or(|name| name.is_empty() || name.len() > 240)
                })
        }) {
            return Err(private_location());
        }
        Ok(Some(receipt))
    }
    fn store_template_receipt(&self, path: &Path, receipt: &Value, new: bool) -> Result<()> {
        let bytes = serde_json::to_vec(receipt).map_err(|_| private_location())?;
        if bytes.len() as u64 > MAX_RECEIPT {
            return Err(private_location());
        }
        let directory = self.directory.join("shared-template-intents");
        ensure_directory(&self.directory)?;
        ensure_directory(&directory)?;
        if new {
            let mut count = 0;
            let mut retained = 0u64;
            for entry in fs::read_dir(&directory)
                .map_err(|_| private_location())?
                .take(MAX_RECEIPTS + 1)
            {
                let entry = entry.map_err(|_| private_location())?;
                let meta = fs::symlink_metadata(entry.path()).map_err(|_| private_location())?;
                if !meta.is_file() || batch::linked(&meta) || meta.len() > MAX_RECEIPT {
                    return Err(private_location());
                }
                count += 1;
                retained = retained.saturating_add(meta.len());
            }
            if count >= MAX_RECEIPTS || retained.saturating_add(MAX_RECEIPT) > MAX_RECEIPT_BYTES {
                return Err(Error::new(413,"template-snapshot-receipt-limit","Los recibos de plantillas alcanzan su límite. Se conservan sin iniciar otra operación."));
            }
            atomic_io::create(path, &bytes).map_err(|_| private_location())?;
        } else {
            atomic_io::write(path, &bytes).map_err(|_| private_location())?;
        }
        Ok(())
    }
    fn receipt_public(&self, receipt: &Value) -> Result<Value> {
        let path = self.receipt_path(
            receipt,
            receipt["purpose"].as_str().ok_or_else(private_location)?,
        )?;
        let active = ACTIVE
            .lock()
            .map_err(|_| private_location())?
            .contains(&path);
        Ok(
            json!({"schemaVersion":1,"accountId":receipt["accountId"],"rootId":receipt["rootId"],"purpose":receipt["purpose"],"operationId":receipt["operationId"],"digest":receipt["digest"],
            "name":receipt["name"],"source":receipt["source"],"state":receipt["state"],"node":receipt["node"],"outcomes":receipt["outcomes"],"detail":receipt["detail"],"active":active,"checkedAt":receipt["checkedAt"]}),
        )
    }
    fn missing_receipt(&self, body: &Value, purpose: &str) -> Result<Value> {
        let path = self.receipt_path(body, purpose)?;
        let active = ACTIVE
            .lock()
            .map_err(|_| private_location())?
            .contains(&path);
        Ok(
            json!({"schemaVersion":1,"accountId":body["accountId"],"rootId":body["rootId"],"purpose":purpose,"operationId":body["operationId"],"state":if active{"pending"}else{"not-recorded"},"active":active,"checkedAt":neubiki_core::now_iso()}),
        )
    }
    fn shared_template_list(&self, body: &Value) -> Result<Value> {
        let mut attempts = vec![];
        let directory = self.directory.join("shared-template-intents");
        if check_regular_directory(&directory)? {
            for entry in fs::read_dir(&directory)
                .map_err(|_| private_location())?
                .take(MAX_RECEIPTS + 1)
            {
                let entry = entry.map_err(|_| private_location())?;
                if attempts.len() >= MAX_RECEIPTS {
                    return Err(private_location());
                }
                if let Some(receipt) = self.read_template_receipt(&entry.path())? {
                    if receipt["accountId"] == body["accountId"]
                        && receipt["rootId"] == body["rootId"]
                    {
                        attempts.push(self.receipt_public(&receipt)?);
                    }
                }
            }
        }
        attempts.sort_by(|a, b| b["checkedAt"].as_str().cmp(&a["checkedAt"].as_str()));
        let total = attempts.len();
        let offset = body["offset"]
            .as_u64()
            .unwrap_or(0)
            .min(MAX_RECEIPTS as u64) as usize;
        let attempts = attempts
            .into_iter()
            .skip(offset)
            .take(20)
            .collect::<Vec<_>>();
        let mut items = vec![];
        let mut partial = false;
        if body["readRemote"] == true {
            let listing=self.list(&json!({"accountId":body["accountId"],"rootId":body["rootId"],"parentId":body["rootId"]}))?;
            for item in listing["items"]
                .as_array()
                .ok_or_else(Error::invalid_response)?
            {
                if item["type"] == "file"
                    && item["name"]
                        .as_str()
                        .is_some_and(|name| name.to_ascii_lowercase().ends_with(SUFFIX))
                {
                    if items.len() == 200 {
                        partial = true;
                        break;
                    }
                    items.push(item.clone());
                }
            }
            items.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        }
        Ok(
            json!({"schemaVersion":1,"accountId":body["accountId"],"rootId":body["rootId"],"items":items,"partial":partial,"attempts":attempts,"offset":offset,"totalAttempts":total,"checkedAt":neubiki_core::now_iso()}),
        )
    }
    fn publish_payload(&self, api: &LocalApi, body: &Value) -> Result<(String, Value, String)> {
        let entries = entries(body)?;
        for entry in &entries {
            let template = api.document_template(&entry.id).map_err(invalid)?;
            if template["builtIn"] != false {
                return Err(Error::input());
            }
        }
        let artifact = api
            .export_document_template_catalogue(json!({"entries":entries}))
            .map_err(invalid)?;
        let content = artifact["content"]
            .as_str()
            .ok_or_else(Error::invalid_response)?
            .to_owned();
        if content.len() > MAX_SNAPSHOT {
            return Err(Error::new(
                413,
                "template-snapshot-limit",
                "La instantánea compartida supera8MiB. Selecciona menos plantillas o recursos.",
            ));
        }
        let meta = api
            .inspect_document_template_transfer(&content)
            .map_err(invalid)?;
        let digest = super::super::sha256_hex(content.as_bytes());
        let name = filename(body)?;
        let review = hash(&json!([
            body["accountId"],
            body["rootId"],
            name,
            digest,
            entries
        ]))?;
        Ok((content, meta, review))
    }
    fn name_available(&self, body: &Value, name: &str) -> Result<bool> {
        let listing=self.list(&json!({"accountId":body["accountId"],"rootId":body["rootId"],"parentId":body["rootId"]}))?;
        Ok(!listing["items"]
            .as_array()
            .ok_or_else(Error::invalid_response)?
            .iter()
            .any(|node| {
                node["name"].as_str().is_some_and(|other| {
                    super::super::portable_paths::key(other)
                        == super::super::portable_paths::key(name)
                })
            }))
    }
    fn shared_template_publish_review(&self, api: &LocalApi, body: &Value) -> Result<Value> {
        self.require_write()?;
        let (content, meta, review) = self.publish_payload(api, body)?;
        let name = filename(body)?;
        if !self.name_available(body, name)? {
            return Err(Error::new(409,"template-snapshot-name-conflict","Ese nombre ya existe en Proton. Elige un nombre nuevo para conservar ambos archivos."));
        }
        Ok(
            json!({"schemaVersion":1,"accountId":body["accountId"],"rootId":body["rootId"],"name":name,"digest":super::super::sha256_hex(content.as_bytes()),"reviewDigest":review,"byteLength":content.len(),"catalog":meta["catalog"],"checkedAt":neubiki_core::now_iso()}),
        )
    }
    fn read_shared_snapshot(&self, api: &LocalApi, body: &Value) -> Result<(Node, String, Value)> {
        let root = token(body, "rootId")?;
        let node = token(body, "nodeId")?;
        let revision = token(body, "revisionId")?;
        if !valid_revision(node, revision) {
            return Err(Error::input());
        }
        let remote: RemoteRead = self.provider(
            token(body, "accountId")?,
            "drive.workspaceRead",
            json!({"rootId":root,"nodeId":node,"package":true,"expectedRevisionId":revision}),
        )?;
        validate_node(&remote.node)?;
        if remote.node.kind != NodeKind::File
            || remote.node.node_id != node
            || remote.node.revision_id.as_deref() != Some(remote.revision_id.as_str())
            || remote.revision_id != revision
            || !remote.node.name.to_ascii_lowercase().ends_with(SUFFIX)
            || !remote
                .ancestor_ids
                .as_ref()
                .is_some_and(|ids| ids.len() == 1 && ids[0] == root)
            || remote.content_base64.len() > MAX_SNAPSHOT.div_ceil(3) * 4
        {
            return Err(Error::invalid_response());
        }
        let bytes = BASE64
            .decode(remote.content_base64)
            .map_err(|_| Error::invalid_response())?;
        if bytes.len() > MAX_SNAPSHOT {
            return Err(Error::input());
        }
        let content = String::from_utf8(bytes).map_err(|_| {
            Error::new(
                422,
                "template-snapshot-encoding",
                "La instantánea debe contener JSON UTF-8 válido.",
            )
        })?;
        let raw: Value = serde_json::from_str(&content).map_err(|_| Error::input())?;
        if raw["format"] != "neubiki.document-template-catalog" {
            return Err(Error::new(
                422,
                "template-snapshot-format",
                "Este archivo no es un catálogo portable de plantillas documentales.",
            ));
        }
        let meta = api
            .inspect_document_template_transfer(&content)
            .map_err(invalid)?;
        self.check_selection(token(body, "accountId")?, root)?;
        Ok((remote.node, content, meta))
    }
    fn observe_publication(
        &self,
        api: &LocalApi,
        receipt: &mut Value,
        expected: Option<&Node>,
    ) -> Result<()> {
        let listing=self.list(&json!({"accountId":receipt["accountId"],"rootId":receipt["rootId"],"parentId":receipt["rootId"]}))?;
        let name = receipt["name"].as_str().ok_or_else(private_location)?;
        let matching = listing["items"]
            .as_array()
            .ok_or_else(Error::invalid_response)?
            .iter()
            .filter(|node| {
                node["name"].as_str().is_some_and(|other| {
                    super::super::portable_paths::key(other)
                        == super::super::portable_paths::key(name)
                })
            })
            .collect::<Vec<_>>();
        if matching.is_empty() {
            return Ok(());
        }
        if matching.len() != 1 {
            receipt["state"] = json!("conflict");
            return Ok(());
        }
        let node: Node = serde_json::from_value((*matching[0]).clone())
            .map_err(|_| Error::invalid_response())?;
        validate_node(&node)?;
        if node.kind != NodeKind::File
            || node.name != name
            || expected.is_some_and(|expected| {
                expected.node_id != node.node_id || expected.revision_id != node.revision_id
            })
        {
            receipt["state"] = json!("conflict");
            return Ok(());
        }
        let (_,content,_)=self.read_shared_snapshot(api,&json!({"accountId":receipt["accountId"],"rootId":receipt["rootId"],"nodeId":node.node_id,"revisionId":node.revision_id}))?;
        if super::super::sha256_hex(content.as_bytes()) == receipt["digest"].as_str().unwrap_or("")
        {
            receipt["node"] = json!(node);
            receipt["state"] = json!(if expected.is_some() {
                "confirmed"
            } else {
                "observed"
            });
        } else {
            receipt["state"] = json!("conflict");
        }
        Ok(())
    }
    fn shared_template_publish(&self, api: &LocalApi, body: &Value) -> Result<Value> {
        self.require_write()?;
        let path = self.receipt_path(body, "publish")?;
        let _lease = lease(&path)?;
        let intent = hash(&json!([
            body["accountId"],
            body["rootId"],
            body["name"],
            body["digest"],
            body["reviewDigest"],
            body["entries"]
        ]))?;
        if let Some(receipt) = self.read_template_receipt(&path)? {
            if receipt["intentDigest"] != intent {
                return Err(Error::input());
            }
            drop(_lease);
            return self.receipt_public(&receipt);
        }
        if body["acknowledge"] != true {
            return Err(Error::input());
        }
        let (content, _, review) = self.publish_payload(api, body)?;
        if body["reviewDigest"] != review
            || body["digest"] != super::super::sha256_hex(content.as_bytes())
        {
            return Err(Error::new(
                409,
                "template-snapshot-stale",
                "La selección de plantillas cambió. Vuelve a revisar la publicación.",
            ));
        }
        let name = filename(body)?;
        let available = self.name_available(body, name)?;
        let mut receipt = json!({"schemaVersion":1,"purpose":"publish","accountId":body["accountId"],"rootId":body["rootId"],"operationId":body["operationId"],"intentDigest":intent,
            "digest":body["digest"],"name":name,"state":if available{"pending"}else{"conflict"},"node":null,"outcomes":[],"detail":null,"checkedAt":neubiki_core::now_iso()});
        self.store_template_receipt(&path, &receipt, true)?;
        if available {
            let result:Result<Node>=self.provider(token(body,"accountId")?,"drive.workspaceTreeEdit",json!({"rootId":body["rootId"],"parentId":body["rootId"],"action":"import-file","name":name,
            "mediaType":"application/vnd.neubiki.document-template-catalog+json","contentBase64":BASE64.encode(content)}));
            let observed = match result {
                Ok(node)
                    if validate_node(&node).is_ok()
                        && node.kind == NodeKind::File
                        && node.name == name
                        && node.node_id != body["rootId"].as_str().unwrap_or("")
                        && node.revision_id.is_some() =>
                {
                    self.observe_publication(api, &mut receipt, Some(&node))
                }
                Err(error) if error.code == "name-conflict" => {
                    receipt["state"] = json!("conflict");
                    Ok(())
                }
                Err(error) => Err(error),
                _ => Err(Error::invalid_response()),
            };
            if let Err(error) = observed {
                receipt["detail"] = json!(error
                    .detail
                    .chars()
                    .filter(|character| !character.is_control())
                    .take(512)
                    .collect::<String>());
            }
        }
        receipt["checkedAt"] = json!(neubiki_core::now_iso());
        self.store_template_receipt(&path, &receipt, false)?;
        drop(_lease);
        self.receipt_public(&receipt)
    }
    fn shared_template_publish_check(&self, api: &LocalApi, body: &Value) -> Result<Value> {
        let path = self.receipt_path(body, "publish")?;
        let Some(mut receipt) = self.read_template_receipt(&path)? else {
            return self.missing_receipt(body, "publish");
        };
        if ACTIVE
            .lock()
            .map_err(|_| private_location())?
            .contains(&path)
        {
            return self.receipt_public(&receipt);
        }
        let _lease = lease(&path)?;
        if receipt["state"] == "pending" {
            match self.observe_publication(api, &mut receipt, None) {
                Ok(()) => receipt["detail"] = Value::Null,
                Err(error) => {
                    receipt["detail"] = json!(error
                        .detail
                        .chars()
                        .filter(|character| !character.is_control())
                        .take(512)
                        .collect::<String>())
                }
            }
            receipt["checkedAt"] = json!(neubiki_core::now_iso());
            self.store_template_receipt(&path, &receipt, false)?;
        }
        drop(_lease);
        self.receipt_public(&receipt)
    }
    fn shared_template_import_review(
        &self,
        api: &LocalApi,
        body: &Value,
    ) -> Result<(Value, String)> {
        let (node, content, meta) = self.read_shared_snapshot(api, body)?;
        let digest = super::super::sha256_hex(content.as_bytes());
        if !body["digest"].is_null() && body["digest"] != digest {
            return Err(Error::new(
                409,
                "template-snapshot-stale",
                "La instantánea cambió. Vuelve a leer su catálogo.",
            ));
        }
        let choices = choices(body)?;
        let outcomes = if choices.is_empty() {
            vec![]
        } else {
            compact_outcomes(
                &api.review_document_template_catalogue(
                    json!({"content":content,"digest":digest,"entries":choices}),
                    false,
                )
                .map_err(invalid)?,
            )?
        };
        let review = hash(&json!([
            body["accountId"],
            body["rootId"],
            node.node_id,
            node.revision_id,
            node.name,
            digest,
            choices,
            outcomes
        ]))?;
        Ok((
            json!({"schemaVersion":1,"accountId":body["accountId"],"rootId":body["rootId"],"source":node,"digest":digest,"reviewDigest":review,"byteLength":content.len(),"catalog":meta["catalog"],"outcomes":outcomes,"checkedAt":neubiki_core::now_iso()}),
            content,
        ))
    }
    fn shared_template_import(&self, api: &LocalApi, body: &Value) -> Result<Value> {
        let path = self.receipt_path(body, "import")?;
        let _lease = lease(&path)?;
        let intent = hash(&json!([
            body["accountId"],
            body["rootId"],
            body["nodeId"],
            body["revisionId"],
            body["digest"],
            body["reviewDigest"],
            body["entries"]
        ]))?;
        if let Some(receipt) = self.read_template_receipt(&path)? {
            if receipt["intentDigest"] != intent {
                return Err(Error::input());
            }
            drop(_lease);
            return self.receipt_public(&receipt);
        }
        if body["acknowledge"] != true || body["reviewedResources"] != true {
            return Err(Error::input());
        }
        let selected = choices(body)?;
        if selected.is_empty() {
            return Err(Error::input());
        }
        let (review, content) = self.shared_template_import_review(api, body)?;
        if body["reviewDigest"] != review["reviewDigest"]
            || body["digest"] != review["digest"]
            || review["outcomes"].as_array().is_none_or(|items| {
                items
                    .iter()
                    .any(|item| item["status"] != "new" && item["status"] != "existing")
            })
        {
            return Err(Error::new(
                409,
                "template-snapshot-import-stale",
                "Revisa los nombres, conflictos y capacidad de la biblioteca antes de importar.",
            ));
        }
        let catalog = review["catalog"]
            .as_array()
            .ok_or_else(Error::invalid_response)?;
        let mut plan = vec![];
        for choice in &selected {
            let meta = catalog
                .iter()
                .find(|meta| meta["index"].as_u64() == Some(choice.index as u64))
                .ok_or_else(Error::input)?;
            plan.push(json!({"index":choice.index,"name":choice.name.trim(),"fingerprint":fingerprint(meta,&choice.name)?}));
        }
        let mut receipt = json!({"schemaVersion":1,"purpose":"import","accountId":body["accountId"],"rootId":body["rootId"],"operationId":body["operationId"],"intentDigest":intent,
            "digest":review["digest"],"source":review["source"],"name":review["source"]["name"],"plan":plan,"state":"pending","outcomes":[],"detail":null,"checkedAt":neubiki_core::now_iso()});
        self.store_template_receipt(&path, &receipt, true)?;
        self.check_selection(token(body, "accountId")?, token(body, "rootId")?)?;
        match api.review_document_template_catalogue(json!({"content":content,"digest":review["digest"],"entries":selected,"reviewedResources":true}),true){
            Ok(outcome)=>{let outcomes=compact_outcomes(&outcome)?;receipt["state"]=json!(if outcomes.iter().all(|outcome|outcome["status"]=="imported"||outcome["status"]=="existing"){"complete"}else{"partial"});receipt["outcomes"]=json!(outcomes);},
            Err(detail)=>receipt["detail"]=json!(detail.chars().filter(|character|!character.is_control()).take(512).collect::<String>()),
        }
        receipt["checkedAt"] = json!(neubiki_core::now_iso());
        self.store_template_receipt(&path, &receipt, false)?;
        drop(_lease);
        self.receipt_public(&receipt)
    }
    fn shared_template_import_check(&self, api: &LocalApi, body: &Value) -> Result<Value> {
        let path = self.receipt_path(body, "import")?;
        let Some(mut receipt) = self.read_template_receipt(&path)? else {
            return self.missing_receipt(body, "import");
        };
        if ACTIVE
            .lock()
            .map_err(|_| private_location())?
            .contains(&path)
        {
            return self.receipt_public(&receipt);
        }
        let _lease = lease(&path)?;
        if receipt["state"] == "pending" || receipt["state"] == "partial" {
            let inventory = api.document_templates();
            if inventory["complete"] != true {
                return Err(invalid("La biblioteca local no se puede comprobar por completo. Se conserva el intento sin repetirlo.".into()));
            }
            let catalog = inventory["templates"]
                .as_array()
                .ok_or_else(Error::invalid_response)?;
            let mut outcomes = vec![];
            for item in receipt["plan"].as_array().ok_or_else(private_location)? {
                let name = item["name"].as_str().ok_or_else(private_location)?;
                let matches = catalog
                    .iter()
                    .filter(|template| {
                        template["name"]
                            .as_str()
                            .is_some_and(|value| value.to_lowercase() == name.to_lowercase())
                    })
                    .collect::<Vec<_>>();
                let (status, template) = if matches.is_empty() {
                    ("not-recorded", Value::Null)
                } else if matches.len() != 1 {
                    ("conflict", Value::Null)
                } else {
                    let template = matches[0];
                    let portable = api
                        .export_document_template_transfer(
                            template["id"]
                                .as_str()
                                .ok_or_else(Error::invalid_response)?,
                            template["revision"]
                                .as_str()
                                .ok_or_else(Error::invalid_response)?,
                        )
                        .map_err(invalid)?;
                    let meta = api
                        .inspect_document_template_transfer(
                            portable["content"]
                                .as_str()
                                .ok_or_else(Error::invalid_response)?,
                        )
                        .map_err(invalid)?;
                    if fingerprint(&meta, name)? == item["fingerprint"].as_str().unwrap_or("") {
                        ("observed", compact_template(template))
                    } else {
                        ("conflict", compact_template(template))
                    }
                };
                outcomes.push(json!({"index":item["index"],"name":name,"status":status,"message":"","template":template}));
            }
            receipt["state"] = json!(if outcomes.iter().all(|row| row["status"] == "observed") {
                "complete"
            } else {
                "partial"
            });
            receipt["outcomes"] = json!(outcomes);
            receipt["checkedAt"] = json!(neubiki_core::now_iso());
            self.store_template_receipt(&path, &receipt, false)?;
        }
        drop(_lease);
        self.receipt_public(&receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    const ROOT: &str = "v~root";
    fn node(name: &str) -> Value {
        json!({"nodeId":"v~catalog","name":name,"type":"file","revisionId":"v~catalog~r1"})
    }
    fn root() -> Value {
        json!({"nodeId":ROOT,"name":"Proyecto","type":"folder"})
    }
    fn scope() -> Value {
        json!({"accountId":"account","rootId":ROOT})
    }
    fn portable() -> String {
        json!({"format":"neubiki.document-template-catalog","schemaVersion":1,"templates":[
        {"format":"neubiki.document-template","schemaVersion":1,"name":"Remota","description":"Conservada","markdown":"# Plantilla compartida"}
    ]}).to_string()
    }
    #[test]
    fn immutable_publication_reconciles_lost_reply_with_fresh_bytes_and_never_replays() {
        let directory = tempfile::tempdir().unwrap();
        let api = LocalApi::new(directory.path().join("state"), "qa".into(), "test".into());
        let local = api
            .capture_document_template(json!({"name":"Para compartir","markdown":"# Texto exacto"}))
            .unwrap();
        let remote = RefCell::new(None::<(Value, Vec<u8>)>);
        let writes = Cell::new(0);
        let reads = Cell::new(0);
        let invoke = |_: &str, action: &str, body: Value| match action {
            "drive.workspaceFolder" => Ok(root()),
            "drive.workspaceList" => Ok(
                json!({"complete":true,"items":remote.borrow().as_ref().map(|(node,_)|vec![node.clone()]).unwrap_or_default()}),
            ),
            "drive.workspaceTreeEdit" => {
                assert_eq!(body["rootId"], ROOT);
                assert_eq!(body["parentId"], ROOT);
                assert_eq!(body["action"], "import-file");
                writes.set(writes.get() + 1);
                let bytes = BASE64
                    .decode(body["contentBase64"].as_str().unwrap())
                    .unwrap();
                remote.replace(Some((node(body["name"].as_str().unwrap()), bytes)));
                Err(ProviderError::new("network"))
            }
            "drive.workspaceRead" => {
                reads.set(reads.get() + 1);
                assert_eq!(body["package"], true);
                assert_eq!(body["expectedRevisionId"], "v~catalog~r1");
                let current = remote.borrow();
                let (node, bytes) = current.as_ref().unwrap();
                Ok(
                    json!({"node":node,"revisionId":"v~catalog~r1","ancestorIds":[ROOT],"contentBase64":BASE64.encode(bytes)}),
                )
            }
            _ => panic!("Unexpected {action}"),
        };
        let workspace = Workspace {
            directory: directory.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace.handle("select", scope()).unwrap();
        let mut body = scope();
        body["name"] = json!("Publicación.neubiki-templates.json");
        body["entries"] = json!([{"id":local["id"],"revision":local["revision"]}]);
        let review = workspace
            .shared_templates(&api, "publish-review", &body)
            .unwrap();
        assert_eq!(writes.get(), 0);
        body["digest"] = review["digest"].clone();
        body["reviewDigest"] = review["reviewDigest"].clone();
        body["operationId"] = json!("template-publish-qa");
        body["acknowledge"] = json!(true);
        let pending = workspace.shared_templates(&api, "publish", &body).unwrap();
        assert_eq!(pending["state"], "pending");
        assert_eq!(pending["active"], false);
        assert_eq!(
            workspace.shared_templates(&api, "publish", &body).unwrap()["state"],
            "pending"
        );
        assert_eq!(writes.get(), 1);
        let checked = workspace
            .shared_templates(&api, "publish-check", &body)
            .unwrap();
        assert_eq!(checked["state"], "observed");
        assert_eq!(checked["active"], false);
        assert_eq!(writes.get(), 1);
        assert_eq!(reads.get(), 1);
        let receipt =
            fs::read_to_string(workspace.receipt_path(&body, "publish").unwrap()).unwrap();
        assert!(!receipt.contains("Texto exacto"));
        assert!(!receipt.contains("dataBase64"));
        let published = String::from_utf8(remote.borrow().as_ref().unwrap().1.clone()).unwrap();
        assert!(published.contains("neubiki.document-template-catalog"));
        assert!(!published.contains("captureDigest"));
    }
    #[test]
    fn acknowledged_publish_still_requires_fresh_root_revision_and_content() {
        let directory = tempfile::tempdir().unwrap();
        let api = LocalApi::new(directory.path().join("state"), "qa".into(), "test".into());
        let local = api
            .capture_document_template(json!({"name":"Alcance","markdown":"# Texto"}))
            .unwrap();
        let remote = RefCell::new(None::<(Value, Vec<u8>)>);
        let moved = Cell::new(true);
        let writes = Cell::new(0);
        let invoke = |_: &str, action: &str, body: Value| match action {
            "drive.workspaceFolder" => Ok(root()),
            "drive.workspaceList" => Ok(
                json!({"complete":true,"items":remote.borrow().as_ref().map(|(node,_)|vec![node.clone()]).unwrap_or_default()}),
            ),
            "drive.workspaceTreeEdit" => {
                writes.set(writes.get() + 1);
                let node = node(body["name"].as_str().unwrap());
                let bytes = BASE64
                    .decode(body["contentBase64"].as_str().unwrap())
                    .unwrap();
                remote.replace(Some((node.clone(), bytes)));
                Ok(node)
            }
            "drive.workspaceRead" => {
                let current = remote.borrow();
                let (node, bytes) = current.as_ref().unwrap();
                Ok(
                    json!({"node":node,"revisionId":"v~catalog~r1","ancestorIds":if moved.get(){vec![ROOT,"v~other"]}else{vec![ROOT]},"contentBase64":BASE64.encode(bytes)}),
                )
            }
            _ => panic!("Unexpected {action}"),
        };
        let workspace = Workspace {
            directory: directory.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace.handle("select", scope()).unwrap();
        let mut body = scope();
        body["name"] = json!("Alcance.neubiki-templates.json");
        body["entries"] = json!([{"id":local["id"],"revision":local["revision"]}]);
        let review = workspace
            .shared_templates(&api, "publish-review", &body)
            .unwrap();
        body["digest"] = review["digest"].clone();
        body["reviewDigest"] = review["reviewDigest"].clone();
        body["operationId"] = json!("template-publish-scope");
        body["acknowledge"] = json!(true);
        assert_eq!(
            workspace.shared_templates(&api, "publish", &body).unwrap()["state"],
            "pending"
        );
        assert_eq!(
            workspace
                .shared_templates(&api, "publish-check", &body)
                .unwrap()["state"],
            "pending"
        );
        moved.set(false);
        assert_eq!(
            workspace
                .shared_templates(&api, "publish-check", &body)
                .unwrap()["state"],
            "observed"
        );
        assert_eq!(writes.get(), 1);
    }
    #[test]
    fn per_template_import_requires_review_and_persists_local_results_without_cloud_writes() {
        let directory = tempfile::tempdir().unwrap();
        let api = LocalApi::new(directory.path().join("state"), "qa".into(), "test".into());
        let content = portable();
        let offline = Cell::new(false);
        let reads = Cell::new(0);
        let invoke = |_: &str, action: &str, body: Value| match action {
            "drive.workspaceFolder" => Ok(root()),
            "drive.workspaceRead" => {
                assert!(
                    !offline.get(),
                    "Completed local receipt must not download again"
                );
                reads.set(reads.get() + 1);
                assert_eq!(body["expectedRevisionId"], "v~catalog~r1");
                Ok(
                    json!({"node":node("Biblioteca.neubiki-templates.json"),"revisionId":"v~catalog~r1","ancestorIds":[ROOT],"contentBase64":BASE64.encode(&content)}),
                )
            }
            _ => panic!("Import must not mutate Proton: {action}"),
        };
        let workspace = Workspace {
            directory: directory.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        workspace.handle("select", scope()).unwrap();
        let mut body = scope();
        body["nodeId"] = json!("v~catalog");
        body["revisionId"] = json!("v~catalog~r1");
        body["entries"] = json!([{"index":0,"name":"Mi copia"}]);
        let review = workspace
            .shared_templates(&api, "import-review", &body)
            .unwrap();
        assert_eq!(review["outcomes"][0]["status"], "new");
        assert!(!api.document_templates()["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["name"] == "Mi copia"));
        body["digest"] = review["digest"].clone();
        body["reviewDigest"] = review["reviewDigest"].clone();
        body["operationId"] = json!("template-import-qa");
        body["acknowledge"] = json!(true);
        body["reviewedResources"] = json!(true);
        let imported = workspace.shared_templates(&api, "import", &body).unwrap();
        assert_eq!(imported["state"], "complete");
        assert_eq!(imported["outcomes"][0]["status"], "imported");
        offline.set(true);
        assert_eq!(
            workspace.shared_templates(&api, "import", &body).unwrap()["state"],
            "complete"
        );
        assert_eq!(
            workspace
                .shared_templates(&api, "import-check", &body)
                .unwrap()["state"],
            "complete"
        );
        assert_eq!(reads.get(), 2);
        let inventory = api.document_templates();
        let rows = inventory["templates"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["name"] == "Mi copia")
            .collect::<Vec<_>>();
        assert_eq!(rows.len(), 1);
    }
    #[test]
    fn pending_import_can_be_observed_offline_without_replay_or_payload_receipts() {
        let directory = tempfile::tempdir().unwrap();
        let api = LocalApi::new(directory.path().join("state"), "qa".into(), "test".into());
        let invoke = |_: &str, action: &str, _: Value| match action {
            "drive.workspaceFolder" => Ok(root()),
            _ => panic!("Reconciliation is local: {action}"),
        };
        let workspace = Workspace {
            directory: directory.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        workspace.handle("select", scope()).unwrap();
        api.capture_document_template(json!({"name":"Mi copia","description":"Conservada","markdown":"# Plantilla compartida"})).unwrap();
        let meta = api.inspect_document_template_transfer(&portable()).unwrap();
        let mut body = scope();
        body["operationId"] = json!("template-import-observe");
        let receipt = json!({"schemaVersion":1,"purpose":"import","accountId":"account","rootId":ROOT,"operationId":body["operationId"],"intentDigest":"a".repeat(64),"digest":"b".repeat(64),"name":"Biblioteca.neubiki-templates.json",
            "state":"pending","plan":[{"index":0,"name":"Mi copia","fingerprint":fingerprint(&meta["catalog"][0],"Mi copia").unwrap()}],"outcomes":[],"checkedAt":neubiki_core::now_iso()});
        workspace
            .store_template_receipt(
                &workspace.receipt_path(&body, "import").unwrap(),
                &receipt,
                true,
            )
            .unwrap();
        let checked = workspace
            .shared_templates(&api, "import-check", &body)
            .unwrap();
        assert_eq!(checked["state"], "complete");
        assert_eq!(checked["outcomes"][0]["status"], "observed");
        assert_eq!(checked["active"], false);
        assert_eq!(
            api.document_templates()["templates"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|item| item["name"] == "Mi copia")
                .count(),
            1
        );
    }
}
