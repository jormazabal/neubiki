use super::*;
use std::io::Read;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Intent {
    session_id: String,
    source_revision: String,
    summary_revision: Option<String>,
    account_id: String,
    root_id: String,
    parent_id: String,
    name: String,
}

impl Intent {
    fn new(body: &Value) -> Result<Self> {
        let intent: Self = parse_input(body)?;
        if [
            &intent.session_id,
            &intent.source_revision,
            &intent.account_id,
            &intent.root_id,
            &intent.parent_id,
        ]
        .iter()
        .any(|value| !valid_token(value))
            || intent
                .summary_revision
                .as_deref()
                .is_some_and(|value| !valid_token(value))
            || !is_markdown(&intent.name)
            || tree_name(body, "name")? != intent.name
            || intent
                .name
                .contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|'])
            || intent.name.trim() != intent.name
            || intent.name.starts_with('.')
        {
            return Err(Error::input());
        }
        Ok(intent)
    }

    fn id(&self) -> Result<String> {
        let bytes = serde_json::to_vec(self).map_err(|_| Error::input())?;
        Ok(super::super::sha256_hex(&bytes))
    }

    fn content(&self, api: &LocalApi, id: &str) -> Result<(String, String, String, bool)> {
        let (markdown, partial) = api
            .recording_publication_markdown(
                &self.session_id,
                &self.source_revision,
                self.summary_revision.as_deref(),
            )
            .map_err(|detail| Error::new(409, "proton-meeting-source-changed", &detail))?;
        // A verified match is scoped to this publication rather than any same-name file.
        let content = format!("{markdown}\n\n<!-- Neubiki meeting publication {id} -->\n");
        if content.len() > MAX_MARKDOWN_BYTES {
            return Err(Error::new(
                413,
                "proton-meeting-too-large",
                "El documento de reunión supera 4 MiB. La fuente local se conserva.",
            ));
        }
        let digest = super::super::sha256_hex(content.as_bytes());
        Ok((markdown, content, digest, partial))
    }
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
enum PublicationState {
    Unknown,
    Confirmed { node: Node },
    Conflict,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicationReceipt {
    schema_version: u8,
    id: String,
    digest: String,
    #[serde(flatten)]
    state: PublicationState,
}

impl Workspace<'_> {
    pub(super) fn meeting_publication(
        &self,
        api: &LocalApi,
        action: &str,
        body: &Value,
    ) -> Result<Value> {
        let intent = Intent::new(body)?;
        let id = intent.id()?;
        self.check_selection(&intent.account_id, &intent.root_id)?;
        let folder = self.directory.join("meeting-publications");
        let path = folder.join(format!("{id}.json"));
        match action {
            "meeting-publish-review" => {
                if let Some(receipt) = read_receipt(&self.directory, &folder, &path, &id)? {
                    return result(receipt.state);
                }
                let (markdown, _, digest, partial) = intent.content(api, &id)?;
                Ok(json!({"state":"review","markdown":markdown,"digest":digest,"partial":partial}))
            }
            "meeting-publish-check" => self.meeting_publication_check(&intent, &folder, &path, &id),
            "meeting-publish" => {
                self.require_write()?;
                if let Some(receipt) = read_receipt(&self.directory, &folder, &path, &id)? {
                    return result(receipt.state);
                }
                let (_, content, digest, _) = intent.content(api, &id)?;
                if body["digest"] != digest {
                    return Err(Error::new(
                        409,
                        "proton-meeting-review-stale",
                        "El documento cambió. Vuelve a revisarlo antes de publicar.",
                    ));
                }
                let (mut receipt, reservation) = {
                    let mut lock = gate()?;
                    self.check_selection(&intent.account_id, &intent.root_id)?;
                    if let Some(receipt) = read_receipt(&self.directory, &folder, &path, &id)? {
                        return result(receipt.state);
                    }
                    ensure_directory(&self.directory)?;
                    ensure_directory(&folder)?;
                    if fs::read_dir(&folder)
                        .map_err(|_| private_location())?
                        .take(1024)
                        .count()
                        >= 1024
                    {
                        return Err(Error::new(
                            503,
                            "proton-meeting-publication-limit",
                            "El registro local de publicaciones está lleno.",
                        ));
                    }
                    let receipt = PublicationReceipt {
                        schema_version: 1,
                        id: id.clone(),
                        digest,
                        state: PublicationState::Unknown,
                    };
                    let bytes = serde_json::to_vec(&receipt).map_err(|_| private_location())?;
                    atomic_io::create(&path, &bytes).map_err(|_| private_location())?;
                    lock.insert(path.clone());
                    (receipt, InFlight(path.clone()))
                };
                let uploaded: Result<Node> = self.provider(&intent.account_id, "drive.workspaceTreeEdit", json!({
                    "action":"import-file","rootId":intent.root_id,"parentId":intent.parent_id,
                    "name":intent.name,"mediaType":"text/markdown","contentBase64":BASE64.encode(content),
                }));
                receipt.state = match uploaded {
                    Ok(node) if valid_publication_node(&node, &intent) => {
                        PublicationState::Confirmed { node }
                    }
                    Err(error) if error.code == "name-conflict" => PublicationState::Conflict,
                    _ => PublicationState::Unknown,
                };
                let written = save_receipt(&path, &receipt);
                drop(reservation);
                if written.is_err() {
                    return result(PublicationState::Unknown);
                }
                result(receipt.state)
            }
            _ => Err(Error::input()),
        }
    }

    fn meeting_publication_check(
        &self,
        intent: &Intent,
        folder: &Path,
        path: &Path,
        id: &str,
    ) -> Result<Value> {
        let (mut receipt, reservation) = {
            let mut lock = gate()?;
            let receipt = read_receipt(&self.directory, folder, path, id)?.ok_or_else(|| {
                Error::new(
                    409,
                    "proton-meeting-receipt-missing",
                    "No hay una publicación que comprobar. Vuelve a revisar el documento.",
                )
            })?;
            if !matches!(receipt.state, PublicationState::Unknown) || !lock.insert(path.into()) {
                return result(receipt.state);
            }
            (receipt, InFlight(path.into()))
        };
        let listing = self.list(&json!({"accountId":intent.account_id,"rootId":intent.root_id,"parentId":intent.parent_id}))?;
        let siblings = listing["items"]
            .as_array()
            .ok_or_else(Error::invalid_response)?;
        let mut matches = siblings.iter().filter(|node| node["name"] == intent.name);
        if let Some(item) = matches.next() {
            let node: Node =
                serde_json::from_value(item.clone()).map_err(|_| Error::invalid_response())?;
            receipt.state = if matches.next().is_some() || !valid_publication_node(&node, intent) {
                PublicationState::Conflict
            } else {
                let scope = DocumentScope {
                    account_id: intent.account_id.clone(),
                    root_id: intent.root_id.clone(),
                    node_id: node.node_id.clone(),
                };
                let document = self.document(&scope)?;
                let remote = self.remote_read(&document, None)?;
                let bytes = BASE64
                    .decode(remote.content_base64)
                    .map_err(|_| Error::invalid_response())?;
                if remote.node.revision_id == node.revision_id
                    && valid_publication_node(&remote.node, intent)
                    && super::super::sha256_hex(&bytes) == receipt.digest
                {
                    PublicationState::Confirmed { node: remote.node }
                } else {
                    // A same-name file may have been edited since publication.
                    PublicationState::Unknown
                }
            };
            self.check_selection(&intent.account_id, &intent.root_id)?;
            save_receipt(path, &receipt)?;
        }
        drop(reservation);
        result(receipt.state)
    }
}

fn valid_publication_node(node: &Node, intent: &Intent) -> bool {
    validate_node(node).is_ok()
        && node.kind == NodeKind::File
        && node.name == intent.name
        && node.node_id != intent.parent_id
        && node.node_id != intent.root_id
}

fn read_receipt(
    directory: &Path,
    folder: &Path,
    path: &Path,
    id: &str,
) -> Result<Option<PublicationReceipt>> {
    if !check_regular_directory(directory)? || !check_regular_directory(folder)? {
        return Ok(None);
    }
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(private_location()),
    };
    if !meta.is_file() || batch::linked(&meta) || meta.len() > 8192 {
        return Err(private_location());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|file| file.take(8193).read_to_end(&mut bytes))
        .map_err(|_| private_location())?;
    if bytes.len() as u64 != meta.len() {
        return Err(private_location());
    }
    let receipt: PublicationReceipt =
        serde_json::from_slice(&bytes).map_err(|_| private_location())?;
    if receipt.schema_version != 1
        || receipt.id != id
        || receipt.digest.len() != 64
        || !receipt.digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(private_location());
    }
    Ok(Some(receipt))
}

fn save_receipt(path: &Path, receipt: &PublicationReceipt) -> Result<()> {
    let bytes = serde_json::to_vec(receipt).map_err(|_| private_location())?;
    atomic_io::write(path, &bytes).map_err(|_| private_location())
}

fn result(state: PublicationState) -> Result<Value> {
    serde_json::to_value(state).map_err(|_| private_location())
}

#[cfg(test)]
mod tests {
    use super::*;
    use neubiki_recording::model::{
        Chunk, Destination, Session, Settings, Status, MEETING_USAGE_SCOPE,
    };
    use std::cell::{Cell, RefCell};

    #[test]
    fn proton_workspace_meeting_publication_observes_lost_ack_without_replay() {
        let temporary = tempfile::tempdir().unwrap();
        let api = LocalApi::new(temporary.path().into(), "0.0.0".into(), "test".into());
        let root = temporary.path().join(if cfg!(debug_assertions) {
            "recordings-dev"
        } else {
            "recordings"
        });
        let mut session = Session::new(
            Settings::default(),
            Some(Destination {
                project_id: MEETING_USAGE_SCOPE.into(),
                folder_id: None,
                name: "Meeting fixture".into(),
            }),
        );
        session.meeting = true;
        session.status = Status::Attention;
        session.samples = 48_000;
        session.chunks = vec![
            Chunk {
                usage_receipt: None,
                usage_recorded: false,
                sha256: None,
                start: 0,
                samples: 24_000,
                status: "completed".into(),
                text: Some("# Texto literal".into()),
                languages: vec!["es".into()],
            },
            Chunk {
                usage_receipt: None,
                usage_recorded: false,
                sha256: None,
                start: 24_000,
                samples: 24_000,
                status: "ready".into(),
                text: None,
                languages: vec!["es".into()],
            },
        ];
        let local = root.join(&session.id);
        fs::create_dir_all(&local).unwrap();
        neubiki_recording::atomic_json(&local.join("session.json"), &session).unwrap();
        let source = neubiki_recording::transcript_source(&root, &session.id).unwrap();
        let root_node = json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"});
        let node = json!({"nodeId":"vol~file","name":"Transcripción.md","type":"file","revisionId":"vol~file~rev"});
        let writes = Cell::new(0);
        let uploaded = RefCell::new(Value::Null);
        let invoke = |_: &str, action: &str, body: Value| match action {
            "drive.workspaceFolder" => Ok(root_node.clone()),
            "drive.workspaceTreeEdit" => {
                writes.set(writes.get() + 1);
                assert_eq!(body["action"], "import-file");
                *uploaded.borrow_mut() = body["contentBase64"].clone();
                Err(neubiki_proton::Error::new("network"))
            }
            "drive.workspaceList" => Ok(json!({"items":[node],"complete":true})),
            "drive.workspaceRead" => Ok(
                json!({"node":node,"revisionId":"vol~file~rev","contentBase64":*uploaded.borrow()}),
            ),
            _ => panic!("Unexpected action: {action}"),
        };
        let workspace = Workspace {
            directory: temporary.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        let mut body = json!({"accountId":"account","rootId":"vol~root","parentId":"vol~root",
            "name":"Transcripción.md","sessionId":session.id,"sourceRevision":source["sourceRevision"]});
        workspace.handle("select", body.clone()).unwrap();
        let review = workspace
            .meeting_publication(&api, "meeting-publish-review", &body)
            .unwrap();
        assert_eq!(review["partial"], true);
        assert!(review["markdown"]
            .as_str()
            .unwrap()
            .contains("\\# Texto literal"));
        assert_eq!(writes.get(), 0);
        assert!(workspace
            .meeting_publication(&api, "meeting-publish", &body)
            .is_err());
        body["digest"] = review["digest"].clone();
        let first = workspace
            .meeting_publication(&api, "meeting-publish", &body)
            .unwrap();
        assert_eq!(first["state"], "unknown");
        assert_eq!(
            workspace
                .meeting_publication(&api, "meeting-publish", &body)
                .unwrap(),
            first
        );
        let checked = workspace
            .meeting_publication(&api, "meeting-publish-check", &body)
            .unwrap();
        assert_eq!(checked, json!({"state":"confirmed","node":node}));
        assert_eq!(
            workspace
                .meeting_publication(&api, "meeting-publish-review", &body)
                .unwrap(),
            checked
        );
        assert_eq!(writes.get(), 1);
    }
}
