//! Proton is the workspace. The only local records are the chosen folder and
//! private recovery data for edits whose outcome may still be in doubt.

use super::{atomic_io, batch, draft_store, LocalApi, LocalApiFile, LocalApiResponse};
mod ai_sources;
pub(super) use ai_sources::{AiSource, AiSourceContent, AiSourceRef};
mod semantic_project;
pub(super) use semantic_project::MAX_PROJECT_CANDIDATES;
mod workspace_resources;
mod workspace_favorites;
mod workspace_profiles;
mod workspace_trash;
mod workspace_office;
mod batch_export;
mod template_capture;
mod shared_templates;
pub(crate) use template_capture::{SavedTemplateSource,SavedTemplateAsset};
mod package_export;
mod package_restore;
mod search;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use neubiki_proton::Error as ProviderError;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs, io,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

const MAX_MARKDOWN_BYTES: usize = 4 * 1024 * 1024;
const MAX_NOTE_BYTES: usize = 8 * 1024 * 1024;
mod handwritten;
mod note_merge;
mod note_embed;
mod note_ai;
mod replacements;
mod batch_edit;
mod workspace_recovery;
mod meeting_publication;
mod references;
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMPORTED_FILE_BYTES: usize = 8 * 1024 * 1024;
// Both architectures passed installed acceptance with regular revision uploads.
const VERIFIED_REVISION_WRITES: bool = cfg!(any(
    all(windows, target_arch = "x86_64"),
    all(target_os = "android", target_arch = "aarch64")
));
static IN_FLIGHT: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Node {
    node_id: String,
    name: String,
    #[serde(rename = "type")]
    kind: NodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    media_type: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum NodeKind {
    Folder,
    File,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Selection {
    schema_version: u8,
    account_id: String,
    root: Node,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteRead {
    node: Node,
    revision_id: String,
    content_base64: String,
    #[serde(default)]
    ancestor_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevisionAck {
    node_id: String,
    revision_id: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentScope {
    account_id: String,
    root_id: String,
    node_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Journal {
    schema_version: u8,
    document_id: String,
    last_generation: u64,
    markdown: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content_kind: Option<String>,
    draft: Option<DraftRecord>,
    attempt: Option<Attempt>,
    receipt: Option<Receipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner: Option<workspace_recovery::RecoveryOwner>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    copies: Vec<workspace_recovery::ResolutionCopy>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DraftRecord {
    base_revision_id: String,
    generation: u64,
    conflict: bool,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Attempt {
    operation_id: String,
    generation: u64,
    base_revision_id: String,
    content_sha256: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    operation_id: String,
    generation: u64,
    state: SaveState,
    revision_id: Option<String>,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SaveState {
    Saved,
    Observed,
    Unknown,
    Conflict,
}

#[derive(Debug)]
pub(super) struct Error {
    status: u16,
    code: String,
    detail: String,
    outcome_unknown: bool,
}

type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub(super) fn new(status: u16, code: &str, detail: &str) -> Self {
        Self {
            status,
            code: code.into(),
            detail: detail.into(),
            outcome_unknown: false,
        }
    }

    fn input() -> Self {
        Self::new(
            400,
            "invalid-proton-request",
            "La solicitud de espacio Proton no es válida.",
        )
    }

    fn local(detail: String) -> Self {
        Self {
            status: 503,
            code: "proton-recovery-unavailable".into(),
            detail,
            outcome_unknown: false,
        }
    }

    fn invalid_response() -> Self {
        Self::new(
            502,
            "invalid-proton-response",
            "Proton no devolvió una respuesta verificable.",
        )
    }

    fn generation() -> Self {
        Self::new(
            409,
            "draft-generation-changed",
            "El borrador cambió. Consulta la versión conservada.",
        )
    }

    pub(super) fn response(self, outcome: Option<&str>) -> LocalApiResponse {
        let mut body = json!({"code":self.code,"detail":self.detail});
        let outcome = if self.outcome_unknown { Some("unknown") } else { outcome };
        if let Some(outcome) = outcome {
            body["operationOutcome"] = json!(outcome);
        }
        LocalApiResponse { status: self.status, body }
    }

    pub(super) fn unconfirmed(mut self) -> Self {
        self.outcome_unknown = true;
        self
    }
}

impl From<ProviderError> for Error {
    fn from(error: ProviderError) -> Self {
        let status = match error.code.as_str() {
            "auth-required" | "session-revoked" | "needs-reconnect" | "account-not-found" => 401,
            "permission-denied" | "outside-workspace" => 403,
            "not-found" => 404,
            "revision-conflict" | "name-conflict" | "stale-node" => 409,
            "file-too-large" => 413,
            "invalid-asset-path" | "not-file" | "not-folder" | "not-markdown"
            | "invalid-move-target" | "invalid-node-name" | "file-extension-changed" => 422,
            _ => 503,
        };
        let detail = match error.code.as_str() {
            "name-conflict" => "Ya existe un elemento con ese nombre en la carpeta de destino.",
            "stale-node" => "El elemento cambió en Proton. Comprueba el árbol actualizado.",
            "invalid-move-target" => "Una carpeta no puede moverse dentro de sí misma ni de una subcarpeta.",
            "invalid-node-name" => "Escribe un nombre válido para el elemento.",
            "file-extension-changed" => "Conserva la extensión del archivo al renombrarlo.",
            _ => error.message(),
        };
        Self::new(status, &error.code, detail)
    }
}

impl Journal {
    fn new(id: String) -> Self {
        Self {
            schema_version: 1,
            document_id: id,
            last_generation: 0,
            markdown: String::new(),
            content_kind: None,
            draft: None,
            attempt: None,
            receipt: None,
            owner: None,
            copies: Vec::new(),
        }
    }

    fn draft_value(&self) -> Value {
        let Some(draft) = &self.draft else {
            return Value::Null;
        };
        let state = if self.attempt.is_some() {
            "unknown"
        } else if draft.conflict {
            "conflict"
        } else {
            "draft"
        };
        json!({
            "baseRevisionId":draft.base_revision_id, "generation":draft.generation,
            "markdown":if self.is_handwritten() { "" } else { self.markdown.as_str() }, "state":state,
            "handwritten":if self.is_handwritten() { serde_json::from_str::<Value>(&self.markdown).ok() } else { None },
        })
    }

    fn outcome(&self, state: SaveState, revision_id: Option<&str>) -> Value {
        json!({ "state":state, "revisionId":revision_id, "draft":self.draft_value() })
    }

    fn receipt_value(&self, receipt: &Receipt) -> Value {
        self.outcome(receipt.state, receipt.revision_id.as_deref())
    }

    fn resolve(&mut self, attempt: &Attempt, state: SaveState, revision_id: Option<String>) {
        if let Some(draft) = &mut self.draft {
            if state == SaveState::Conflict {
                draft.conflict = true;
            } else if draft.generation == attempt.generation {
                self.draft = None;
                self.markdown.clear();
            } else if draft.base_revision_id == attempt.base_revision_id {
                if let Some(revision_id) = &revision_id {
                    draft.base_revision_id = revision_id.clone();
                }
            }
        }
        self.attempt = None;
        self.receipt = Some(Receipt {
            operation_id: attempt.operation_id.clone(),
            generation: attempt.generation,
            state,
            revision_id,
        });
    }
}

struct InFlight(PathBuf);

impl Drop for InFlight {
    fn drop(&mut self) {
        if let Ok(mut state) = IN_FLIGHT.lock() {
            state.remove(&self.0);
        }
    }
}

type Invoke<'a> = dyn Fn(&str, &str, Value) -> neubiki_proton::Result<Value> + 'a;

struct Workspace<'a> {
    directory: PathBuf,
    invoke: &'a Invoke<'a>,
    can_write: bool,
}

impl LocalApi {
    pub fn cleanup_proton_note_ai(&self) -> std::result::Result<(), String> {
        self.with_proton_workspace(|workspace| workspace.sweep_note_ai()).map_err(|error| error.detail)
    }

    pub(super) fn proton_note_ai(&self, kind: &str, body: Value, files: &[LocalApiFile]) -> LocalApiResponse {
        match self.with_proton_workspace(|workspace| workspace.generate_note_ai(self, kind, &body, files)) {
            Ok(body) => LocalApiResponse { status: 200, body },
            Err(error) => error.response(Some("not-started")),
        }
    }

    fn with_proton_workspace<T>(&self, work: impl FnOnce(Workspace<'_>) -> T) -> T {
        let invoke = |account: &str, operation: &str, payload: Value| {
            self.pd_service().invoke(account, operation, payload)
        };
        work(Workspace {
            directory: self.pd_private_root().join("proton-workspace"),
            invoke: &invoke,
            can_write: VERIFIED_REVISION_WRITES,
        })
    }

    pub(super) fn validate_proton_tool_target(&self, body: &Value) -> std::result::Result<(), String> {
        self.with_proton_workspace(|workspace| workspace.validate_tool_target(body))
            .map_err(|error| error.detail)
    }

    pub(super) fn proton_research_document_id(&self, body: &Value) -> std::result::Result<String, String> {
        self.with_proton_workspace(|workspace| -> Result<_> {
            let scope: DocumentScope = parse_input(body)?;
            Ok(workspace.document(&scope)?.id)
        })
        .map_err(|error| error.detail)
    }

    pub(super) fn read_proton_ai_sources(&self, body: &Value, image_limit: Option<usize>) -> std::result::Result<Vec<AiSource>, String> {
        self.with_proton_workspace(|workspace| workspace.assistant_sources(body, image_limit))
            .map_err(|error| error.detail)
    }

    pub(super) fn proton_recovery_export(&self, body: &Value) -> std::result::Result<(String, String), String> {
        self.with_proton_workspace(|workspace| workspace.recovery_export(body))
            .map_err(|error| error.detail)
    }

    pub(super) fn proton_export_assets(
        &self,
        body: &Value,
        markdown: &str,
        include_images: bool,
    ) -> std::result::Result<Vec<neubiki_docs::ExportImageAsset>, String> {
        self.with_proton_workspace(|workspace| -> std::result::Result<_, String> {
            let scope: DocumentScope = parse_input(body).map_err(|error| error.detail)?;
            let document = workspace.document(&scope).map_err(|error| error.detail)?;
            if !include_images {
                return Ok(Vec::new());
            }
            let assets = workspace.export_images(&document, markdown)?;
            workspace.check_selection(&scope.account_id, &scope.root_id).map_err(|error| error.detail)?;
            Ok(assets)
        })
    }

    pub(super) fn proton_ai_image(&self, body: &Value) -> std::result::Result<Value, super::proton_ai_error::ProtonAiFailure> {
        use super::proton_ai_error::ProtonAiFailure as Failure;
        let prompt = body["prompt"].as_str().map(str::trim)
            .filter(|text| !text.is_empty() && text.len() <= 16_000)
            .ok_or_else(Failure::invalid_input)?;
        let ai = self.read_config_checked().map_err(|_| Failure::settings())?["ai"].clone();
        if ai["permissions"]["generateImages"] != true || ai["imageGeneration"]["enabled"] != true {
            return Err(Failure::before(403, "proton-ai-image-disabled", "Activa la generación de imágenes en Ajustes de IA."));
        }
        let key = self.openai_key().ok_or_else(Failure::key_required)?;
        self.validate_proton_tool_target(body).map_err(|_| Failure::target_changed())?;
        let project = super::proton_ai_text::proton_ai_project_id(body).map_err(|_| Failure::target_changed())?;
        self.spend_preflight(Some(&project)).map_err(|_| Failure::budget())?;
        let result = neubiki_ai::generate_image(Some(&key), &ai["imageGeneration"], prompt);
        if result["status"] != "completed" {
            return Err(Failure::provider_unconfirmed());
        }
        let operation = neubiki_core::compact_id("proton-image");
        let usage_recorded = self.record_research_image_usage(&project, &operation, &result).is_ok();
        let content = result["dataBase64"].as_str().ok_or_else(Failure::provider_unconfirmed)?;
        let mime = checked_image_type(content).map_err(|_| Failure::provider_unconfirmed())?;
        Ok(json!({"contentBase64":content,"contentType":mime,"usageRecorded":usage_recorded}))
    }

    pub(super) fn proton_workspace(&self, action: &str, body: Value, files: &[LocalApiFile]) -> LocalApiResponse {
        match self.with_proton_workspace(|workspace| {
            if action == "import-file" { workspace.import_file(&body, files) }
            else if matches!(action, "meeting-publish-review" | "meeting-publish" | "meeting-publish-check") {
                workspace.meeting_publication(self, action, &body)
            }
            else if matches!(action, "note-ai-check" | "note-ai-apply" | "note-ai-catalog") {
                workspace.note_ai_action(self, action, &body)
            }
            else if matches!(action, "profiles-read" | "profiles-publish" | "profiles-check") {
                workspace.shared_profiles(self, action, &body)
            }
            else if action == "replacement-apply" {
                let allow_ai = self.read_config_checked().ok().is_some_and(|config| config["ai"]["permissions"]["editDocuments"] == true);
                workspace.apply_replacements(&body, allow_ai)
            }
            else if action == "batch-edit-prepare" {
                workspace.batch_edit(self, "prepare", &body)
            }
            else { workspace.handle(action, body) }
        }) {
            Ok(body) => LocalApiResponse { status: 200, body },
            Err(error) => {
                let outcome = if matches!(action, "tree-edit" | "import-file") && (error.status >= 500 || error.status == 401) {
                    "unknown"
                } else {
                    "not-started"
                };
                error.response(Some(outcome))
            }
        }
    }
}

impl Workspace<'_> {
    fn handle(&self, action: &str, body: Value) -> Result<Value> {
        match action {
            "current" => Ok(match self.selection()? {
                Some(selection) => self.workspace(&selection),
                None => Value::Null,
            }),
            "root" => {
                let root: Node =
                    self.provider(token(&body, "accountId")?, "drive.root", json!({}))?;
                validate_node(&root)?;
                if root.kind != NodeKind::Folder {
                    return Err(Error::invalid_response());
                }
                Ok(json!({"root":root}))
            }
            "list" => self.list(&body),
            "search" => self.search(&body),
            "content-index-status" | "content-index-configure" | "content-index-clear" => self.content_index_action(action, &body),
            "favorites" => self.favorites(&body),
            "favorite-items" => self.favorite_items(&body),
            "favorites-update" => self.favorites_update(&body),
            "favorites-check" => self.favorites_check(&body),
            "resource-catalog" => self.resource_catalog(&body),
            "note-page-render" => self.note_page_render(&body),
            "reference-impact" => self.reference_impact(&body),
            "office-preview" => self.office_preview(&body),
            "select" => self.select(&body),
            "events" => self.events(&body),
            "replacement-review" => self.review_replacements(&body),
            "replacement-status" => self.replacement_status(&body),
            "recovery-list" => self.recovery_list(&body),
            "recovery-read" => self.recovery_read(&body),
            "recovery-remove-copy" => self.recovery_remove_copy(&body),
            "tree-edit" => self.tree_edit(&body),
            "trash-list" | "trash-restore" | "trash-check" => self.trash_action(action, &body),
            "read" | "asset" | "upload-image" | "draft" | "save" | "reconcile" | "discard" | "conflict-review" | "conflict-resolve" | "references" | "incoming-references" => {
                let scope: DocumentScope = parse_input(&body)?;
                let document = self.document(&scope)?;
                match action {
                    "read" => self.read(&document),
                    "asset" => self.asset(&document, &body),
                    "upload-image" => self.upload_image(&document, &body),
                    "draft" => self.draft(&document, &body),
                    "save" => self.save(&document, &body),
                    "reconcile" => self.reconcile(&document),
                    "discard" => self.discard(&document, &body),
                    "conflict-review" => self.conflict_review(&document),
                    "conflict-resolve" => self.conflict_resolve(&document, &body),
                    "references" => self.references(&document, &body),
                    "incoming-references" => self.incoming_references(&document, &body),
                    _ => unreachable!(),
                }
            }
            _ => Err(Error::new(
                404,
                "proton-operation-missing",
                "La operación Proton no existe.",
            )),
        }
    }

    fn provider<T: DeserializeOwned>(
        &self,
        account: &str,
        operation: &str,
        body: Value,
    ) -> Result<T> {
        let result = (self.invoke)(account, operation, body).map_err(Error::from)?;
        serde_json::from_value(result).map_err(|_| Error::invalid_response())
    }

    fn tree_edit(&self, body: &Value) -> Result<Value> {
        self.require_write()?;
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        let parent = token(body, "parentId")?;
        let action = token(body, "action")?;
        let mut request = json!({"rootId":root,"parentId":parent,"action":action});
        let source = match action {
            "create-folder" | "create-document" | "create-note" => None,
            "rename" | "move" | "duplicate" | "trash" => {
                let node = token(body, "nodeId")?;
                if node == root { return Err(Error::input()); }
                request["nodeId"] = json!(node);
                request["expectedName"] = json!(tree_name(body, "expectedName")?);
                Some(node)
            }
            _ => return Err(Error::input()),
        };
        if matches!(action, "create-folder" | "create-document" | "create-note" | "rename" | "duplicate") {
            request["name"] = json!(tree_name(body, "name")?);
        }
        if action == "create-note" {
            let name = tree_name(body, "name")?;
            if !name.to_ascii_lowercase().ends_with(".nbnote") { return Err(Error::input()); }
            request["contentBase64"] = json!(BASE64.encode(handwritten::new_note(name).to_string()));
        }
        if action == "move" {
            let target = token(body, "targetParentId")?;
            if Some(target) == source { return Err(Error::input()); }
            request["targetParentId"] = json!(target);
        }

        if action == "trash" {
            let ack: Value = self.provider(account, "drive.workspaceTreeEdit", request)?;
            if ack["trashedId"].as_str() != source { return Err(Error::invalid_response()); }
            return Ok(ack);
        }
        let expected_name = if action == "move" { request["expectedName"].clone() } else { request["name"].clone() };
        let node: Node = self.provider(account, "drive.workspaceTreeEdit", request)?;
        validate_node(&node)?;
        let same_node = source == Some(node.node_id.as_str());
        if expected_name.as_str() != Some(node.name.as_str())
            || node.node_id == root
            || same_node != matches!(action, "rename" | "move")
            || (action == "create-folder" && node.kind != NodeKind::Folder)
            || (matches!(action, "create-document" | "create-note" | "duplicate") && node.kind != NodeKind::File)
        {
            return Err(Error::invalid_response());
        }
        Ok(json!({"node":node}))
    }

    fn import_file(&self, body: &Value, files: &[LocalApiFile]) -> Result<Value> {
        self.require_write()?;
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        let parent = token(body, "parentId")?;
        let [file] = files else { return Err(Error::input()); };
        if file.field_name != "file" { return Err(Error::input()); }
        let name = file.name.as_str();
        if name.is_empty() || name != name.trim() || name.encode_utf16().count() > 255
            || name.ends_with('.') || name.chars().any(|ch| ch.is_control() || "\\/:*?\"<>|".contains(ch)) {
            return Err(Error::input());
        }
        let too_large = || Error::new(413, "file-too-large", "El archivo supera el límite de importación de 8 MiB.");
        if file.data_base64.len() > MAX_IMPORTED_FILE_BYTES.div_ceil(3) * 4 {
            return Err(too_large());
        }
        let bytes = BASE64.decode(&file.data_base64).map_err(|_| Error::input())?;
        if bytes.len() > MAX_IMPORTED_FILE_BYTES { return Err(too_large()); }
        let media_type = file.mime_type.as_deref().filter(|media| {
            media.len() <= 128 && media.split_once('/').is_some_and(|(kind, subtype)| {
                [kind, subtype].into_iter().all(|part| !part.is_empty() && part.bytes().all(|ch| {
                    ch.is_ascii_alphanumeric() || matches!(ch, b'+' | b'-' | b'.' | b'_')
                }))
            })
        }).unwrap_or("application/octet-stream");
        let node: Node = self.provider(account, "drive.workspaceTreeEdit", json!({
            "rootId":root,"parentId":parent,"action":"import-file","name":name,
            "mediaType":media_type,"contentBase64":file.data_base64,
        }))?;
        validate_node(&node)?;
        if node.kind != NodeKind::File || node.name != name || node.node_id == root || node.node_id == parent || node.revision_id.is_none() {
            return Err(Error::invalid_response());
        }
        Ok(json!({"node":node}))
    }

    fn selection(&self) -> Result<Option<Selection>> {
        let path = self.directory.join("selection.json");
        if !check_regular_directory(&self.directory)? {
            return Ok(None);
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(private_location()),
        };
        if !metadata.is_file() || batch::linked(&metadata) || metadata.len() > 16_384 {
            return Err(private_location());
        }
        let bytes = fs::read(path).map_err(|_| private_location())?;
        let selection: Selection =
            serde_json::from_slice(&bytes).map_err(|_| private_location())?;
        if selection.schema_version != 1
            || !valid_token(&selection.account_id)
            || selection.root.kind != NodeKind::Folder
            || validate_node(&selection.root).is_err()
        {
            return Err(private_location());
        }
        Ok(Some(selection))
    }

    fn workspace(&self, selection: &Selection) -> Value {
        json!({"accountId":selection.account_id,"root":selection.root,"canWrite":self.can_write})
    }

    fn select(&self, body: &Value) -> Result<Value> {
        let account = token(body, "accountId")?;
        let root_uid = token(body, "rootId")?;
        let root: Node =
            self.provider(account, "drive.workspaceFolder", json!({"rootId":root_uid}))?;
        validate_node(&root)?;
        if root.kind != NodeKind::Folder || root.node_id != root_uid {
            return Err(Error::invalid_response());
        }
        let selection = Selection {
            schema_version: 1,
            account_id: account.into(),
            root,
        };
        let _lock = gate()?;
        self.selection()?;
        ensure_directory(&self.directory)?;
        let encoded = serde_json::to_vec(&selection).map_err(|_| private_location())?;
        atomic_io::write(&self.directory.join("selection.json"), &encoded)
            .map_err(|_| private_location())?;
        Ok(self.workspace(&selection))
    }

    fn list(&self, body: &Value) -> Result<Value> {
        let account = token(body, "accountId")?;
        let parent = token(body, "parentId")?;
        let root = if body["rootId"].is_null() {
            None
        } else {
            let selected = token(body, "rootId")?;
            self.check_selection(account, selected)?;
            Some(selected)
        };
        #[derive(Deserialize)]
        struct Listing {
            items: Vec<Node>,
            complete: bool,
        }
        let listing: Listing = self.provider(
            account,
            "drive.workspaceList",
            json!({"parentId":parent,"rootId":root}),
        )?;
        if !listing.complete || listing.items.len() > 10_000 {
            return Err(Error::invalid_response());
        }
        for node in &listing.items {
            validate_node(node)?;
        }
        let items: Vec<_> = listing.items.into_iter()
            .filter(|node| !super::path_policy::reserved(std::ffi::OsStr::new(&node.name))).collect();
        Ok(json!({"items":items}))
    }

    fn events(&self, body: &Value) -> Result<Value> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        let cursor = if body["cursor"].is_null() {
            None
        } else {
            Some(token(body, "cursor")?)
        };
        #[derive(Deserialize, Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Events {
            cursor: Option<String>,
            changed: bool,
            requires_refresh: bool,
        }
        let events: Events = self.provider(
            account,
            "drive.events",
            json!({"rootId":root,"cursor":cursor}),
        )?;
        if events
            .cursor
            .as_deref()
            .is_some_and(|value| !valid_token(value))
        {
            return Err(Error::invalid_response());
        }
        Ok(json!(events))
    }

    fn check_selection(&self, account: &str, root: &str) -> Result<()> {
        if self
            .selection()?
            .is_some_and(|selected| selected.account_id == account && selected.root.node_id == root)
        {
            return Ok(());
        }
        Err(Error::new(
            409,
            "proton-workspace-changed",
            "La carpeta seleccionada cambió. Vuelve a abrir el archivo.",
        ))
    }

    fn document<'a>(&self, scope: &'a DocumentScope) -> Result<Document<'a>> {
        let document = Self::document_key(scope)?;
        self.check_selection(&scope.account_id, &scope.root_id)?;
        Ok(document)
    }

    fn document_key(scope: &DocumentScope) -> Result<Document<'_>> {
        if [&scope.account_id, &scope.root_id, &scope.node_id]
            .iter()
            .any(|id| !valid_token(id))
        {
            return Err(Error::input());
        }
        let identity = json!([&scope.account_id, &scope.root_id, &scope.node_id]).to_string();
        Ok(Document {
            scope,
            id: format!("proton-{}", super::sha256_hex(identity.as_bytes())),
        })
    }

    fn validate_tool_target(&self, body: &Value) -> Result<()> {
        let scope: DocumentScope = parse_input(body)?;
        let document = self.document(&scope)?;
        let base = token(body, "baseRevisionId")?;
        if !valid_revision(&scope.node_id, base) {
            return Err(Error::input());
        }
        let node: Node = self.provider(&scope.account_id, "drive.workspaceStat", document.request())?;
        validate_node(&node)?;
        if node.node_id != scope.node_id || node.kind != NodeKind::File || !is_markdown(&node.name) {
            return Err(Error::invalid_response());
        }
        if node.revision_id.as_deref() != Some(base) {
            return Err(Error::new(409, "revision-conflict", "La revisión de Proton cambió. Vuelve a leer el documento antes de solicitar una propuesta."));
        }
        self.check_selection(&scope.account_id, &scope.root_id)
    }

    fn remote_read(&self, document: &Document<'_>, asset: Option<&str>) -> Result<RemoteRead> {
        let mut payload = document.request();
        let operation = if let Some(path) = asset {
            payload["relativePath"] = json!(path);
            "drive.workspaceAsset"
        } else {
            "drive.workspaceRead"
        };
        let remote: RemoteRead = self.provider(&document.scope.account_id, operation, payload)?;
        validate_node(&remote.node)?;
        if remote.node.kind != NodeKind::File
            || remote.node.revision_id.as_deref() != Some(remote.revision_id.as_str())
            || (asset.is_none() && remote.node.node_id != document.scope.node_id)
            || (asset.is_none() && remote.ancestor_ids.as_ref().is_some_and(|ids| {
                ids.len() > 128 || ids.first() != Some(&document.scope.root_id)
                    || ids.iter().any(|id| !valid_token(id) || id == &document.scope.node_id)
                    || ids.iter().collect::<BTreeSet<_>>().len() != ids.len()
            }))
        {
            return Err(Error::invalid_response());
        }
        Ok(remote)
    }

    fn read(&self, document: &Document<'_>) -> Result<Value> {
        let remote = self.remote_read(document, None)?;
        if is_handwritten(&remote.node.name) {
            let note = read_preview_note(&remote, &document.id)?;
            self.check_selection(&document.scope.account_id, &document.scope.root_id)?;
            let _lock = gate()?;
            let mut journal = self.load_journal(document)?;
            if journal.draft.is_some() && !journal.is_handwritten() { return Err(private_location()); }
            if journal.attempt.is_none() {
                if let Some(draft) = &mut journal.draft { draft.conflict |= draft.base_revision_id != remote.revision_id; }
            }
            return Ok(json!({"node":remote.node,"revisionId":remote.revision_id,"ancestorIds":remote.ancestor_ids,
                "markdown": Value::Null, "contentBase64": Value::Null, "handwritten":note, "draft":journal.draft_value()}));
        }
        let markdown = is_markdown(&remote.node.name);
        let (text, bytes) = if markdown {
            // Preserve the exact UTF-8 text so the user can reconcile byte-for-byte.
            let data = BASE64
                .decode(&remote.content_base64)
                .map_err(|_| Error::invalid_response())?;
            let text = String::from_utf8(data).map_err(|_| {
                Error::new(
                    422,
                    "invalid-markdown-encoding",
                    "El Markdown en Proton no está codificado en UTF-8.",
                )
            })?;
            (Some(text), None)
        } else {
            (None, Some(remote.content_base64))
        };
        let _lock = gate()?;
        self.check_selection(&document.scope.account_id, &document.scope.root_id)?;
        let mut journal = self.load_journal(document)?;
        if journal.attempt.is_none() {
            if let Some(draft) = &mut journal.draft {
                draft.conflict |= draft.base_revision_id != remote.revision_id;
            }
        }
        Ok(json!({
            "node":remote.node,"revisionId":remote.revision_id,"ancestorIds":remote.ancestor_ids,
            "markdown":text,"contentBase64":bytes,"draft":journal.draft_value(),
        }))
    }

    fn asset(&self, document: &Document<'_>, body: &Value) -> Result<Value> {
        let path = body["relativePath"]
            .as_str()
            .filter(|text| !text.is_empty() && text.len() <= 4096)
            .ok_or_else(Error::input)?;
        let remote = self.remote_read(document, Some(path))?;
        let bytes = BASE64
            .decode(&remote.content_base64)
            .map_err(|_| Error::invalid_response())?;
        let mime = image_type(&bytes).ok_or_else(|| {
            Error::new(
                422,
                "unsupported-proton-image",
                "La imagen de Proton debe ser PNG, JPEG, GIF o WebP.",
            )
        })?;
        Ok(
            json!({"node":remote.node,"revisionId":remote.revision_id,"contentType":mime,"contentBase64":remote.content_base64}),
        )
    }

    fn export_images(
        &self,
        document: &Document<'_>,
        markdown: &str,
    ) -> std::result::Result<Vec<neubiki_docs::ExportImageAsset>, String> {
        let mut seen = BTreeSet::new();
        let mut assets = Vec::new();
        let mut budget: usize = 64 * 1024 * 1024;
        for image in neubiki_docs::markdown_images(markdown) {
            let source = image.source.trim();
            if source.is_empty() || !seen.insert(source.to_string()) {
                continue;
            }
            if seen.len() > 128 {
                return Err("La exportación admite hasta 128 imágenes".into());
            }
            let (content_type, bytes) = if source.starts_with("data:") {
                if source.len() > 16 * 1024 * 1024 {
                    return Err("Una imagen incrustada supera el límite de exportación".into());
                }
                super::image_data_url_bytes(source).ok_or("La imagen incrustada no tiene un formato raster compatible")?
            } else {
                let raw = source.split(['?', '#']).next().unwrap_or(source);
                let relative = neubiki_core::percent_decode(raw);
                if relative.is_empty() || relative.len() > 4096 || relative.starts_with('/')
                    || relative.contains(['\\', ':', '\0'])
                {
                    return Err("Para exportar una imagen externa, guárdala primero como recurso de Proton Drive".into());
                }
                let remote = self.remote_read(document, Some(&relative)).map_err(|error| error.detail)?;
                let (bytes, mime) = bounded_image(&remote.content_base64).map_err(|error| error.detail)?;
                (mime.to_string(), bytes)
            };
            budget = budget.checked_sub(bytes.len()).ok_or("Las imágenes de exportación superan 64 MiB")?;
            assets.push(neubiki_docs::ExportImageAsset {
                source: source.to_string(),
                alt: Some(image.alt),
                content_type,
                bytes,
            });
        }
        Ok(assets)
    }

    fn upload_image(&self, document: &Document<'_>, body: &Value) -> Result<Value> {
        self.require_write()?;
        let content = body["contentBase64"].as_str().ok_or_else(Error::input)?;
        let (bytes, mime) = bounded_image(content)?;
        let extension = match mime {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            _ => unreachable!(),
        };
        let expected = format!("assets/neubiki-{}.{extension}", super::sha256_hex(&bytes));
        let mut payload = document.request();
        payload["mediaType"] = json!(mime);
        payload["contentBase64"] = json!(content);
        let result: Value = self.provider(
            &document.scope.account_id,
            "drive.workspaceUploadImage",
            payload,
        )?;
        if result["relativePath"].as_str() != Some(expected.as_str()) {
            return Err(Error::invalid_response());
        }
        // Newly uploaded nodes may take a moment to appear in folder reads.
        // Observe the bytes at the relative path before exposing it to Milkdown.
        // A failed observation leaves the image staged, with no upload replay.
        for attempt in 0..3 {
            self.check_selection(&document.scope.account_id, &document.scope.root_id)?;
            match self.remote_read(document, Some(&expected)) {
                Ok(remote) => {
                    let observed = BASE64.decode(remote.content_base64).map_err(|_| Error::invalid_response())?;
                    if observed != bytes {
                        return Err(Error::invalid_response());
                    }
                    return Ok(json!({"relativePath":expected}));
                }
                Err(error) if attempt < 2 && error.code == "not-found" => {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                Err(error) => return Err(error),
            }
        }
        unreachable!()
    }

    fn draft(&self, document: &Document<'_>, body: &Value) -> Result<Value> {
        self.require_write()?;
        let base_revision = token(body, "baseRevisionId")?;
        if !valid_revision(&document.scope.node_id, base_revision) {
            return Err(Error::input());
        }
        let is_note = body.get("handwritten").is_some();
        let serialized;
        let markdown = if is_note {
            serialized = handwritten::serialize_note(&body["handwritten"])?;
            serialized.as_str()
        } else { body["markdown"].as_str().ok_or_else(Error::input)? };
        if markdown.len() > if is_note { MAX_NOTE_BYTES } else { MAX_MARKDOWN_BYTES } {
            return Err(Error::new(
                413,
                "proton-edit-too-large",
                "El Markdown editable admite hasta 4 MiB.",
            ));
        }
        let expected_generation = generation(body, "expectedGeneration")?;
        let _lock = gate()?;
        let selection = self.recovery_selection(document)?;
        let mut record = self.load_journal(document)?;
        if record.draft.is_some() && record.is_handwritten() != is_note { return Err(Error::generation()); }
        if record.draft.as_ref().map(|draft| draft.generation) != expected_generation
            || record
                .draft
                .as_ref()
                .is_some_and(|draft| draft.base_revision_id != base_revision)
        {
            return Err(Error::generation());
        }
        if record.draft.is_some() && record.markdown == markdown {
            return Ok(record.draft_value());
        }
        record.last_generation = record
            .last_generation
            .checked_add(1)
            .filter(|next| *next < 9_007_199_254_740_992)
            .ok_or_else(Error::generation)?;
        record.markdown = markdown.into();
        record.content_kind = if is_note { Some("handwritten".into()) } else { None };
        record.draft = Some(DraftRecord {
            generation: record.last_generation,
            base_revision_id: base_revision.into(),
            conflict: record.draft.is_some_and(|draft| draft.conflict),
        });
        record.owner = Some(workspace_recovery::RecoveryOwner::capture(
            document.scope, &selection,
            if is_note { Some(body["documentName"].as_str().filter(|name| is_handwritten(name)).unwrap_or("Nota manuscrita.nbnote")) }
            else { body["documentName"].as_str() }, record.owner.as_ref(),
        ));
        self.write_journal(&record)?;
        Ok(record.draft_value())
    }

    fn save(&self, document: &Document<'_>, body: &Value) -> Result<Value> {
        self.require_write()?;
        let operation_id = token(body, "operationId")?;
        let generation = generation(body, "generation")?.ok_or_else(Error::input)?;
        let (attempt, markdown, is_note, in_flight) = {
            let mut lock = gate()?;
            let mut journal = self.load_journal(document)?;
            if let Some(receipt) = journal.receipt.as_ref().filter(|receipt| {
                receipt.operation_id == operation_id && receipt.generation == generation
            }) {
                return Ok(journal.receipt_value(receipt));
            }
            if journal.attempt.is_some() {
                return Ok(journal.outcome(SaveState::Unknown, None));
            }
            if journal
                .receipt
                .as_ref()
                .is_some_and(|receipt| receipt.operation_id == operation_id)
            {
                return Err(Error::generation());
            }
            let draft = journal
                .draft
                .as_ref()
                .filter(|draft| draft.generation == generation)
                .ok_or_else(Error::generation)?;
            if draft.conflict {
                return Ok(journal.outcome(SaveState::Conflict, None));
            }

            let attempt = Attempt {
                operation_id: operation_id.into(),
                generation,
                base_revision_id: draft.base_revision_id.clone(),
                content_sha256: super::sha256_hex(journal.markdown.as_bytes()),
            };
            journal.attempt = Some(attempt.clone());
            let key = draft_store::path(&self.drafts_dir(), &document.id);
            self.write_journal(&journal)?;
            lock.insert(key.clone());
            let is_note = journal.is_handwritten();
            (attempt, journal.markdown, is_note, InFlight(key))
        };

        let mut payload = document.request();
        payload["baseRevisionId"] = json!(attempt.base_revision_id);
        payload["contentBase64"] = json!(BASE64.encode(markdown));
        if is_note { payload["contentKind"] = json!("handwritten"); }
        let uploaded: Result<RevisionAck> =
            self.provider(&document.scope.account_id, "drive.writeRevision", payload);
        let result = match uploaded {
            Ok(ack)
                if ack.node_id == document.scope.node_id
                    && valid_revision(&ack.node_id, &ack.revision_id)
                    && ack.revision_id != attempt.base_revision_id =>
            {
                self.complete_attempt(document, &attempt, SaveState::Saved, Some(ack.revision_id))
            }
            Err(error) if error.code == "revision-conflict" => {
                self.complete_attempt(document, &attempt, SaveState::Conflict, None)
            }
            _ => Ok(self.pending_outcome(document)),
        };
        drop(in_flight);
        // The attempt is already durable. If the local acknowledgement cannot be
        // recorded, make the uncertainty visible and require read reconciliation.
        Ok(result.unwrap_or_else(|_| self.pending_outcome(document)))
    }

    fn reconcile(&self, document: &Document<'_>) -> Result<Value> {
        let attempt = {
            let lock = gate()?;
            let journal = self.load_journal(document)?;
            let Some(attempt) = journal.attempt.clone() else {
                if journal.draft.as_ref().is_some_and(|draft| draft.conflict) {
                    return Ok(journal.outcome(SaveState::Conflict, None));
                }
                if let Some(receipt) = &journal.receipt {
                    return Ok(journal.receipt_value(receipt));
                }
                return Err(Error::new(
                    409,
                    "no-pending-proton-save",
                    "No hay un guardado pendiente de comprobar.",
                ));
            };
            if lock.contains(&draft_store::path(&self.drafts_dir(), &document.id)) {
                return Ok(journal.outcome(SaveState::Unknown, None));
            }
            attempt
        };
        let remote = self.remote_read(document, None)?;
        let bytes = BASE64
            .decode(remote.content_base64)
            .map_err(|_| Error::invalid_response())?;
        if super::sha256_hex(&bytes) != attempt.content_sha256 {
            return Ok(self.pending_outcome(document));
        }
        // Matching current bytes establish only what is present, regardless of
        // whether this attempt or a different client supplied them.
        self.complete_attempt(
            document,
            &attempt,
            SaveState::Observed,
            Some(remote.revision_id),
        )
    }

    fn pending_outcome(&self, document: &Document<'_>) -> Value {
        gate()
            .and_then(|_lock| self.load_journal(document))
            .map_or_else(
                |_| json!({"state":"unknown","revisionId":null,"draft":null}),
                |journal| journal.outcome(SaveState::Unknown, None),
            )
    }

    fn complete_attempt(
        &self,
        document: &Document<'_>,
        attempt: &Attempt,
        state: SaveState,
        revision: Option<String>,
    ) -> Result<Value> {
        let _lock = gate()?;
        let mut journal = self.load_journal(document)?;
        if journal.attempt.as_ref() != Some(attempt) {
            return match journal.receipt.as_ref().filter(|receipt| {
                receipt.operation_id == attempt.operation_id
                    && receipt.generation == attempt.generation
            }) {
                Some(receipt) => Ok(journal.receipt_value(receipt)),
                None => Err(Error::generation()),
            };
        }
        journal.resolve(attempt, state, revision);
        self.write_journal(&journal)?;
        Ok(journal.receipt_value(journal.receipt.as_ref().expect("receipt just recorded")))
    }

    fn discard(&self, document: &Document<'_>, body: &Value) -> Result<Value> {
        let generation = generation(body, "generation")?.ok_or_else(Error::input)?;
        let lock = gate()?;
        if lock.contains(&draft_store::path(&self.drafts_dir(), &document.id)) {
            return Err(Error::new(
                409,
                "proton-save-in-flight",
                "El guardado sigue en curso. Comprueba su resultado antes de descartar.",
            ));
        }
        let mut journal = self.load_journal(document)?;
        if journal.draft.as_ref().map(|draft| draft.generation) != Some(generation) {
            return Err(Error::generation());
        }
        journal.draft = None;
        journal.attempt = None;
        journal.markdown.clear();
        self.write_journal(&journal)?;
        Ok(json!({"discarded":true}))
    }

    fn require_write(&self) -> Result<()> {
        if self.can_write {
            Ok(())
        } else {
            Err(Error::new(
                403,
                "proton-workspace-read-only",
                "El espacio Proton está abierto en modo de solo lectura.",
            ))
        }
    }

    fn drafts_dir(&self) -> PathBuf {
        self.directory.join("drafts")
    }

    fn load_journal(&self, document: &Document<'_>) -> Result<Journal> {
        if !check_regular_directory(&self.directory)? {
            return Ok(Journal::new(document.id.clone()));
        }
        let stored =
            draft_store::inspect(&self.drafts_dir(), &document.id).map_err(Error::local)?;
        let Some(value) = stored else {
            return Ok(Journal::new(document.id.clone()));
        };
        let record: Journal = serde_json::from_value(value).map_err(|_| private_location())?;
        if record.schema_version != 1
            || record.document_id != document.id
            || !record.has_valid_recovery(document)
            || record.draft.as_ref().is_some_and(|draft| {
                draft.generation != record.last_generation
                    || !valid_revision(&document.scope.node_id, &draft.base_revision_id)
            })
            || record.attempt.as_ref().is_some_and(|attempt| {
                record.draft.is_none()
                    || attempt.generation > record.last_generation
                    || !valid_revision(&document.scope.node_id, &attempt.base_revision_id)
            })
        {
            return Err(private_location());
        }
        Ok(record)
    }

    fn write_journal(&self, journal: &Journal) -> Result<()> {
        let drafts = self.drafts_dir();
        ensure_directory(&self.directory)?;
        ensure_directory(&drafts)?;
        let value = serde_json::to_value(journal).map_err(|_| private_location())?;
        draft_store::write(&drafts, &journal.document_id, &value).map_err(Error::local)
    }
}

struct Document<'a> {
    scope: &'a DocumentScope,
    id: String,
}

impl Document<'_> {
    fn request(&self) -> Value {
        json!({"rootId":self.scope.root_id,"nodeId":self.scope.node_id})
    }
}

fn gate() -> Result<MutexGuard<'static, BTreeSet<PathBuf>>> {
    IN_FLIGHT.lock().map_err(|_| private_location())
}

fn parse_input<T: DeserializeOwned>(value: &Value) -> Result<T> {
    T::deserialize(value).map_err(|_| Error::input())
}

fn token<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    value[field]
        .as_str()
        .filter(|text| valid_token(text))
        .ok_or_else(Error::input)
}

fn tree_name<'a>(body: &'a Value, field: &str) -> Result<&'a str> {
    body[field].as_str()
        .filter(|name| !name.is_empty() && name.len() <= 1024 && !name.chars().any(char::is_control)
            && !super::path_policy::reserved(std::ffi::OsStr::new(name)))
        .ok_or_else(Error::input)
}

fn generation(value: &Value, field: &str) -> Result<Option<u64>> {
    let field = value.get(field).ok_or_else(Error::input)?;
    if field.is_null() {
        return Ok(None);
    }
    field
        .as_u64()
        .filter(|value| (1..9_007_199_254_740_992).contains(value))
        .map(Some)
        .ok_or_else(Error::input)
}

fn valid_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 1024
        && !token.chars().any(char::is_whitespace)
        && !token.chars().any(char::is_control)
}

fn valid_revision(node: &str, revision: &str) -> bool {
    valid_token(revision)
        && revision
            .strip_prefix(node)
            .and_then(|suffix| suffix.strip_prefix('~'))
            .is_some_and(|id| !id.is_empty() && !id.contains('~'))
}

fn validate_node(node: &Node) -> Result<()> {
    let coherent = match node.kind {
        NodeKind::Folder => node.revision_id.is_none(),
        NodeKind::File => node
            .revision_id
            .as_deref()
            .is_some_and(|id| valid_revision(&node.node_id, id)),
    };
    if !valid_token(&node.node_id) || node.name.is_empty() || !coherent {
        Err(Error::invalid_response())
    } else {
        Ok(())
    }
}

pub(super) fn is_markdown(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, ext)| {
        ["md", "markdown", "mdown"].iter().any(|format| ext.eq_ignore_ascii_case(format))
    })
}

fn read_preview_note(remote: &RemoteRead, id: &str) -> Result<Value> {
    if remote.content_base64.len() > 4 * MAX_NOTE_BYTES.div_ceil(3) {
        return Err(Error::new(422, "proton-knote-size", "La nota supera los 8 MiB admitidos por el visor."));
    }
    let bytes = BASE64.decode(&remote.content_base64).map_err(|_| Error::invalid_response())?;
    if bytes.len() > MAX_NOTE_BYTES {
        return Err(Error::new(422, "proton-knote-size", "La nota supera los 8 MiB admitidos por el visor."));
    }
    let content: Value = serde_json::from_slice(&bytes).map_err(|_| {
        Error::new(422, "proton-knote-format", "No se pudo leer esta nota manuscrita.")
    })?;
    super::document_validation::handwritten(&content).map_err(|_| {
        Error::new(422, "proton-knote-format", "Esta versión o estructura de nota manuscrita no es compatible.")
    })?;
    let stored_id = content["id"].as_str().unwrap_or(id).to_owned();
    Ok(super::normalize_handwritten_note(content, &stored_id, &remote.node.name))
}

pub(super) fn is_handwritten(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, ext)| ["nbnote", "knote"].iter().any(|format| ext.eq_ignore_ascii_case(format)))
}

fn image_type(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if data.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

pub(super) fn checked_image_type(content: &str) -> std::result::Result<&'static str, String> {
    bounded_image(content).map(|(_, mime)| mime).map_err(|error| error.detail)
}

fn bounded_image(content: &str) -> Result<(Vec<u8>, &'static str)> {
    let too_large = || Error::new(413, "file-too-large", "La imagen supera el límite de 8 MiB.");
    if content.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
        return Err(too_large());
    }
    let bytes = BASE64.decode(content).map_err(|_| Error::input())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(too_large());
    }
    let mime = image_type(&bytes).ok_or_else(|| {
        Error::new(422, "unsupported-proton-image", "Usa una imagen PNG, JPEG, GIF o WebP.")
    })?;
    Ok((bytes, mime))
}

fn private_location() -> Error {
    Error::local(
        "No se puede verificar el almacenamiento privado de Proton. Se conservan los archivos."
            .into(),
    )
}

fn check_regular_directory(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !batch::linked(&metadata) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        _ => Err(private_location()),
    }
}

fn ensure_directory(path: &Path) -> Result<()> {
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(error)
            if error.kind() == io::ErrorKind::AlreadyExists && check_regular_directory(path)? =>
        {
            Ok(())
        }
        _ => Err(private_location()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    const ROOT: &str = "volume~root";
    const NODE: &str = "volume~document";
    const BASE: &str = "volume~document~base";
    const NEXT: &str = "volume~document~next";

    fn payload() -> Value {
        json!({"accountId":"test","rootId":ROOT,"nodeId":NODE})
    }

    fn draft(text: &str, expected: Option<u64>) -> Value {
        let mut body = payload();
        body["baseRevisionId"] = json!(BASE);
        body["markdown"] = json!(text);
        body["expectedGeneration"] = json!(expected);
        body
    }

    fn save(generation: u64) -> Value {
        let mut body = payload();
        body["generation"] = json!(generation);
        body["operationId"] = json!("same-request");
        body
    }

    fn folder() -> Value {
        json!({"nodeId":ROOT,"name":"Fixture","type":"folder"})
    }

    fn file(node: &str, name: &str, revision: &str) -> Value {
        json!({"nodeId":node,"name":name,"type":"file","revisionId":revision})
    }

    fn remote(node: &str, name: &str, revision: &str, bytes: &[u8]) -> Value {
        json!({
            "node":file(node,name,revision),"revisionId":revision,
            "contentBase64":BASE64.encode(bytes)
        })
    }

    #[test]
    fn reads_a_supported_note_for_preview_and_rejects_unknown_versions() {
        let mut note = super::super::default_handwritten_note("original-note", "Example");
        let read = |note: &Value| serde_json::from_value::<RemoteRead>(remote(
            NODE, "Example.knote", BASE, &serde_json::to_vec(note).unwrap(),
        )).unwrap();
        let preview = read_preview_note(&read(&note), "instance-note").unwrap();
        assert_eq!(preview["pages"], note["pages"]);
        assert_eq!(preview["id"], "original-note");
        note["schemaVersion"] = json!(99);
        assert_eq!(read_preview_note(&read(&note), "instance-note").unwrap_err().code, "proton-knote-format");
    }

    #[test]
    fn proton_workspace_recovery_reads_legacy_drafts_after_remote_disappears() {
        let dir = tempfile::tempdir().unwrap();
        let available = Cell::new(true);
        let invoke = |_: &str, operation: &str, _: Value| {
            assert!(available.get(), "Recovery must make no provider call");
            assert_eq!(operation, "drive.workspaceFolder");
            Ok(folder())
        };
        let workspace = Workspace { directory: dir.path().join("state"), invoke: &invoke, can_write: true };
        workspace.handle("select", payload()).unwrap();
        let scope: DocumentScope = parse_input(&payload()).unwrap();
        let document = workspace.document(&scope).unwrap();
        let mut legacy = Journal::new(document.id);
        legacy.last_generation = 1;
        legacy.draft = Some(DraftRecord { base_revision_id: BASE.into(), generation: 1, conflict: false });
        legacy.markdown = "# Texto original".into();
        workspace.write_journal(&legacy).unwrap();
        available.set(false);

        let listed = workspace.handle("recovery-list", json!({"cursor":null})).unwrap();
        assert_eq!(listed["entries"][0]["key"]["nodeId"], NODE);
        assert_eq!(listed["entries"][0]["rootName"], "Fixture");
        let target = json!({"accountId":"test","rootId":ROOT,"nodeId":NODE,"generation":1,"kind":"draft"});
        assert_eq!(workspace.handle("recovery-read", target.clone()).unwrap()["markdown"], "# Texto original");
        assert_eq!(workspace.recovery_export(&json!({"recovery":target})).unwrap().1, "# Texto original");
        let mut different_root = target;
        different_root["rootId"] = json!("volume~different");
        assert_eq!(workspace.handle("recovery-read", different_root).unwrap_err().code, "proton-recovery-changed");
    }

    #[test]
    fn proton_workspace_resolution_preserves_both_versions_and_revalidates_bases() {
        let dir = tempfile::tempdir().unwrap();
        let revision = Cell::new(NEXT);
        let writes = Cell::new(0);
        let invoke = |_: &str, operation: &str, request: Value| match operation {
            "drive.workspaceFolder" => Ok(folder()),
            "drive.workspaceRead" => Ok(remote(NODE, "Revision.mdown", revision.get(), b"# Remote")),
            "drive.writeRevision" => {
                writes.set(writes.get() + 1);
                assert_eq!(request["baseRevisionId"], NEXT);
                assert_eq!(request["contentBase64"], BASE64.encode("# Combined"));
                Ok(json!({"nodeId":NODE,"revisionId":"volume~document~saved"}))
            }
            _ => panic!("Unexpected operation {operation}"),
        };
        let workspace = Workspace { directory: dir.path().join("state"), invoke: &invoke, can_write: true };
        workspace.handle("select", payload()).unwrap();
        workspace.handle("draft", draft("# Mine", None)).unwrap();
        let reloaded = workspace.handle("read", payload()).unwrap();
        assert_eq!(reloaded["markdown"], "# Remote");
        assert_eq!(reloaded["draft"]["state"], "conflict");
        assert_eq!(workspace.handle("conflict-review", payload()).unwrap()["remoteRevisionId"], NEXT);

        let request = json!({"accountId":"test","rootId":ROOT,"nodeId":NODE,"draftGeneration":1,
            "remoteRevisionId":NEXT,"markdown":"# Combined"});
        revision.set("volume~document~another");
        assert_eq!(workspace.handle("conflict-resolve", request.clone()).unwrap_err().code, "proton-conflict-review-stale");
        revision.set(NEXT);
        let response = workspace.handle("conflict-resolve", request.clone()).unwrap();
        assert_eq!(response["draft"]["generation"], 2);
        assert_eq!(response["draft"]["baseRevisionId"], NEXT);
        assert_eq!(response["draft"]["markdown"], "# Combined");
        assert_eq!(writes.get(), 0);
        assert!(workspace.handle("conflict-resolve", request).is_err());
        assert_eq!(workspace.handle("save", save(2)).unwrap()["state"], "saved");

        let archived = workspace.handle("recovery-list", json!({})).unwrap();
        assert_eq!(archived["entries"].as_array().unwrap().len(), 2);
        for (kind, expected) in [("local-original", "# Mine"), ("remote-original", "# Remote")] {
            let body = json!({"accountId":"test","rootId":ROOT,"nodeId":NODE,"generation":1,"kind":kind});
            assert_eq!(workspace.handle("recovery-read", body).unwrap()["markdown"], expected);
        }
    }

    #[test]
    fn tree_edits_are_scoped_and_require_a_matching_provider_receipt() {
        let temp = tempfile::tempdir().unwrap();
        let calls = Cell::new(0);
        let valid_ack = Cell::new(true);
        let invoke = |account: &str, operation: &str, body: Value| {
            assert_eq!(account, "test");
            if operation == "drive.workspaceFolder" { return Ok(folder()); }
            assert_eq!(operation, "drive.workspaceTreeEdit");
            assert_eq!(body["rootId"], ROOT);
            assert_eq!(body["parentId"], ROOT);
            assert_eq!(body["nodeId"], NODE);
            assert_eq!(body["expectedName"], "Antes.md");
            calls.set(calls.get() + 1);
            Ok(match body["action"].as_str() {
                Some("rename") => file(NODE, "Después.md", BASE),
                Some("trash") => json!({"trashedId":if valid_ack.get() { NODE } else { ROOT }}),
                _ => panic!("unexpected mutation"),
            })
        };
        let workspace = Workspace { directory: temp.path().join("workspace"), invoke: &invoke, can_write: true };
        workspace.handle("select", payload()).unwrap();
        let mut edit = payload();
        edit["parentId"] = json!(ROOT);
        edit["expectedName"] = json!("Antes.md");
        edit["action"] = json!("rename");
        edit["name"] = json!("Después.md");
        let read_only = Workspace { directory: workspace.directory.clone(), invoke: &invoke, can_write: false };
        assert_eq!(read_only.handle("tree-edit", edit.clone()).unwrap_err().status, 403);
        edit["rootId"] = json!("otra-raiz");
        assert_eq!(workspace.handle("tree-edit", edit.clone()).unwrap_err().status, 409);
        edit["rootId"] = json!(ROOT);
        edit["nodeId"] = json!(ROOT);
        assert_eq!(workspace.handle("tree-edit", edit.clone()).unwrap_err().status, 400);
        assert_eq!(calls.get(), 0);
        edit["nodeId"] = json!(NODE);
        assert_eq!(workspace.handle("tree-edit", edit.clone()).unwrap()["node"]["name"], "Después.md");
        edit["action"] = json!("trash");
        assert_eq!(workspace.handle("tree-edit", edit.clone()).unwrap()["trashedId"], NODE);
        valid_ack.set(false);
        assert_eq!(workspace.handle("tree-edit", edit).unwrap_err().status, 502);
    }

    #[test]
    fn file_import_requires_the_selected_scope_and_a_confirmed_new_file() {
        let temp = tempfile::tempdir().unwrap();
        let calls = Cell::new(0);
        let confirmed = Cell::new(true);
        let invoke = |account: &str, operation: &str, body: Value| {
            assert_eq!(account, "test");
            if operation == "drive.workspaceFolder" { return Ok(folder()); }
            assert_eq!(operation, "drive.workspaceTreeEdit");
            assert_eq!(body["action"], "import-file");
            assert_eq!(body["rootId"], ROOT);
            assert_eq!(body["parentId"], ROOT);
            assert_eq!(body["mediaType"], "application/octet-stream");
            assert_eq!(body["contentBase64"], BASE64.encode([0u8, 17, 63, 255]));
            calls.set(calls.get() + 1);
            Ok(file(if confirmed.get() { NODE } else { ROOT }, "Foto.bin", BASE))
        };
        let workspace = Workspace { directory: temp.path().join("workspace"), invoke: &invoke, can_write: true };
        workspace.handle("select", payload()).unwrap();
        let mut request = payload();
        request["parentId"] = json!(ROOT);
        let mut input = [LocalApiFile {
            field_name: "file".into(), name: "../Foto.bin".into(), mime_type: Some("invalid header".into()),
            data_base64: BASE64.encode([0u8, 17, 63, 255]),
        }];
        assert_eq!(workspace.import_file(&request, &input).unwrap_err().status, 400);
        input[0].name = "Foto.bin".into();
        request["rootId"] = json!("other");
        assert_eq!(workspace.import_file(&request, &input).unwrap_err().status, 409);
        assert_eq!(calls.get(), 0);
        request["rootId"] = json!(ROOT);
        assert_eq!(workspace.import_file(&request, &input).unwrap()["node"]["nodeId"], NODE);
        confirmed.set(false);
        assert_eq!(workspace.import_file(&request, &input).unwrap_err().status, 502);
    }

    #[test]
    fn tool_target_checks_the_active_revision_and_upload_confirms_only_the_scoped_image() {
        let temp = tempfile::tempdir().unwrap();
        let image = b"\x89PNG\r\n\x1a\nfixture";
        let path = format!("assets/neubiki-{}.png", super::super::sha256_hex(image));
        let uploaded = Cell::new(0);
        let wrong_path = Cell::new(false);
        let invoke = |account: &str, operation: &str, body: Value| {
            assert_eq!(account, "test");
            Ok(match operation {
                "drive.workspaceFolder" => folder(),
                "drive.workspaceStat" => {
                    assert_eq!(body, json!({"rootId":ROOT,"nodeId":NODE}));
                    file(NODE, "Document.md", BASE)
                }
                "drive.workspaceUploadImage" => {
                    assert_eq!(body["rootId"], ROOT);
                    assert_eq!(body["nodeId"], NODE);
                    assert_eq!(body["mediaType"], "image/png");
                    assert_eq!(body["contentBase64"], BASE64.encode(image));
                    assert!(body.get("relativePath").is_none());
                    uploaded.set(uploaded.get() + 1);
                    json!({"relativePath":if wrong_path.get(){"../other.png"}else{path.as_str()}})
                }
                "drive.workspaceAsset" => {
                    assert_eq!(body["relativePath"], path);
                    remote("volume~image", "fixture.png", "volume~image~uploaded", image)
                }
                _ => panic!("unexpected Proton operation"),
            })
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace.handle("select", payload()).unwrap();
        let mut request = payload();
        request["baseRevisionId"] = json!(BASE);
        workspace.validate_tool_target(&request).unwrap();
        request["baseRevisionId"] = json!(NEXT);
        assert_eq!(workspace.validate_tool_target(&request).unwrap_err().status, 409);
        request["contentBase64"] = json!(BASE64.encode(b"<svg/>"));
        assert_eq!(workspace.handle("upload-image", request.clone()).unwrap_err().status, 422);
        request["contentBase64"] = json!(BASE64.encode(image));
        request["rootId"] = json!("different~root");
        assert_eq!(workspace.handle("upload-image", request.clone()).unwrap_err().status, 409);
        assert_eq!(uploaded.get(), 0);
        request["rootId"] = json!(ROOT);
        request["relativePath"] = json!("../other.png");
        assert_eq!(workspace.handle("upload-image", request.clone()).unwrap()["relativePath"], path);
        wrong_path.set(true);
        assert_eq!(workspace.handle("upload-image", request).unwrap_err().status, 502);
        assert_eq!(uploaded.get(), 2);
    }

    #[test]
    fn proton_workspace_reads_revisions_and_images_without_mutation() {
        let temp = tempfile::tempdir().unwrap();
        let visited = RefCell::new(Vec::new());
        let invoke = |account: &str, operation: &str, body: Value| {
            assert_eq!(account, "test");
            visited.borrow_mut().push(operation.to_owned());
            Ok(match operation {
                "drive.root" | "drive.workspaceFolder" => folder(),
                "drive.workspaceList" => {
                    assert_eq!(body["parentId"], ROOT);
                    assert_eq!(body["rootId"], ROOT);
                    json!({"items":[file(NODE,"Document.md",BASE)],"complete":true})
                }
                "drive.events" => {
                    assert_eq!(body["rootId"], ROOT);
                    assert_eq!(body["cursor"], "cursor");
                    json!({"cursor":"next","changed":true,"requiresRefresh":false})
                }
                "drive.workspaceRead" => remote(NODE, "Document.md", BASE, b"# Markdown"),
                "drive.workspaceAsset" => {
                    assert_eq!(body["relativePath"], "assets/image.png");
                    remote(
                        "volume~image",
                        "image.png",
                        "volume~image~r1",
                        b"\x89PNG\r\n\x1a\n",
                    )
                }
                _ => panic!("unexpected write or provider request"),
            })
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        assert!(workspace.handle("current", Value::Null).unwrap().is_null());
        assert_eq!(
            workspace
                .handle("root", json!({"accountId":"test"}))
                .unwrap()["root"]["nodeId"],
            ROOT
        );
        let selected = workspace.handle("select", payload()).unwrap();
        assert_eq!(selected["root"]["nodeId"], ROOT);
        assert_eq!(selected["canWrite"], false);
        assert_eq!(workspace.handle("current", Value::Null).unwrap(), selected);

        let mut list = payload();
        list["parentId"] = json!(ROOT);
        assert_eq!(
            workspace.handle("list", list).unwrap()["items"][0]["nodeId"],
            NODE
        );
        let mut events = payload();
        events["cursor"] = json!("cursor");
        assert_eq!(
            workspace.handle("events", events).unwrap()["cursor"],
            "next"
        );
        let opened = workspace.handle("read", payload()).unwrap();
        assert_eq!(opened["markdown"], "# Markdown");
        assert_eq!(opened["revisionId"], BASE);
        assert!(opened["draft"].is_null());
        let mut image = payload();
        image["relativePath"] = json!("assets/image.png");
        let image = workspace.handle("asset", image).unwrap();
        assert_eq!(image["contentType"], "image/png");
        assert_eq!(image["revisionId"], "volume~image~r1");

        let mut wrong_account = payload();
        wrong_account["accountId"] = json!("other");
        assert_eq!(
            workspace.handle("read", wrong_account).unwrap_err().code,
            "proton-workspace-changed"
        );
        assert_eq!(
            workspace
                .handle("draft", draft("edit", None))
                .unwrap_err()
                .code,
            "proton-workspace-read-only"
        );
        assert_eq!(
            workspace.handle("save", save(1)).unwrap_err().code,
            "proton-workspace-read-only"
        );
        assert_eq!(visited.borrow().len(), 6);
        assert!(!workspace.drafts_dir().exists());
    }

    #[test]
    fn proton_workspace_ack_preserves_newer_generation() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("workspace");
        let calls = Cell::new(0);
        let unexpected =
            |_: &str, _: &str, _: Value| panic!("unexpected SDK call from local draft");
        let concurrent = Workspace {
            directory: directory.clone(),
            invoke: &unexpected,
            can_write: true,
        };
        let invoke = |_: &str, operation: &str, body: Value| match operation {
            "drive.workspaceFolder" => Ok(folder()),
            "drive.writeRevision" => {
                calls.set(calls.get() + 1);
                assert_eq!(body["baseRevisionId"], BASE);
                assert_eq!(body["contentBase64"], BASE64.encode("first edit"));
                let newer = concurrent
                    .handle("draft", draft("second edit", Some(1)))
                    .unwrap();
                assert_eq!(newer["generation"], 2);
                assert_eq!(newer["state"], "unknown");
                Ok(json!({"nodeId":NODE,"revisionId":NEXT}))
            }
            _ => panic!("unexpected SDK operation"),
        };
        let workspace = Workspace {
            directory,
            invoke: &invoke,
            can_write: true,
        };
        workspace.handle("select", payload()).unwrap();
        assert_eq!(
            workspace
                .handle("draft", draft("first edit", None))
                .unwrap()["generation"],
            1
        );
        let ack = workspace.handle("save", save(1)).unwrap();
        assert_eq!(ack["state"], "saved");
        assert_eq!(ack["revisionId"], NEXT);
        assert_eq!(ack["draft"]["generation"], 2);
        assert_eq!(ack["draft"]["markdown"], "second edit");
        assert_eq!(ack["draft"]["baseRevisionId"], NEXT);
        assert_eq!(workspace.handle("save", save(1)).unwrap(), ack);
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn proton_workspace_reconciles_ambiguous_save_by_observation_and_never_replays() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("workspace");
        let writes = Cell::new(0);
        let observed = Cell::new("another writer");
        let invoke = |_: &str, operation: &str, _: Value| match operation {
            "drive.workspaceFolder" => Ok(folder()),
            "drive.writeRevision" => {
                writes.set(writes.get() + 1);
                Err(ProviderError::new("network"))
            }
            "drive.workspaceRead" => {
                Ok(remote(NODE, "Document.md", NEXT, observed.get().as_bytes()))
            }
            _ => panic!("unexpected SDK operation"),
        };
        {
            let workspace = Workspace {
                directory: directory.clone(),
                invoke: &invoke,
                can_write: true,
            };
            workspace.handle("select", payload()).unwrap();
            workspace
                .handle("draft", draft("attempted edit", None))
                .unwrap();
            let unknown = workspace.handle("save", save(1)).unwrap();
            assert_eq!(unknown["state"], "unknown");
            assert_eq!(unknown["draft"]["markdown"], "attempted edit");
        }

        let reopened = Workspace {
            directory,
            invoke: &invoke,
            can_write: true,
        };
        let retained = reopened.handle("reconcile", payload()).unwrap();
        assert_eq!(retained["state"], "unknown");
        assert_eq!(retained["draft"]["markdown"], "attempted edit");
        assert_eq!(reopened.handle("save", save(1)).unwrap(), retained);
        assert_eq!(writes.get(), 1);

        observed.set("attempted edit");
        let confirmed = reopened.handle("reconcile", payload()).unwrap();
        assert_eq!(confirmed["state"], "observed");
        assert_eq!(confirmed["revisionId"], NEXT);
        assert!(confirmed["draft"].is_null());
        assert_eq!(reopened.handle("save", save(1)).unwrap(), confirmed);
        assert_eq!(writes.get(), 1);
    }

    #[test]
    fn proton_workspace_conflict_preserves_draft_until_generation_checked_discard() {
        let temp = tempfile::tempdir().unwrap();
        let writes = Cell::new(0);
        let invoke = |_: &str, operation: &str, _: Value| match operation {
            "drive.workspaceFolder" => Ok(folder()),
            "drive.writeRevision" => {
                writes.set(writes.get() + 1);
                Err(ProviderError::new("revision-conflict"))
            }
            _ => panic!("unexpected SDK operation"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace.handle("select", payload()).unwrap();
        workspace.handle("draft", draft("edits", None)).unwrap();
        let result = workspace.handle("save", save(1)).unwrap();
        assert_eq!(result["state"], "conflict");
        assert_eq!(result["draft"]["markdown"], "edits");
        assert_eq!(workspace.handle("save", save(1)).unwrap(), result);
        assert_eq!(writes.get(), 1);

        let mut discard = payload();
        discard["generation"] = json!(2);
        assert_eq!(
            workspace
                .handle("discard", discard.clone())
                .unwrap_err()
                .code,
            "draft-generation-changed"
        );
        discard["generation"] = json!(1);
        assert_eq!(
            workspace.handle("discard", discard).unwrap()["discarded"],
            true
        );
        let replacement = workspace.handle("draft", draft("new edits", None)).unwrap();
        assert_eq!(replacement["generation"], 2);
        assert_eq!(
            workspace.handle("save", save(1)).unwrap()["draft"]["markdown"],
            "new edits"
        );
        assert_eq!(writes.get(), 1);
    }
}
