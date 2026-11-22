use super::*;
use std::io::Read;

const MAX_COPIES: usize = 16;
const MAX_COPY_BYTES: usize = 16 * 1024 * 1024;
const MAX_JOURNAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_LISTED_FILES: usize = 10_000;
const MAX_PAGE_FILES: usize = 48;
const MAX_PAGE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecoveryOwner {
    scope: DocumentScope,
    root_name: String,
    document_name: String,
}

impl RecoveryOwner {
    pub(super) fn capture(
        scope: &DocumentScope,
        selection: &Selection,
        name: Option<&str>,
        previous: Option<&Self>,
    ) -> Self {
        Self {
            scope: scope.clone(),
            root_name: safe_label(&selection.root.name)
                .unwrap_or("Carpeta de Proton")
                .into(),
            document_name: name
                .and_then(safe_name)
                .or_else(|| previous.map(|owner| owner.document_name.as_str()))
                .unwrap_or("Documento Markdown.md")
                .into(),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ResolutionCopy {
    generation: u64,
    original: String,
    remote: String,
    remote_revision: String,
}

impl Journal {
    pub(super) fn has_valid_recovery(&self, document: &Document<'_>) -> bool {
        self.validate_payload()
            && self.owner.as_ref().is_none_or(|owner| {
                owner.scope == *document.scope
                    && safe_name(&owner.document_name).is_some()
                    && safe_label(&owner.root_name).is_some()
            })
            && (self.copies.is_empty() || self.owner.is_some())
            && self.copies.len() <= MAX_COPIES
            && self.copies.iter().all(|copy| {
                copy.generation > 0
                    && copy.generation < self.last_generation
                    && copy.remote.len()
                        <= if self.is_handwritten() {
                            MAX_NOTE_BYTES
                        } else {
                            MAX_MARKDOWN_BYTES
                        }
                    && copy.original.len()
                        <= if self.is_handwritten() {
                            MAX_NOTE_BYTES
                        } else {
                            MAX_MARKDOWN_BYTES
                        }
                    && valid_revision(&document.scope.node_id, &copy.remote_revision)
                    && (!self.is_handwritten()
                        || [&copy.original, &copy.remote].iter().all(|text| {
                            serde_json::from_str::<Value>(text)
                                .ok()
                                .is_some_and(|note| handwritten::serialize_note(&note).is_ok())
                        }))
            })
            && self
                .copies
                .windows(2)
                .all(|pair| pair[0].generation < pair[1].generation)
    }

    fn conflict_draft(&self, revision: &str) -> Result<&DraftRecord> {
        if self.attempt.is_some() {
            return Err(Error::new(
                409,
                "proton-confirmation-pending",
                "Comprueba el guardado pendiente antes de resolver el conflicto.",
            ));
        }
        self.draft
            .as_ref()
            .filter(|draft| draft.conflict || draft.base_revision_id != revision)
            .ok_or_else(|| {
                Error::new(
                    409,
                    "proton-conflict-not-current",
                    "El conflicto ya no está disponible. Vuelve a abrir el documento.",
                )
            })
    }
}

impl Workspace<'_> {
    pub(super) fn recovery_selection(&self, document: &Document<'_>) -> Result<Selection> {
        self.selection()?
            .filter(|selected| {
                selected.account_id == document.scope.account_id
                    && selected.root.node_id == document.scope.root_id
            })
            .ok_or_else(|| {
                Error::new(
                    409,
                    "proton-workspace-changed",
                    "La carpeta seleccionada cambió. Vuelve a abrir el archivo.",
                )
            })
    }

    pub(super) fn conflict_review(&self, document: &Document<'_>) -> Result<Value> {
        let (remote, remote_markdown) = self.read_conflict_source(document)?;
        let _lock = gate()?;
        self.recovery_selection(document)?;
        let journal = self.load_journal(document)?;
        let draft = journal.conflict_draft(&remote.revision_id)?;
        Ok(
            json!({"name":remote.node.name,"remoteRevisionId":remote.revision_id,
            "remoteMarkdown":remote_markdown,"draftGeneration":draft.generation,
            "draftMarkdown":journal.markdown,"handwritten":journal.is_handwritten()}),
        )
    }

    pub(super) fn conflict_resolve(&self, document: &Document<'_>, body: &Value) -> Result<Value> {
        self.require_write()?;
        let reviewed_remote = token(body, "remoteRevisionId")?;
        let reviewed_generation = generation(body, "draftGeneration")?.ok_or_else(Error::input)?;
        let markdown = body["markdown"]
            .as_str()
            .filter(|text| text.len() <= MAX_NOTE_BYTES)
            .ok_or_else(|| {
                Error::new(
                    413,
                    "proton-edit-too-large",
                    "La resolución admite hasta 4 MiB de Markdown.",
                )
            })?;
        if !valid_revision(&document.scope.node_id, reviewed_remote) {
            return Err(Error::input());
        }
        let (remote, remote_markdown) = self.read_conflict_source(document)?;
        if remote.revision_id != reviewed_remote {
            return Err(Error::new(
                409,
                "proton-conflict-review-stale",
                "La revisión de Proton cambió mientras comparabas. Actualiza la comparación.",
            ));
        }
        let _lock = gate()?;
        let selection = self.recovery_selection(document)?;
        let mut journal = self.load_journal(document)?;
        let note = journal.is_handwritten();
        if note != is_handwritten(&remote.node.name) {
            return Err(Error::invalid_response());
        }
        if note {
            let submitted = serde_json::from_str::<Value>(markdown).map_err(|_| Error::input())?;
            handwritten::serialize_note(&submitted)?;
            if let Some(plan) = body
                .get("handwrittenMerge")
                .filter(|value| !value.is_null())
            {
                let local = serde_json::from_str::<Value>(&journal.markdown)
                    .map_err(|_| private_location())?;
                let remote_note = serde_json::from_str::<Value>(&remote_markdown)
                    .map_err(|_| Error::invalid_response())?;
                let composed = note_merge::compose(&local, &remote_note, plan)?;
                if composed != submitted {
                    return Err(Error::new(409,"proton-note-merge-mismatch",
                        "Las páginas enviadas no corresponden a las elecciones revisadas. Actualiza la comparación."));
                }
            }
        } else if markdown.len() > MAX_MARKDOWN_BYTES {
            return Err(Error::input());
        } else if body
            .get("handwrittenMerge")
            .is_some_and(|value| !value.is_null())
        {
            return Err(Error::input());
        }
        if journal.conflict_draft(reviewed_remote)?.generation != reviewed_generation {
            return Err(Error::generation());
        }
        if journal.copies.len() == MAX_COPIES {
            return Err(copy_limit());
        }
        journal.copies.push(ResolutionCopy {
            generation: reviewed_generation,
            original: std::mem::take(&mut journal.markdown),
            remote: remote_markdown.clone(),
            remote_revision: reviewed_remote.into(),
        });
        if serde_json::to_vec(&journal.copies)
            .map_err(|_| copy_limit())?
            .len()
            > MAX_COPY_BYTES
        {
            return Err(copy_limit());
        }
        journal.last_generation = journal
            .last_generation
            .checked_add(1)
            .filter(|next| *next < 9_007_199_254_740_992)
            .ok_or_else(Error::generation)?;
        journal.owner = Some(RecoveryOwner::capture(
            document.scope,
            &selection,
            Some(&remote.node.name),
            journal.owner.as_ref(),
        ));
        journal.markdown = markdown.into();
        journal.draft = Some(DraftRecord {
            base_revision_id: reviewed_remote.into(),
            generation: journal.last_generation,
            conflict: false,
        });
        self.write_journal(&journal)?;
        Ok(
            json!({"node":remote.node,"revisionId":remote.revision_id,"ancestorIds":remote.ancestor_ids,
            "markdown":if note { None } else { Some(remote_markdown.as_str()) },"handwritten":if note {serde_json::from_str::<Value>(&remote_markdown).ok()}else{None},
            "contentBase64":null,"draft":journal.draft_value()}),
        )
    }

    fn read_conflict_source(&self, document: &Document<'_>) -> Result<(RemoteRead, String)> {
        let remote = self.remote_read(document, None)?;
        if !is_markdown(&remote.node.name) && !is_handwritten(&remote.node.name) {
            return Err(Error::invalid_response());
        }
        let bytes = BASE64
            .decode(&remote.content_base64)
            .map_err(|_| Error::invalid_response())?;
        if bytes.len()
            > if is_handwritten(&remote.node.name) {
                MAX_NOTE_BYTES
            } else {
                MAX_MARKDOWN_BYTES
            }
        {
            return Err(Error::new(
                413,
                "proton-edit-too-large",
                "La revisión remota supera el límite de 4 MiB.",
            ));
        }
        let markdown = String::from_utf8(bytes).map_err(|_| {
            Error::new(
                422,
                "invalid-markdown-encoding",
                "La revisión remota no está codificada en UTF-8.",
            )
        })?;
        if is_handwritten(&remote.node.name) {
            handwritten::serialize_note(
                &serde_json::from_str::<Value>(&markdown).map_err(|_| Error::invalid_response())?,
            )?;
        }
        Ok((remote, markdown))
    }

    pub(super) fn recovery_list(&self, body: &Value) -> Result<Value> {
        let cursor = match body.get("cursor") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                value
                    .as_str()
                    .filter(|name| is_journal_filename(name))
                    .ok_or_else(Error::input)?,
            ),
        };
        let result = |entries: Vec<Value>, cursor: Option<&str>, partial: bool| json!({"entries":entries,"nextCursor":cursor,"partial":partial});
        let drafts = self.drafts_dir();
        if !check_regular_directory(&self.directory)? || !check_regular_directory(&drafts)? {
            return Ok(result(Vec::new(), None, false));
        }
        let selected = self.selection();
        let mut names = BTreeSet::new();
        let mut partial = selected.is_err();
        let selected = selected.ok().flatten();
        for (index, file) in fs::read_dir(&drafts)
            .map_err(|_| private_location())?
            .enumerate()
        {
            if index >= MAX_LISTED_FILES {
                // Refuse to provide a pagination cursor over an incomplete, unordered scan.
                return Err(Error::new(
                    503,
                    "proton-recovery-list-limit",
                    "El almacén supera el límite de revisión. Se conservan todos los borradores.",
                ));
            }
            let Ok(file) = file else {
                partial = true;
                continue;
            };
            if let Ok(name) = file.file_name().into_string() {
                if is_journal_filename(&name) && cursor.is_none_or(|cursor| name.as_str() > cursor)
                {
                    names.insert(name);
                }
            }
        }
        let mut entries = Vec::new();
        let mut last = None;
        let mut read_bytes = 0;
        for (index, name) in names.iter().enumerate() {
            let path = drafts.join(name);
            let size = fs::symlink_metadata(&path)
                .ok()
                .map(|metadata| metadata.len())
                .unwrap_or(0)
                .min(MAX_JOURNAL_BYTES);
            if index >= MAX_PAGE_FILES || index > 0 && read_bytes + size > MAX_PAGE_BYTES {
                return Ok(result(entries, last, partial));
            }
            read_bytes += size;
            last = Some(name.as_str());
            let Ok(journal) = read_index_journal(&path) else {
                partial = true;
                continue;
            };
            if journal.draft.is_none() && journal.copies.is_empty() {
                continue;
            }
            let Some(owner) = recovery_owner(&journal, selected.as_ref()) else {
                partial = true;
                continue;
            };
            let document = Self::document_key(&owner.scope)?;
            if !journal.has_valid_recovery(&document) {
                partial = true;
                continue;
            }
            if let Some(draft) = &journal.draft {
                let state = if journal.attempt.is_some() {
                    "unknown"
                } else if draft.conflict {
                    "conflict"
                } else {
                    "draft"
                };
                entries.push(entry(&owner, draft.generation, "draft", state));
            }
            for copy in journal.copies.iter().rev() {
                entries.push(entry(&owner, copy.generation, "local-original", "copy"));
                entries.push(entry(&owner, copy.generation, "remote-original", "copy"));
            }
        }
        Ok(result(entries, None, partial))
    }

    pub(super) fn recovery_read(&self, body: &Value) -> Result<Value> {
        let target = RecoveryTarget::parse(body)?;
        let _lock = gate()?;
        let (journal, owner) = self.scoped_recovery(&target.scope)?;
        let text = target.markdown(&journal)?;
        Ok(
            json!({"markdown":if journal.is_handwritten() {""} else {text},"handwritten":if journal.is_handwritten() {serde_json::from_str::<Value>(text).ok()} else {None},
            "fileName":target.file_name(&owner.document_name)}),
        )
    }

    pub(super) fn recovery_export(&self, body: &Value) -> Result<(String, String)> {
        let target = RecoveryTarget::parse(body.get("recovery").ok_or_else(Error::input)?)?;
        let _lock = gate()?;
        let (journal, owner) = self.scoped_recovery(&target.scope)?;
        Ok((
            target.file_name(&owner.document_name),
            target.markdown(&journal)?.into(),
        ))
    }

    pub(super) fn recovery_remove_copy(&self, body: &Value) -> Result<Value> {
        let target = RecoveryTarget::parse(body)?;
        if target.kind != "local-original" || body["confirmed"] != true {
            return Err(Error::input());
        }
        let _lock = gate()?;
        let (mut journal, _) = self.scoped_recovery(&target.scope)?;
        target.markdown(&journal)?;
        journal
            .copies
            .retain(|copy| copy.generation != target.generation);
        self.write_journal(&journal)?;
        Ok(json!({"removed":true}))
    }

    fn scoped_recovery(&self, scope: &DocumentScope) -> Result<(Journal, RecoveryOwner)> {
        let document = Self::document_key(scope)?;
        let journal = self.load_journal(&document)?;
        let selection = if journal.owner.is_none() {
            self.selection()?
        } else {
            None
        };
        let owner = recovery_owner(&journal, selection.as_ref())
            .filter(|owner| owner.scope == *scope)
            .ok_or_else(recovery_changed)?;
        Ok((journal, owner))
    }
}

struct RecoveryTarget<'a> {
    scope: DocumentScope,
    generation: u64,
    kind: &'a str,
}

impl<'a> RecoveryTarget<'a> {
    fn parse(body: &'a Value) -> Result<Self> {
        let kind = token(body, "kind")?;
        if !matches!(kind, "draft" | "local-original" | "remote-original") {
            return Err(Error::input());
        }
        Ok(Self {
            scope: parse_input(body)?,
            generation: generation(body, "generation")?.ok_or_else(Error::input)?,
            kind,
        })
    }

    fn markdown<'b>(&self, journal: &'b Journal) -> Result<&'b str> {
        if self.kind == "draft" {
            return journal
                .draft
                .as_ref()
                .filter(|draft| draft.generation == self.generation)
                .map(|_| journal.markdown.as_str())
                .ok_or_else(recovery_changed);
        }
        journal
            .copies
            .iter()
            .find(|copy| copy.generation == self.generation)
            .map(|copy| {
                if self.kind == "local-original" {
                    copy.original.as_str()
                } else {
                    copy.remote.as_str()
                }
            })
            .ok_or_else(recovery_changed)
    }

    fn file_name(&self, document_name: &str) -> String {
        let stem = document_name
            .rsplit_once('.')
            .map(|(stem, _)| stem)
            .unwrap_or(document_name);
        let stem: String = stem.chars().take(100).collect();
        let suffix = match self.kind {
            "local-original" => "borrador-original",
            "remote-original" => "revision-remota",
            _ => "borrador",
        };
        let extension = if is_handwritten(document_name) {
            "nbnote"
        } else {
            "md"
        };
        format!("{stem}-{suffix}.{extension}")
    }
}

fn entry(owner: &RecoveryOwner, generation: u64, kind: &str, state: &str) -> Value {
    json!({"key":owner.scope,"rootName":owner.root_name,"documentName":owner.document_name,
        "generation":generation,"kind":kind,"state":state})
}

fn is_journal_filename(name: &str) -> bool {
    name.strip_prefix("v2_")
        .and_then(|name| name.strip_suffix(".json"))
        .is_some_and(|hash| {
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
}

fn read_index_journal(path: &Path) -> Result<Journal> {
    let metadata = fs::symlink_metadata(path).map_err(|_| private_location())?;
    if !metadata.is_file() || batch::linked(&metadata) || metadata.len() > MAX_JOURNAL_BYTES {
        return Err(private_location());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| private_location())?
        .take(MAX_JOURNAL_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| private_location())?;
    if bytes.len() as u64 != metadata.len() {
        return Err(private_location());
    }
    let journal: Journal = serde_json::from_slice(&bytes).map_err(|_| private_location())?;
    if journal.schema_version != 1
        || draft_store::path(
            path.parent().ok_or_else(private_location)?,
            &journal.document_id,
        ) != path
    {
        return Err(private_location());
    }
    Ok(journal)
}

fn recovery_owner(journal: &Journal, selection: Option<&Selection>) -> Option<RecoveryOwner> {
    let owner = if let Some(owner) = &journal.owner {
        owner.clone()
    } else {
        let selection = selection?;
        let (node_id, _) = journal.draft.as_ref()?.base_revision_id.rsplit_once('~')?;
        let scope = DocumentScope {
            account_id: selection.account_id.clone(),
            root_id: selection.root.node_id.clone(),
            node_id: node_id.into(),
        };
        RecoveryOwner::capture(&scope, selection, None, None)
    };
    let document = Workspace::document_key(&owner.scope).ok()?;
    (document.id == journal.document_id).then_some(owner)
}

fn safe_label(value: &str) -> Option<&str> {
    (!value.trim().is_empty() && value.len() <= 1024 && !value.chars().any(char::is_control))
        .then_some(value)
}

fn safe_name(value: &str) -> Option<&str> {
    safe_label(value).filter(|value| {
        !value.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
            && (is_markdown(value) || is_handwritten(value))
    })
}

fn recovery_changed() -> Error {
    Error::new(
        409,
        "proton-recovery-changed",
        "El borrador o la copia cambió. Actualiza Recuperación.",
    )
}

fn copy_limit() -> Error {
    Error::new(409, "proton-recovery-copy-limit", "No hay espacio para conservar ambas versiones. Exporta y retira copias anteriores desde Recuperación.")
}
