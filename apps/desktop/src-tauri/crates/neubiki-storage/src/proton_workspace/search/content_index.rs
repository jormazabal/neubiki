use super::*;
use sha2::{Digest, Sha256};
use std::io::Read;

const MAX_INDEX_BYTES: usize = 8 * 1024 * 1024;
const MAX_INDEX_DOCUMENTS: usize = 64;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ContentIndex {
    schema_version: u8,
    scope: String,
    entries: VecDeque<IndexedContent>,
    #[serde(skip)]
    dirty: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IndexedContent {
    node_id: String,
    revision_id: String,
    kind: String,
    parts: Vec<TextPart>,
    #[serde(skip)]
    bytes: usize,
}

fn index_error() -> Error {
    Error::new(
        409,
        "proton-content-index-unavailable",
        "No se pudo comprobar el índice local. Puedes vaciarlo y volver a buscar en Proton.",
    )
}

impl ContentIndex {
    fn empty(scope: String) -> Self {
        Self { schema_version: 1, scope, entries: VecDeque::new(), dirty: true }
    }

    fn validate(&mut self, scope: &str) -> Result<()> {
        if self.schema_version != 1 || self.scope != scope || self.entries.len() > MAX_INDEX_DOCUMENTS {
            return Err(index_error());
        }
        let mut nodes = BTreeSet::new();
        for entry in &mut self.entries {
            if !valid_token(&entry.node_id) || !valid_revision(&entry.node_id, &entry.revision_id)
                || !nodes.insert(&entry.node_id)
                || !matches!(entry.kind.as_str(), "markdown" | "handwritten" | "pdf" | "docx" | "xlsx" | "text")
                || entry.parts.len() > 10_000
                || entry.parts.iter().map(|part| part.text.len()).sum::<usize>() > extracted_text_limit(&entry.kind)
            {
                return Err(index_error());
            }
            entry.bytes = serde_json::to_vec(entry).map_err(|_| index_error())?.len();
        }
        Ok(())
    }

    pub(super) fn find(&self, node: &Node, kind: &str) -> Option<Arc<Vec<TextPart>>> {
        let revision = node.revision_id.as_deref()?;
        self.entries.iter().find(|entry|
            entry.node_id == node.node_id && entry.revision_id == revision && entry.kind == kind
        ).map(|entry| Arc::new(entry.parts.clone()))
    }

    pub(super) fn remember(&mut self, node: &Node, kind: &str, parts: &[TextPart]) {
        let Some(revision_id) = node.revision_id.as_ref() else { return; };
        if parts.len() > 10_000 || self.entries.iter().any(|entry|
            entry.node_id == node.node_id && &entry.revision_id == revision_id && entry.kind == kind
        ) {
            return;
        }
        let mut entry = IndexedContent {
            node_id: node.node_id.clone(), revision_id: revision_id.clone(),
            kind: kind.into(), parts: parts.to_vec(), bytes: 0,
        };
        const MAX_ENTRY_BYTES: usize = MAX_INDEX_BYTES - 2048;
        let Ok(bytes) = serde_json::to_vec(&entry) else { return; };
        entry.bytes = bytes.len();
        if entry.bytes > MAX_ENTRY_BYTES {
            return;
        }
        self.entries.retain(|previous| previous.node_id != node.node_id);
        let mut total = self.stored_bytes() + entry.bytes;
        while self.entries.len() >= MAX_INDEX_DOCUMENTS || total > MAX_ENTRY_BYTES {
            let Some(previous) = self.entries.pop_back() else { break; };
            total -= previous.bytes;
        }
        self.entries.push_front(entry);
        self.dirty = true;
    }

    fn stored_bytes(&self) -> usize {
        self.entries.iter().map(|entry| entry.bytes).sum()
    }
}

impl Workspace<'_> {
    fn content_index_path(&self, account: &str, root: &str) -> (String, PathBuf) {
        let scope = format!("{:x}", Sha256::digest(json!([account, root]).to_string().as_bytes()));
        let path = self.directory.join("content-index").join(format!("{scope}.json"));
        (scope, path)
    }

    fn content_index_file_exists(&self, path: &Path) -> Result<bool> {
        let directory = path.parent().ok_or_else(private_location)?;
        if !check_regular_directory(&self.directory)? || !check_regular_directory(directory)? {
            return Ok(false);
        }
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_file() && !batch::linked(&metadata) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            _ => Err(private_location()),
        }
    }

    pub(super) fn read_content_index(&self, account: &str, root: &str) -> Result<Option<ContentIndex>> {
        let (scope, path) = self.content_index_path(account, root);
        if !self.content_index_file_exists(&path)? {
            return Ok(None);
        }
        let metadata = fs::metadata(&path).map_err(|_| index_error())?;
        if metadata.len() > MAX_INDEX_BYTES as u64 {
            return Err(index_error());
        }
        let mut content = Vec::new();
        fs::File::open(&path).map_err(|_| index_error())?
            .take(MAX_INDEX_BYTES as u64 + 1)
            .read_to_end(&mut content).map_err(|_| index_error())?;
        if content.len() > MAX_INDEX_BYTES {
            return Err(index_error());
        }
        let mut index: ContentIndex = serde_json::from_slice(&content).map_err(|_| index_error())?;
        index.validate(&scope)?;
        Ok(Some(index))
    }

    pub(super) fn save_content_index(&self, account: &str, root: &str, index: &ContentIndex) -> Result<()> {
        if !index.dirty {
            return Ok(());
        }
        self.check_selection(account, root)?;
        let (scope, path) = self.content_index_path(account, root);
        if scope != index.scope {
            return Err(index_error());
        }
        ensure_directory(&self.directory)?;
        ensure_directory(path.parent().ok_or_else(private_location)?)?;
        let bytes = serde_json::to_vec(index).map_err(|_| index_error())?;
        if bytes.len() > MAX_INDEX_BYTES {
            return Err(index_error());
        }
        atomic_io::write(&path, &bytes).map_err(|_| private_location())
    }

    pub(in super::super) fn content_index_action(&self, action: &str, body: &Value) -> Result<Value> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        let _guard = SEARCH_GATE.try_lock().map_err(|_| Error::new(
            409, "proton-search-busy", "Espera a que termine la búsqueda antes de modificar el índice.",
        ))?;
        let (scope, path) = self.content_index_path(account, root);
        let exists = self.content_index_file_exists(&path)?;
        let index = match action {
            "content-index-status" => self.read_content_index(account, root)?,
            "content-index-configure" if body["enabled"] == false => {
                if exists {
                    fs::remove_file(&path).map_err(|_| private_location())?;
                }
                None
            }
            "content-index-configure" if body["enabled"] == true && exists => {
                self.read_content_index(account, root)?
            }
            "content-index-configure" if body["enabled"] == true => {
                let index = ContentIndex::empty(scope);
                self.save_content_index(account, root, &index)?;
                Some(index)
            }
            "content-index-clear" if exists => {
                let index = ContentIndex::empty(scope);
                self.save_content_index(account, root, &index)?;
                Some(index)
            }
            "content-index-clear" => None,
            _ => return Err(Error::input()),
        };
        let stats = index.as_ref().map(|index| (index.entries.len(), index.stored_bytes()));
        Ok(json!({"enabled":index.is_some(),"documentCount":stats.map_or(0, |values| values.0),
            "byteLength":stats.map_or(0, |values| values.1)}))
    }
}
