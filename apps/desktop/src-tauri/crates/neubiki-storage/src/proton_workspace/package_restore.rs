//! Restore only into a new root folder. Every mutation is journalled first and checked before continuation.
use super::*;
use sha2::{Digest, Sha256};
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
            "restore-busy",
            "La restauración sigue en curso. Consulta su resultado.",
        ));
    }
    Ok(Lease(path.into()))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    path: String,
    name: String,
    kind: String,
    status: String,
    node_id: Option<String>,
    revision_id: Option<String>,
    parent_id: Option<String>,
    bytes: u64,
    sha256: Option<String>,
    detail: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    schema_version: u8,
    revision: String,
    account_id: String,
    root_id: String,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    parent_name: Option<String>,
    transfer_id: String,
    archive_sha256: String,
    name: String,
    phase: String,
    entries: Vec<Entry>,
    checked_at: String,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn location(directory: &Path) -> PathBuf {
    directory.join("proton-restore.json")
}
fn load(directory: &Path) -> Result<Option<Journal>> {
    let path = location(directory);
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_file() && !batch::linked(&meta) => (),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        _ => return Err(private_location()),
    }
    let raw =
        super::super::export_execution::bounded_read(&path, 128 * 1024).map_err(Error::local)?;
    let journal: Journal = serde_json::from_slice(&raw).map_err(|_| private_location())?;
    if journal.schema_version != 1
        || journal.entries.len() > 65
        || journal.revision.len() != 64
        || journal.archive_sha256.len() != 64
        || !valid_token(&journal.account_id)
        || !valid_token(&journal.root_id)
        || !valid_token(&journal.transfer_id)
        || !matches!(
            journal.phase.as_str(),
            "reviewed" | "running" | "interrupted" | "uncertain" | "cancelled" | "complete"
        )
        || journal.entries.iter().any(|e| {
            !matches!(e.kind.as_str(), "folder" | "file")
                || !matches!(
                    e.status.as_str(),
                    "planned" | "pending" | "confirmed" | "observed"
                )
        })
    {
        return Err(private_location());
    }
    Ok(Some(journal))
}
fn store(directory: &Path, journal: &Journal) -> Result<()> {
    let raw = serde_json::to_vec(journal).map_err(|_| private_location())?;
    if raw.len() > 128 * 1024 {
        return Err(private_location());
    }
    atomic_io::write(&location(directory), &raw).map_err(|_| private_location())
}
fn public(directory: &Path, journal: &Journal) -> Value {
    let active = ACTIVE.lock().is_ok_and(|active| active.contains(directory));
    let phase = if journal.phase == "running" && !active {
        if journal.entries.iter().any(|e| e.status == "pending") {
            "uncertain"
        } else {
            "interrupted"
        }
    } else {
        &journal.phase
    };
    json!({"schemaVersion":1,"revision":journal.revision,"accountId":journal.account_id,"rootId":journal.root_id,"parentId":journal.parent_id.as_deref().unwrap_or(&journal.root_id),"parentName":journal.parent_name,"transferId":journal.transfer_id,
        "archiveSha256":journal.archive_sha256,"name":journal.name,"phase":phase,"entries":journal.entries,"checkedAt":journal.checked_at,
        "cancelRequested":directory.join("proton-restore.cancel").exists(),"rootNodeId":journal.entries.first().and_then(|entry|entry.node_id.as_deref())})
}
fn checked<'a>(journal: &'a Journal, body: &Value) -> Result<&'a Journal> {
    if body["accountId"].as_str() != Some(&journal.account_id)
        || body["rootId"].as_str() != Some(&journal.root_id)
        || body["transferId"].as_str() != Some(&journal.transfer_id)
        || body["archiveSha256"].as_str() != Some(&journal.archive_sha256)
    {
        return Err(Error::input());
    }
    Ok(journal)
}
impl LocalApi {
    pub(crate) fn proton_restore_workspace(
        &self,
        action: &str,
        body: &Value,
        directory: &Path,
        manifest: &Value,
        read_source: &dyn Fn(&str) -> std::result::Result<Vec<u8>, String>,
    ) -> std::result::Result<Value, String> {
        self.with_proton_workspace(|workspace| {
            workspace.package_restore(action, body, directory, manifest, read_source)
        })
        .map_err(|error| error.detail)
    }
}
impl Workspace<'_> {
    fn package_restore(
        &self,
        action: &str,
        body: &Value,
        directory: &Path,
        manifest: &Value,
        read_source: &dyn Fn(&str) -> std::result::Result<Vec<u8>, String>,
    ) -> Result<Value> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        if !check_regular_directory(directory)? {
            return Err(private_location());
        }
        if action == "status" {
            return Ok(load(directory)?
                .map(|journal| checked(&journal, body).map(|journal| public(directory, journal)))
                .transpose()?
                .unwrap_or(Value::Null));
        }
        if action == "cancel" {
            let journal = load(directory)?.ok_or_else(Error::input)?;
            checked(&journal, body)?;
            let path = directory.join("proton-restore.cancel");
            if !path.exists() {
                atomic_io::create(&path, b"cancel").map_err(|_| private_location())?;
            }
            return Ok(public(directory, &journal));
        }
        let _lease = lease(directory)?;
        if action == "review" {
            if let Some(journal) = load(directory)? {
                checked(&journal, body)?;
                if journal.phase != "reviewed" {
                    return Ok(public(directory, &journal));
                }
            }
            self.require_write()?;
            let name = tree_name(body, "name")?.to_owned();
            super::super::portable_paths::component(&name).map_err(Error::local)?;
            let destination = if body["parentId"].is_null() { root } else { token(body,"parentId")? };
            let destination_name = if destination == root { self.selection()?.ok_or_else(Error::input)?.root.name } else {
                let folder:Node = self.provider(account,"drive.workspaceFolder",json!({"rootId":destination,"scopeRootId":root}))?;
                validate_node(&folder)?;if folder.kind!=NodeKind::Folder || folder.node_id!=destination {return Err(Error::invalid_response());}folder.name
            };
            let listing = self.list(&json!({"accountId":account,"rootId":root,"parentId":destination}))?;
            if listing["items"]
                .as_array()
                .ok_or_else(Error::invalid_response)?
                .iter()
                .any(|node| {
                    node["name"].as_str().is_some_and(|n| {
                        super::super::portable_paths::key(n)
                            == super::super::portable_paths::key(&name)
                    })
                })
            {
                return Err(Error::new(409,"restore-collision","Ya existe una carpeta o un archivo con ese nombre. Elige otro nombre para la copia."));
            }
            let mut entries = vec![Entry {
                path: String::new(),
                name: name.clone(),
                kind: "folder".into(),
                status: "planned".into(),
                node_id: None,
                revision_id: None,
                parent_id: None,
                bytes: 0,
                sha256: None,
                detail: None,
            }];
            for path in manifest["directories"]
                .as_array()
                .ok_or_else(Error::input)?
            {
                let path = path.as_str().ok_or_else(Error::input)?;
                entries.push(new_entry(path, "folder", 0, None)?);
            }
            entries[1..].sort_by(|a, b| {
                a.path
                    .matches('/')
                    .count()
                    .cmp(&b.path.matches('/').count())
                    .then(a.path.cmp(&b.path))
            });
            for file in manifest["files"].as_array().ok_or_else(Error::input)? {
                entries.push(new_entry(
                    file["path"].as_str().ok_or_else(Error::input)?,
                    "file",
                    file["size"].as_u64().ok_or_else(Error::input)?,
                    file["sha256"].as_str(),
                )?);
            }
            let revision = hash(
                &serde_json::to_vec(&json!([
                    account,
                    root,
                    body["transferId"],
                    body["archiveSha256"],
                    destination,
                    destination_name,
                    name,
                    entries
                ]))
                .map_err(|_| Error::input())?,
            );
            let journal = Journal {
                schema_version: 1,
                revision,
                account_id: account.into(),
                root_id: root.into(),
                parent_id: Some(destination.into()),
                parent_name: Some(destination_name),
                transfer_id: token(body, "transferId")?.into(),
                archive_sha256: token(body, "archiveSha256")?.into(),
                name,
                phase: "reviewed".into(),
                entries,
                checked_at: neubiki_core::now_iso(),
            };
            store(directory, &journal)?;
            return Ok(public(directory, &journal));
        }
        let mut journal = load(directory)?.ok_or_else(Error::input)?;
        checked(&journal, body)?;
        if body["revision"].as_str() != Some(&journal.revision) {
            return Err(Error::new(
                409,
                "restore-stale",
                "La revisión de restauración cambió. Consulta el resultado.",
            ));
        }
        if action == "check" {
            for index in 0..journal.entries.len() {
                if journal.entries[index].status != "pending" {
                    continue;
                }
                let entry = journal.entries[index].clone();
                let result = self.check_restore_entry(&journal, &entry);
                match result {
                    Ok(Some((node, revision))) => {
                        journal.entries[index].node_id = Some(node);
                        journal.entries[index].revision_id = revision;
                        journal.entries[index].status = "observed".into();
                        journal.entries[index].detail = None;
                    }
                    Ok(None) => {
                        journal.entries[index].detail = Some(
                            "La creación no puede atribuirse con seguridad. No se repite.".into(),
                        )
                    }
                    Err(error) => journal.entries[index].detail = Some(error.detail),
                }
            }
            if journal
                .entries
                .iter()
                .all(|e| matches!(e.status.as_str(), "confirmed" | "observed"))
            {
                journal.phase = "complete".into();
            } else if journal.entries.iter().any(|e| e.status == "pending") {
                journal.phase = "uncertain".into();
            } else if !matches!(journal.phase.as_str(), "cancelled" | "reviewed") {
                journal.phase = "interrupted".into();
            }
            journal.checked_at = neubiki_core::now_iso();
            store(directory, &journal)?;
            return Ok(public(directory, &journal));
        }
        if action != "apply" || body["acknowledge"] != true {
            return Err(Error::input());
        }
        self.require_write()?;
        if !matches!(journal.phase.as_str(), "reviewed" | "interrupted")
            || journal.entries.iter().any(|e| e.status == "pending")
        {
            return Err(Error::new(409,"restore-no-replay","Consulta el resultado antes de continuar. Una creación sin confirmar no se repite."));
        }
        journal.phase = "running".into();
        store(directory, &journal)?;
        for index in 0..journal.entries.len() {
            if journal.entries[index].status != "planned" {
                continue;
            }
            if directory.join("proton-restore.cancel").exists() {
                journal.phase = "cancelled".into();
                break;
            }
            self.check_selection(account, root)?;
            let entry = journal.entries[index].clone();
            let prepared = (|| -> Result<_> {
                let parent = self.restore_parent(&journal, &entry.path)?;
                let listing =
                    self.list(&json!({"accountId":account,"rootId":root,"parentId":parent}))?;
                if listing["items"]
                    .as_array()
                    .ok_or_else(Error::invalid_response)?
                    .iter()
                    .any(|node| {
                        node["name"].as_str().is_some_and(|n| {
                            super::super::portable_paths::key(n)
                                == super::super::portable_paths::key(&entry.name)
                        })
                    })
                {
                    return Err(Error::new(
                        409,
                        "restore-collision",
                        "El destino ya contiene ese nombre. No se sustituye ni se fusiona.",
                    ));
                }
                let bytes = if entry.kind == "file" {
                    let bytes = read_source(&entry.path).map_err(Error::local)?;
                    if bytes.len() as u64 != entry.bytes || Some(hash(&bytes)) != entry.sha256 {
                        return Err(Error::new(
                            409,
                            "restore-source-changed",
                            "El contenido preparado cambió. No se copia.",
                        ));
                    }
                    Some(bytes)
                } else {
                    None
                };
                Ok((parent, bytes))
            })();
            let (parent, bytes) = match prepared {
                Ok(value) => value,
                Err(error) => {
                    journal.entries[index].detail = Some(error.detail);
                    journal.phase = "interrupted".into();
                    break;
                }
            };
            if directory.join("proton-restore.cancel").exists() {
                journal.phase = "cancelled".into();
                break;
            }
            journal.entries[index].parent_id = Some(parent.clone());
            journal.entries[index].status = "pending".into();
            journal.entries[index].detail = None;
            journal.checked_at = neubiki_core::now_iso();
            store(directory, &journal)?;
            let created = if let Some(bytes) = bytes {
                self.import_file(
                    &json!({"accountId":account,"rootId":root,"parentId":parent}),
                    &[LocalApiFile {
                        field_name: "file".into(),
                        name: entry.name.clone(),
                        mime_type: None,
                        data_base64: BASE64.encode(bytes),
                    }],
                )
            } else {
                self.tree_edit(&json!({"accountId":account,"rootId":root,"parentId":parent,"action":"create-folder","name":entry.name}))
            };
            match created {
                Ok(value) => {
                    let node: Node = serde_json::from_value(value["node"].clone())
                        .map_err(|_| Error::invalid_response())?;
                    journal.entries[index].node_id = Some(node.node_id);
                    journal.entries[index].revision_id = node.revision_id;
                    store(directory, &journal)?;
                    match self.check_restore_entry(&journal, &journal.entries[index]) {
                        Ok(Some(_)) => {
                            journal.entries[index].status = "confirmed".into();
                            journal.entries[index].detail = None;
                            store(directory, &journal)?;
                        }
                        result => {
                            journal.entries[index].detail = Some(match result {
                                Err(error) => error.detail,
                                _ => "Proton no confirmó el contenido creado.".into(),
                            });
                            journal.phase = "uncertain".into();
                            break;
                        }
                    }
                }
                Err(error) => {
                    journal.entries[index].detail = Some(error.detail);
                    journal.phase = "uncertain".into();
                    break;
                }
            }
        }
        if journal
            .entries
            .iter()
            .all(|e| matches!(e.status.as_str(), "confirmed" | "observed"))
        {
            journal.phase = "complete".into();
        }
        journal.checked_at = neubiki_core::now_iso();
        store(directory, &journal)?;
        Ok(public(directory, &journal))
    }
    fn restore_parent(&self, journal: &Journal, path: &str) -> Result<String> {
        let destination=journal.parent_id.as_deref().unwrap_or(&journal.root_id);
        if destination!=journal.root_id {
            let folder:Node=self.provider(&journal.account_id,"drive.workspaceFolder",json!({"rootId":destination,"scopeRootId":journal.root_id}))?;
            validate_node(&folder)?;
            if folder.kind!=NodeKind::Folder || folder.node_id!=destination || journal.parent_name.as_deref().is_some_and(|name|name!=folder.name) {
                return Err(Error::new(409,"restore-destination-changed","La carpeta de destino cambió. No se continúa sin revisar su ubicación."));
            }
        }
        if path.is_empty() { return Ok(destination.to_owned()); }
        let mut required = vec![String::new()];
        let parent = path
            .rsplit_once('/')
            .map(|(parent, _)| parent)
            .unwrap_or("");
        let mut prefix = String::new();
        for part in parent.split('/').filter(|p| !p.is_empty()) {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            required.push(prefix.clone());
        }
        let mut parent_id = journal.parent_id.as_ref().unwrap_or(&journal.root_id).clone();
        for path in required {
            let known = journal
                .entries
                .iter()
                .find(|entry| {
                    entry.path == path
                        && entry.kind == "folder"
                        && matches!(entry.status.as_str(), "confirmed" | "observed")
                })
                .ok_or_else(Error::input)?;
            let node_id = known
                .node_id
                .as_deref()
                .ok_or_else(Error::invalid_response)?;
            let listing=self.list(&json!({"accountId":journal.account_id,"rootId":journal.root_id,"parentId":parent_id}))?;
            if !listing["items"]
                .as_array()
                .ok_or_else(Error::invalid_response)?
                .iter()
                .any(|node| {
                    node["nodeId"].as_str() == Some(node_id)
                        && node["name"].as_str() == Some(&known.name)
                        && node["type"] == "folder"
                })
            {
                return Err(Error::new(
                    409,
                    "restore-destination-changed",
                    "Una carpeta de la copia cambió de nombre o ubicación. No se continúa.",
                ));
            }
            parent_id = node_id.into();
        }
        Ok(parent_id)
    }
    fn check_restore_entry(
        &self,
        journal: &Journal,
        entry: &Entry,
    ) -> Result<Option<(String, Option<String>)>> {
        let parent = self.restore_parent(journal, &entry.path)?;
        if entry.parent_id.as_deref() != Some(&parent) {
            return Err(Error::input());
        }
        let listing = self.list(
            &json!({"accountId":journal.account_id,"rootId":journal.root_id,"parentId":parent}),
        )?;
        let matching: Vec<_> = listing["items"]
            .as_array()
            .ok_or_else(Error::invalid_response)?
            .iter()
            .filter(|node| {
                node["name"].as_str() == Some(&entry.name)
                    && entry
                        .node_id
                        .as_ref()
                        .is_none_or(|id| node["nodeId"].as_str() == Some(id))
            })
            .collect();
        if matching.len() != 1 {
            return Ok(None);
        }
        let node: Node =
            serde_json::from_value((*matching[0]).clone()).map_err(|_| Error::invalid_response())?;
        if entry.kind == "folder" {
            return if entry.node_id.is_some() && node.kind == NodeKind::Folder {
                Ok(Some((node.node_id, None)))
            } else {
                Ok(None)
            };
        }
        if node.kind != NodeKind::File {
            return Ok(None);
        }
        let revision = node
            .revision_id
            .as_deref()
            .ok_or_else(Error::invalid_response)?;
        let request = json!({"rootId":journal.root_id,"nodeId":node.node_id,"package":true,"expectedRevisionId":revision});
        let remote: RemoteRead =
            self.provider(&journal.account_id, "drive.workspaceRead", request)?;
        validate_node(&remote.node)?;
        if remote.node.node_id != node.node_id
            || remote.node.name != entry.name
            || remote.revision_id != revision
            || remote.node.revision_id.as_deref() != Some(revision)
            || remote.content_base64.len() > 4 * (8usize * 1024 * 1024).div_ceil(3)
        {
            return Ok(None);
        }
        let bytes = BASE64
            .decode(remote.content_base64)
            .map_err(|_| Error::invalid_response())?;
        if bytes.len() as u64 != entry.bytes || Some(hash(&bytes)) != entry.sha256 {
            return Ok(None);
        }
        Ok(Some((node.node_id, Some(revision.into()))))
    }
}
fn new_entry(path: &str, kind: &str, bytes: u64, sha256: Option<&str>) -> Result<Entry> {
    let name = path
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .ok_or_else(Error::input)?;
    Ok(Entry {
        path: path.into(),
        name: name.into(),
        kind: kind.into(),
        status: "planned".into(),
        node_id: None,
        revision_id: None,
        parent_id: None,
        bytes,
        sha256: sha256.map(str::to_owned),
        detail: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    fn manifest() -> Value {
        json!({"directories":[],"files":[{"path":"Acta.md","size":7,"sha256":hash(b"# Saved")}]})
    }
    fn input() -> Value {
        json!({"accountId":"account","rootId":"v~root","transferId":"transfer-qa","archiveSha256":"a".repeat(64),"name":"Copia"})
    }
    #[test]
    fn restore_observes_exact_bytes_after_lost_file_reply_and_never_replays_creates() {
        let directory = tempfile::tempdir().unwrap();
        let stage = directory.path().join("transfer");
        fs::create_dir(&stage).unwrap();
        let nodes = RefCell::new(Vec::<Value>::new());
        let mutations = Cell::new(0);
        let invoke = |_: &str, action: &str, body: Value| match action {
            "drive.workspaceFolder" => {
                Ok(json!({"nodeId":"v~root","name":"Proyecto","type":"folder"}))
            }
            "drive.workspaceList" => Ok(
                json!({"complete":true,"items":nodes.borrow().iter().filter(|node|node["parentId"]==body["parentId"]).cloned().collect::<Vec<_>>()}),
            ),
            "drive.workspaceTreeEdit" => {
                mutations.set(mutations.get() + 1);
                if body["action"] == "create-folder" {
                    let node = json!({"nodeId":"v~copy","name":"Copia","type":"folder","parentId":"v~root"});
                    nodes.borrow_mut().push(node.clone());
                    Ok(node)
                } else {
                    assert_eq!(body["parentId"], "v~copy");
                    assert_eq!(
                        BASE64
                            .decode(body["contentBase64"].as_str().unwrap())
                            .unwrap(),
                        b"# Saved"
                    );
                    nodes.borrow_mut().push(json!({"nodeId":"v~file","name":"Acta.md","type":"file","parentId":"v~copy","revisionId":"v~file~r1"}));
                    Err(ProviderError::new("network"))
                }
            }
            "drive.workspaceRead" => Ok(
                json!({"node":{"nodeId":"v~file","name":"Acta.md","type":"file","revisionId":"v~file~r1"},"revisionId":"v~file~r1","contentBase64":BASE64.encode(b"# Saved")}),
            ),
            _ => panic!("Unexpected {action}"),
        };
        let workspace = Workspace {
            directory: directory.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace
            .handle("select", json!({"accountId":"account","rootId":"v~root"}))
            .unwrap();
        let source = |_: &str| Ok(b"# Saved".to_vec());
        let mut request = input();
        let review = workspace
            .package_restore("review", &request, &stage, &manifest(), &source)
            .unwrap();
        assert_eq!(mutations.get(), 0);
        request["revision"] = review["revision"].clone();
        request["acknowledge"] = json!(true);
        let result = workspace
            .package_restore("apply", &request, &stage, &manifest(), &source)
            .unwrap();
        assert_eq!(result["phase"], "uncertain");
        assert_eq!(result["entries"][0]["status"], "confirmed");
        assert_eq!(result["entries"][1]["status"], "pending");
        assert!(workspace
            .package_restore("apply", &request, &stage, &manifest(), &source)
            .is_err());
        assert_eq!(mutations.get(), 2);
        let reopened = Workspace {
            directory: workspace.directory.clone(),
            invoke: &invoke,
            can_write: true,
        };
        assert_eq!(
            reopened
                .package_restore("status", &request, &stage, &manifest(), &source)
                .unwrap()["phase"],
            "uncertain"
        );
        let checked = reopened
            .package_restore("check", &request, &stage, &manifest(), &source)
            .unwrap();
        assert_eq!(checked["phase"], "complete");
        assert_eq!(checked["entries"][1]["status"], "observed");
        assert_eq!(mutations.get(), 2);
    }
    #[test]
    fn unknown_folder_creation_stays_uncertain_and_cancelled_review_does_not_mutate() {
        let directory = tempfile::tempdir().unwrap();
        let stage = directory.path().join("transfer");
        fs::create_dir(&stage).unwrap();
        let folder_exists = Cell::new(false);
        let mutations = Cell::new(0);
        let invoke = |_: &str, action: &str, _body: Value| match action {
            "drive.workspaceFolder" => {
                Ok(json!({"nodeId":"v~root","name":"Proyecto","type":"folder"}))
            }
            "drive.workspaceList" => Ok(
                json!({"complete":true,"items":if folder_exists.get(){json!([{"nodeId":"v~unknown","name":"Copia","type":"folder"}])}else{json!([])}}),
            ),
            "drive.workspaceTreeEdit" => {
                mutations.set(mutations.get() + 1);
                folder_exists.set(true);
                Err(ProviderError::new("network"))
            }
            _ => panic!("Unexpected {action}"),
        };
        let workspace = Workspace {
            directory: directory.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace
            .handle("select", json!({"accountId":"account","rootId":"v~root"}))
            .unwrap();
        let source = |_: &str| Ok(b"# Saved".to_vec());
        let mut request = input();
        let review = workspace
            .package_restore("review", &request, &stage, &manifest(), &source)
            .unwrap();
        request["revision"] = review["revision"].clone();
        request["acknowledge"] = json!(true);
        assert_eq!(
            workspace
                .package_restore("apply", &request, &stage, &manifest(), &source)
                .unwrap()["phase"],
            "uncertain"
        );
        assert_eq!(
            workspace
                .package_restore("check", &request, &stage, &manifest(), &source)
                .unwrap()["phase"],
            "uncertain"
        );
        assert!(workspace
            .package_restore("apply", &request, &stage, &manifest(), &source)
            .is_err());
        assert_eq!(mutations.get(), 1);
        let cancelled = directory.path().join("cancelled");
        fs::create_dir(&cancelled).unwrap();
        folder_exists.set(false);
        let review = workspace
            .package_restore("review", &input(), &cancelled, &manifest(), &source)
            .unwrap();
        let mut request = input();
        request["revision"] = review["revision"].clone();
        request["acknowledge"] = json!(true);
        workspace
            .package_restore("cancel", &request, &cancelled, &manifest(), &source)
            .unwrap();
        assert_eq!(
            workspace
                .package_restore("apply", &request, &cancelled, &manifest(), &source)
                .unwrap()["phase"],
            "cancelled"
        );
        assert_eq!(mutations.get(), 1);
    }
}
