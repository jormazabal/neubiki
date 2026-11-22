use super::*;
use std::io::Read;

const MAX_ITEMS: usize = 16;
const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;
const MAX_REVIEW_BYTES: usize = 16 * 1024 * 1024;
const REVIEW_NANOS: i128 = 24 * 60 * 60 * 1_000_000_000;
static REPLACEMENT_GATE: Mutex<()> = Mutex::new(());

impl LocalApi {
    pub fn expire_proton_replacement_reviews(&self) -> std::result::Result<(), String> {
        self.with_proton_workspace(|workspace| {
            let _guard = REPLACEMENT_GATE.lock().map_err(|_| private_location())?;
            let folder = workspace.directory.join("replacement-reviews");
            if check_regular_directory(&workspace.directory)? && check_regular_directory(&folder)? {
                workspace.expire_replacements(&folder)?;
            }
            Ok(())
        })
        .map_err(|error: Error| error.detail)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Review {
    schema_version: u8,
    operation_id: String,
    account_id: String,
    root_id: String,
    created_at: String,
    applied: bool,
    #[serde(default)]
    ai_edit: bool,
    items: Vec<ReviewItem>,
}

pub(super) struct BatchEditBase {
    pub(super) node_id: String,
    pub(super) name: String,
    pub(super) revision_id: String,
    pub(super) markdown: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewItem {
    node_id: String,
    name: String,
    revision_id: String,
    draft_generation: Option<u64>,
    before: String,
    after: String,
    occurrences: usize,
    state: String,
}

fn review_id(value: &str) -> bool {
    value.starts_with("replace-")
        && value.len() < 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || b"replace-".contains(&byte))
}

fn review_expired(id: &str) -> bool {
    let created = id
        .strip_prefix("replace-")
        .and_then(|value| value.split_once('-'))
        .and_then(|(timestamp, _)| i128::from_str_radix(timestamp, 16).ok());
    created.is_some_and(|created| {
        time::OffsetDateTime::now_utc()
            .unix_timestamp_nanos()
            .saturating_sub(created)
            >= REVIEW_NANOS
    })
}

impl Workspace<'_> {
    pub(super) fn batch_edit_base(
        &self,
        account: &str,
        root: &str,
        node_id: &str,
        revision_id: &str,
    ) -> Result<BatchEditBase> {
        let scope = DocumentScope {
            account_id: account.into(),
            root_id: root.into(),
            node_id: node_id.into(),
        };
        let document = self.document(&scope)?;
        let remote = self.remote_read(&document, None)?;
        if !is_markdown(&remote.node.name) || remote.revision_id != revision_id {
            return Err(Error::generation());
        }
        let too_large = || {
            Error::new(
                413,
                "proton-batch-edit-size",
                "La edición asistida admite documentos Markdown de hasta 4 KiB.",
            )
        };
        if remote.content_base64.len() > 4 * 4096usize.div_ceil(3) {
            return Err(too_large());
        }
        let bytes = BASE64
            .decode(remote.content_base64)
            .map_err(|_| Error::invalid_response())?;
        if bytes.len() > 4096 {
            return Err(too_large());
        }
        let markdown = String::from_utf8(bytes).map_err(|_| Error::invalid_response())?;
        if markdown.trim().is_empty() || markdown.contains('\0') {
            return Err(Error::input());
        }
        let _gate = gate()?;
        let journal = self.load_journal(&document)?;
        if journal.is_handwritten() || journal.attempt.is_some() || journal.draft.is_some() {
            return Err(Error::new(409, "proton-batch-edit-draft", "Guarda o resuelve el borrador antes de incluir el documento en la edición asistida."));
        }
        Ok(BatchEditBase {
            node_id: node_id.into(),
            name: remote.node.name,
            revision_id: remote.revision_id,
            markdown,
        })
    }

    pub(super) fn store_batch_edit_review(
        &self,
        account: &str,
        root: &str,
        changes: Vec<(BatchEditBase, String)>,
    ) -> Result<Value> {
        let _review = REPLACEMENT_GATE
            .try_lock()
            .map_err(|_| Error::generation())?;
        self.check_selection(account, root)?;
        let items = changes
            .into_iter()
            .map(|(base, after)| ReviewItem {
                node_id: base.node_id,
                name: base.name,
                revision_id: base.revision_id,
                draft_generation: None,
                before: base.markdown,
                after,
                occurrences: 0,
                state: "reviewed".into(),
            })
            .collect();
        let review = Review {
            schema_version: 1,
            operation_id: neubiki_core::compact_id("replace"),
            account_id: account.into(),
            root_id: root.into(),
            created_at: neubiki_core::now_iso(),
            applied: false,
            ai_edit: true,
            items,
        };
        self.store_replacement(&review, true)?;
        serde_json::to_value(review).map_err(|_| Error::invalid_response())
    }

    fn replacement_path(&self, id: &str) -> Result<PathBuf> {
        if !review_id(id) {
            return Err(Error::input());
        }
        Ok(self
            .directory
            .join("replacement-reviews")
            .join(format!("{id}.json")))
    }

    fn store_replacement(&self, review: &Review, create: bool) -> Result<()> {
        ensure_directory(&self.directory)?;
        let folder = self.directory.join("replacement-reviews");
        ensure_directory(&folder)?;
        let bytes = serde_json::to_vec(review).map_err(|_| Error::invalid_response())?;
        if bytes.len() > MAX_REVIEW_BYTES {
            return Err(Error::new(
                413,
                "proton-replacement-size",
                "La revisión supera los 16 MiB.",
            ));
        }
        let path = self.replacement_path(&review.operation_id)?;
        if create {
            self.expire_replacements(&folder)?;
            if std::fs::read_dir(&folder)
                .map_err(|_| private_location())?
                .take(65)
                .count()
                >= 64
            {
                return Err(Error::new(
                    409,
                    "proton-replacement-limit",
                    "Se alcanzó el límite de revisiones de reemplazo en este dispositivo.",
                ));
            }
            atomic_io::create(&path, &bytes).map_err(|_| private_location())
        } else {
            atomic_io::write(&path, &bytes).map_err(|_| private_location())
        }
    }

    fn expire_replacements(&self, folder: &std::path::Path) -> Result<()> {
        for entry in std::fs::read_dir(folder)
            .map_err(|_| private_location())?
            .take(256)
        {
            let entry = entry.map_err(|_| private_location())?;
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                continue;
            };
            if !review_id(id) || !review_expired(id) {
                continue;
            }
            let metadata =
                std::fs::symlink_metadata(entry.path()).map_err(|_| private_location())?;
            if metadata.is_file() && !batch::linked(&metadata) {
                std::fs::remove_file(entry.path()).map_err(|_| private_location())?;
            }
        }
        Ok(())
    }

    fn read_replacement(&self, body: &Value) -> Result<Review> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        let id = token(body, "operationId")?;
        if review_expired(id) {
            return Err(Error::new(
                410,
                "proton-replacement-expired",
                "La revisión de reemplazo ha caducado. Prepara otra selección.",
            ));
        }
        let folder = self.directory.join("replacement-reviews");
        if !check_regular_directory(&self.directory)? || !check_regular_directory(&folder)? {
            return Err(private_location());
        }
        let path = self.replacement_path(id)?;
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| private_location())?;
        if !metadata.is_file()
            || batch::linked(&metadata)
            || metadata.len() > MAX_REVIEW_BYTES as u64
        {
            return Err(private_location());
        }
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .and_then(|file| {
                file.take(MAX_REVIEW_BYTES as u64 + 1)
                    .read_to_end(&mut bytes)
            })
            .map_err(|_| private_location())?;
        if bytes.len() > MAX_REVIEW_BYTES {
            return Err(private_location());
        }
        let review: Review = serde_json::from_slice(&bytes).map_err(|_| private_location())?;
        if review.schema_version != 1
            || review.account_id != account
            || review.root_id != root
            || review.operation_id != id
            || review.items.is_empty()
            || review.items.len() > MAX_ITEMS
        {
            return Err(private_location());
        }
        Ok(review)
    }

    pub(super) fn review_replacements(&self, body: &Value) -> Result<Value> {
        self.require_write()?;
        let _review = REPLACEMENT_GATE
            .try_lock()
            .map_err(|_| Error::generation())?;
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        let query = body["query"]
            .as_str()
            .filter(|text| !text.is_empty() && text.len() <= 512 && !text.contains('\0'))
            .ok_or_else(Error::input)?;
        let replacement = body["replacement"]
            .as_str()
            .filter(|text| text.len() <= 4096 && !text.contains('\0'))
            .ok_or_else(Error::input)?;
        let selected = body["nodeIds"]
            .as_array()
            .filter(|items| !items.is_empty() && items.len() <= MAX_ITEMS)
            .ok_or_else(Error::input)?;
        let mut ids = BTreeSet::new();
        let mut items = Vec::new();
        let mut total = 0usize;
        for value in selected {
            let node_id = value
                .as_str()
                .filter(|id| valid_token(id) && ids.insert((*id).to_owned()))
                .ok_or_else(Error::input)?;
            let scope = DocumentScope {
                account_id: account.into(),
                root_id: root.into(),
                node_id: node_id.into(),
            };
            let document = self.document(&scope)?;
            let remote = self.remote_read(&document, None)?;
            if !is_markdown(&remote.node.name)
                || remote.content_base64.len() > 4 * MAX_SOURCE_BYTES.div_ceil(3)
            {
                return Err(Error::input());
            }
            let bytes = BASE64
                .decode(remote.content_base64)
                .map_err(|_| Error::invalid_response())?;
            if bytes.len() > MAX_SOURCE_BYTES {
                return Err(Error::input());
            }
            let remote_text = String::from_utf8(bytes).map_err(|_| Error::invalid_response())?;
            let _gate = gate()?;
            let journal = self.load_journal(&document)?;
            if journal.is_handwritten()
                || journal.attempt.is_some()
                || journal.draft.as_ref().is_some_and(|draft| {
                    draft.conflict || draft.base_revision_id != remote.revision_id
                })
            {
                return Err(Error::new(
                    409,
                    "proton-replacement-conflict",
                    "Resuelve los guardados pendientes y conflictos antes de revisar el reemplazo.",
                ));
            }
            let generation = journal.draft.as_ref().map(|draft| draft.generation);
            let before = if generation.is_some() {
                journal.markdown
            } else {
                remote_text
            };
            let occurrences = before.matches(query).count();
            if occurrences == 0 || occurrences > 10_000 {
                return Err(Error::new(409, "proton-replacement-no-matches", "La selección cambió o no contiene coincidencias literales. Repite la búsqueda."));
            }
            let projected = before
                .len()
                .checked_sub(
                    occurrences
                        .checked_mul(query.len())
                        .ok_or_else(Error::input)?,
                )
                .and_then(|size| size.checked_add(occurrences.checked_mul(replacement.len())?))
                .ok_or_else(Error::input)?;
            if projected > MAX_SOURCE_BYTES
                || total.saturating_add(before.len()).saturating_add(projected) > 8 * 1024 * 1024
            {
                return Err(Error::new(413, "proton-replacement-size", "Reduce la selección. La revisión admite 2 MiB por documento y 8 MiB en conjunto."));
            }
            let after = before.replace(query, replacement);
            if after == before {
                return Err(Error::new(
                    400,
                    "proton-replacement-no-change",
                    "El texto de reemplazo debe producir un cambio.",
                ));
            }
            total += before.len().saturating_add(after.len());
            if after.len() > MAX_SOURCE_BYTES || total > 8 * 1024 * 1024 {
                return Err(Error::new(413, "proton-replacement-size", "Reduce la selección. La revisión admite 2 MiB por documento y 8 MiB en conjunto."));
            }
            items.push(ReviewItem {
                node_id: node_id.into(),
                name: remote.node.name,
                revision_id: remote.revision_id,
                draft_generation: generation,
                before,
                after,
                occurrences,
                state: "reviewed".into(),
            });
        }
        self.check_selection(account, root)?;
        let review = Review {
            schema_version: 1,
            operation_id: neubiki_core::compact_id("replace"),
            account_id: account.into(),
            root_id: root.into(),
            created_at: neubiki_core::now_iso(),
            applied: false,
            ai_edit: false,
            items,
        };
        self.store_replacement(&review, true)?;
        serde_json::to_value(review).map_err(|_| Error::invalid_response())
    }

    pub(super) fn apply_replacements(&self, body: &Value, allow_ai_edit: bool) -> Result<Value> {
        self.require_write()?;
        let _review = REPLACEMENT_GATE
            .try_lock()
            .map_err(|_| Error::generation())?;
        let mut review = self.read_replacement(body)?;
        if review.applied {
            return serde_json::to_value(review).map_err(|_| Error::invalid_response());
        }
        if review.ai_edit && !allow_ai_edit {
            return Err(Error::new(
                403,
                "proton-ai-edit-disabled",
                "Activa el permiso de edición de documentos en Configuración de IA.",
            ));
        }
        // A durable marker prevents retries from repeating a partially applied batch.
        review.applied = true;
        self.store_replacement(&review, false)?;
        for index in 0..review.items.len() {
            let item = &review.items[index];
            let scope = DocumentScope {
                account_id: review.account_id.clone(),
                root_id: review.root_id.clone(),
                node_id: item.node_id.clone(),
            };
            let outcome = (|| {
                let document = self.document(&scope)?;
                let remote = self.remote_read(&document, None)?;
                if remote.revision_id != item.revision_id
                    || remote.node.name != item.name
                    || !is_markdown(&remote.node.name)
                {
                    return Err(Error::generation());
                }
                let _gate = gate()?;
                self.check_selection(&scope.account_id, &scope.root_id)?;
                let selection = self.recovery_selection(&document)?;
                let mut journal = self.load_journal(&document)?;
                if journal.is_handwritten()
                    || journal.attempt.is_some()
                    || journal.draft.as_ref().map(|draft| draft.generation) != item.draft_generation
                    || journal.draft.as_ref().is_some_and(|draft| {
                        draft.conflict || draft.base_revision_id != item.revision_id
                    })
                    || (item.draft_generation.is_some() && journal.markdown != item.before)
                {
                    return Err(Error::generation());
                }
                journal.last_generation = journal
                    .last_generation
                    .checked_add(1)
                    .filter(|v| *v < 9_007_199_254_740_992)
                    .ok_or_else(Error::generation)?;
                journal.markdown = item.after.clone();
                journal.draft = Some(DraftRecord {
                    base_revision_id: item.revision_id.clone(),
                    generation: journal.last_generation,
                    conflict: false,
                });
                journal.owner = Some(workspace_recovery::RecoveryOwner::capture(
                    &scope,
                    &selection,
                    Some(&item.name),
                    journal.owner.as_ref(),
                ));
                self.write_journal(&journal)
            })();
            review.items[index].state = match outcome {
                Ok(()) => "prepared",
                Err(error) if error.code == "proton-recovery-unavailable" => "unknown",
                Err(_) => "not-applied",
            }
            .into();
            self.store_replacement(&review, false)?;
        }
        serde_json::to_value(review).map_err(|_| Error::invalid_response())
    }

    pub(super) fn replacement_status(&self, body: &Value) -> Result<Value> {
        serde_json::to_value(self.read_replacement(body)?).map_err(|_| Error::invalid_response())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proton_batch_edit_prepares_private_review_and_checks_permission_when_applied() {
        let temp = tempfile::tempdir().unwrap();
        let root = "volume~root";
        let node = "volume~note";
        let revision = "volume~note~base";
        let invoke = |_: &str, action: &str, _: Value| match action {
            "drive.workspaceFolder" => Ok(json!({"nodeId":root,"name":"Proyecto","type":"folder"})),
            "drive.workspaceRead" => Ok(json!({
                "node":{"nodeId":node,"name":"Nota.md","type":"file","revisionId":revision},
                "revisionId":revision,"contentBase64":BASE64.encode("# Original\n"),
            })),
            other => panic!("Unexpected remote write or operation {other}"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace
            .handle("select", json!({"accountId":"acct","rootId":root}))
            .unwrap();
        let base = workspace
            .batch_edit_base("acct", root, node, revision)
            .unwrap();
        let review = workspace
            .store_batch_edit_review("acct", root, vec![(base, "# Revisado\n".into())])
            .unwrap();
        let apply = json!({"accountId":"acct","rootId":root,"operationId":review["operationId"]});
        assert_eq!(
            workspace
                .apply_replacements(&apply, false)
                .unwrap_err()
                .code,
            "proton-ai-edit-disabled"
        );
        assert_eq!(
            workspace.replacement_status(&apply).unwrap()["applied"],
            false
        );
        let result = workspace.apply_replacements(&apply, true).unwrap();
        assert_eq!(result["items"][0]["state"], "prepared");
        assert_eq!(workspace.replacement_status(&apply).unwrap(), result);
    }

    #[test]
    fn proton_replacement_creates_reviewed_private_drafts_and_never_replays_or_writes_remote() {
        let temp = tempfile::tempdir().unwrap();
        let root = "volume~root";
        let node = "volume~a";
        let revision = "volume~a~base";
        let invoke = |_: &str, action: &str, _: Value| match action {
            "drive.workspaceFolder" => Ok(json!({"nodeId":root,"name":"Proyecto","type":"folder"})),
            "drive.workspaceRead" => Ok(
                json!({"node":{"nodeId":node,"name":"A.md","type":"file","revisionId":revision},
                "revisionId":revision,"contentBase64":BASE64.encode("Primero **uno** y uno.")}),
            ),
            other => panic!("Unexpected remote write or operation {other}"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace
            .handle("select", json!({"accountId":"acct","rootId":root}))
            .unwrap();
        let review = workspace.review_replacements(&json!({"accountId":"acct","rootId":root,"query":"uno","replacement":"dos","nodeIds":[node]})).unwrap();
        assert_eq!(review["items"][0]["occurrences"], 2);
        assert_eq!(review["items"][0]["before"], "Primero **uno** y uno.");
        assert_eq!(review["items"][0]["after"], "Primero **dos** y dos.");
        let scope = DocumentScope {
            account_id: "acct".into(),
            root_id: root.into(),
            node_id: node.into(),
        };
        let document = workspace.document(&scope).unwrap();
        assert!(workspace.load_journal(&document).unwrap().draft.is_none());
        let apply = json!({"accountId":"acct","rootId":root,"operationId":review["operationId"]});
        let result = workspace.apply_replacements(&apply, false).unwrap();
        assert_eq!(result["items"][0]["state"], "prepared");
        let journal = workspace.load_journal(&document).unwrap();
        assert_eq!(journal.markdown, "Primero **dos** y dos.");
        let generation = journal.last_generation;
        assert_eq!(workspace.apply_replacements(&apply, false).unwrap(), result);
        assert_eq!(
            workspace.load_journal(&document).unwrap().last_generation,
            generation
        );

        let second = workspace.review_replacements(&json!({"accountId":"acct","rootId":root,"query":"dos","replacement":"tres","nodeIds":[node]})).unwrap();
        workspace.draft(&document, &json!({"baseRevisionId":revision,"expectedGeneration":generation,"markdown":"Edición posterior"})).unwrap();
        let blocked = workspace
            .apply_replacements(
                &json!({"accountId":"acct","rootId":root,"operationId":second["operationId"]}),
                false,
            )
            .unwrap();
        assert_eq!(blocked["items"][0]["state"], "not-applied");
        assert_eq!(
            workspace.load_journal(&document).unwrap().markdown,
            "Edición posterior"
        );
    }
}
