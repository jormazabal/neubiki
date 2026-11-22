use super::*;
use std::collections::BTreeMap;
use std::io::Read;

const MAX_LIST_ITEMS: usize = 200;
const MAX_JOURNAL_ITEMS: usize = 64;
const MAX_JOURNAL_BYTES: u64 = 512 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashListing {
    items: Vec<TrashItem>,
    complete: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const ACCOUNT: &str = "account";
    const ROOT: &str = "volume~root";
    const NODE: &str = "volume~node";
    const TIMESTAMP: &str = "2026-11-17T12:34:56.0000000Z";

    fn scope() -> Value {
        json!({"accountId":ACCOUNT, "rootId":ROOT})
    }

    fn request() -> Value {
        json!({
            "accountId":ACCOUNT, "rootId":ROOT, "nodeId":NODE,
            "parentId":ROOT, "expectedName":"nota.md", "trashedAt":TIMESTAMP,
        })
    }

    fn folder() -> Value {
        json!({"nodeId":ROOT, "name":"Proyecto", "type":"folder"})
    }

    fn restored_node() -> Value {
        json!({"nodeId":NODE, "name":"nota.md", "type":"file", "revisionId":"volume~node~rev"})
    }

    #[test]
    fn proton_trash_persists_uncertain_restore_and_checks_without_replay() {
        let temp = tempfile::tempdir().unwrap();
        let calls = Cell::new(0);
        let observed = Cell::new(false);
        let invoke = |account: &str, operation: &str, payload: Value| {
            assert_eq!(account, ACCOUNT);
            assert_eq!(payload["rootId"], ROOT);
            match operation {
                "drive.workspaceFolder" => Ok(folder()),
                "drive.workspaceTrashRestore" => {
                    assert_eq!(payload["parentId"], ROOT);
                    assert_eq!(payload["trashedAt"], TIMESTAMP);
                    calls.set(calls.get() + 1);
                    Err(ProviderError { code: "network".into(), retryable: true })
                }
                "drive.workspaceTrashCheck" => Ok(json!({
                    "node": if observed.get() { restored_node() } else { Value::Null },
                })),
                "drive.workspaceTrashList" => Ok(json!({"items": [], "complete": true})),
                _ => panic!("Unexpected provider call: {operation}"),
            }
        };
        let workspace = || Workspace { directory: temp.path().join("workspace"), invoke: &invoke, can_write: true };
        workspace().handle("select", scope()).unwrap();
        assert_eq!(workspace().handle("trash-restore", request()).unwrap()["state"], "pending");
        assert_eq!(workspace().handle("trash-restore", request()).unwrap()["state"], "pending");
        assert_eq!(calls.get(), 1);
        assert_eq!(workspace().handle("trash-list", scope()).unwrap()["pending"][0]["nodeId"], NODE);
        observed.set(true);
        assert_eq!(workspace().handle("trash-check", request()).unwrap()["node"], restored_node());
        assert_eq!(workspace().handle("trash-list", scope()).unwrap()["pending"], json!([]));
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn proton_trash_checks_scope_and_retires_definite_preflight_failure() {
        let temp = tempfile::tempdir().unwrap();
        let calls = Cell::new(0);
        let invoke = |_: &str, operation: &str, _: Value| match operation {
            "drive.workspaceFolder" => Ok(folder()),
            "drive.workspaceTrashRestore" => {
                calls.set(calls.get() + 1);
                Err(ProviderError { code: "name-conflict".into(), retryable: false })
            }
            "drive.workspaceTrashList" => Ok(json!({"items": [], "complete": false})),
            _ => panic!("Unexpected provider call: {operation}"),
        };
        let workspace = Workspace { directory: temp.path().join("workspace"), invoke: &invoke, can_write: true };
        workspace.handle("select", scope()).unwrap();
        let mut wrong = request();
        wrong["rootId"] = json!("volume~other");
        assert_eq!(workspace.handle("trash-restore", wrong).unwrap_err().code, "proton-workspace-changed");
        assert_eq!(calls.get(), 0);
        assert_eq!(workspace.handle("trash-restore", request()).unwrap_err().code, "name-conflict");
        let listing = workspace.handle("trash-list", scope()).unwrap();
        assert_eq!(listing["complete"], false);
        assert_eq!(listing["pending"], json!([]));
        assert_eq!(calls.get(), 1);
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashItem {
    node: Node,
    parent_id: String,
    destination: Vec<String>,
    trashed_at: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TrashAttempt {
    node_id: String,
    parent_id: String,
    expected_name: String,
    trashed_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashJournal {
    schema_version: u8,
    account_id: String,
    root_id: String,
    attempts: BTreeMap<String, TrashAttempt>,
}

impl TrashAttempt {
    fn valid(&self, root: &str) -> bool {
        valid_token(&self.node_id) && self.node_id != root
            && valid_token(&self.parent_id) && self.parent_id != self.node_id
            && valid_display_name(&self.expected_name) && valid_trash_stamp(&self.trashed_at)
    }

    fn request(&self, root: &str) -> Value {
        json!({
            "rootId": root, "nodeId": self.node_id, "parentId": self.parent_id,
            "expectedName": self.expected_name, "trashedAt": self.trashed_at,
        })
    }
}

fn valid_display_name(value: &str) -> bool {
    !value.is_empty() && value.len() <= 1024 && !value.chars().any(char::is_control)
}

fn valid_trash_stamp(value: &str) -> bool {
    value.len() <= 40 && time::OffsetDateTime::parse(
        value, &time::format_description::well_known::Rfc3339,
    ).is_ok()
}

fn journal_error() -> Error {
    Error::local("No se pudo comprobar el registro privado de restauraciones. Se conserva para revisión.".into())
}

impl Workspace<'_> {
    pub(super) fn trash_action(&self, action: &str, body: &Value) -> Result<Value> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        let path = self.trash_journal_path(account, root);
        match action {
            "trash-list" => self.trash_list(account, root, &path),
            "trash-restore" => {
                self.require_write()?;
                let attempt: TrashAttempt = parse_input(body)?;
                if !attempt.valid(root) { return Err(Error::input()); }
                self.trash_restore(account, root, &path, attempt)
            }
            "trash-check" => self.trash_check(account, root, &path, token(body, "nodeId")?),
            _ => Err(Error::input()),
        }
    }

    fn trash_list(&self, account: &str, root: &str, path: &Path) -> Result<Value> {
        let mut listing: TrashListing = self.provider(account, "drive.workspaceTrashList", json!({"rootId":root}))?;
        let mut seen = BTreeSet::new();
        if listing.items.len() > MAX_LIST_ITEMS {
            return Err(Error::invalid_response());
        }
        for item in &listing.items {
            validate_node(&item.node)?;
            if item.node.node_id == root || !seen.insert(&item.node.node_id)
                || !valid_token(&item.parent_id) || item.parent_id == item.node.node_id
                || !valid_trash_stamp(&item.trashed_at)
                || item.destination.is_empty() || item.destination.len() > 128
                || !item.destination.iter().all(|name| valid_display_name(name))
            {
                return Err(Error::invalid_response());
            }
        }
        listing.items.sort_by(|left, right| right.trashed_at.cmp(&left.trashed_at)
            .then_with(|| left.node.name.cmp(&right.node.name)));

        let lock = gate()?;
        let journal = self.load_trash_journal(path, account, root)?;
        self.check_selection(account, root)?;
        drop(lock);
        Ok(json!({"items": listing.items, "complete": listing.complete,
            "pending": journal.attempts.values().collect::<Vec<_>>()}))
    }

    fn trash_restore(&self, account: &str, root: &str, path: &Path, attempt: TrashAttempt) -> Result<Value> {
        {
            let mut lock = gate()?;
            self.check_selection(account, root)?;
            let mut journal = self.load_trash_journal(path, account, root)?;
            if journal.attempts.contains_key(&attempt.node_id) {
                return Ok(json!({"state":"pending", "nodeId":attempt.node_id}));
            }
            if journal.attempts.len() == MAX_JOURNAL_ITEMS {
                return Err(Error::new(409, "proton-trash-pending-limit", "Comprueba las restauraciones pendientes antes de iniciar otra."));
            }
            if lock.contains(path) {
                return Err(Error::new(409, "proton-trash-busy", "Hay otra restauración en curso para esta carpeta."));
            }
            journal.attempts.insert(attempt.node_id.clone(), attempt.clone());
            self.write_trash_journal(path, &journal)?;
            lock.insert(path.to_path_buf());
        }
        let in_flight = InFlight(path.to_path_buf());
        let call: Result<Value> = self.provider(account, "drive.workspaceTrashRestore", attempt.request(root));
        if let Err(error) = &call {
            // The bridge emits these codes before contacting the restore API.
            if matches!(error.code.as_str(), "name-conflict" | "stale-node" | "outside-workspace") {
                self.retire_trash_attempt(path, account, root, &attempt)?;
                return call;
            }
        }
        drop(in_flight);
        // A protected check is a separate provider call so the SDK cache used
        // before restoration cannot be mistaken for the new remote state.
        self.trash_check(account, root, path, &attempt.node_id).or_else(|_| {
            Ok(json!({"state":"pending", "nodeId":attempt.node_id}))
        })
    }

    fn trash_check(&self, account: &str, root: &str, path: &Path, node_id: &str) -> Result<Value> {
        let attempt = {
            let lock = gate()?;
            self.check_selection(account, root)?;
            let journal = self.load_trash_journal(path, account, root)?;
            let attempt = journal.attempts.get(node_id).ok_or_else(|| {
                Error::new(404, "proton-trash-attempt-not-found", "No hay una restauración pendiente para este elemento. Actualiza la papelera.")
            })?;
            if lock.contains(path) {
                return Ok(json!({"state":"pending", "nodeId":node_id}));
            }
            attempt.clone()
        };
        let response: Value = self.provider(account, "drive.workspaceTrashCheck", attempt.request(root))?;
        let node: Option<Node> = parse_input(response.get("node").ok_or_else(Error::invalid_response)?)
            .map_err(|_| Error::invalid_response())?;
        let Some(node) = node else { return Ok(json!({"state":"pending", "nodeId":node_id})); };
        validate_node(&node)?;
        if node.node_id != attempt.node_id || node.name != attempt.expected_name {
            return Err(Error::invalid_response());
        }
        self.check_selection(account, root)?;
        self.retire_trash_attempt(path, account, root, &attempt)?;
        Ok(json!({"state":"restored", "node":node}))
    }

    fn retire_trash_attempt(&self, path: &Path, account: &str, root: &str, attempt: &TrashAttempt) -> Result<()> {
        let _lock = gate()?;
        let mut journal = self.load_trash_journal(path, account, root)?;
        if journal.attempts.get(&attempt.node_id) == Some(attempt) {
            journal.attempts.remove(&attempt.node_id);
            self.write_trash_journal(path, &journal)?;
        }
        Ok(())
    }

    fn trash_journal_path(&self, account: &str, root: &str) -> PathBuf {
        let key = super::super::sha256_hex(json!([account, root]).to_string().as_bytes());
        self.directory.join(format!("trash-{key}.json"))
    }

    fn load_trash_journal(&self, path: &Path, account: &str, root: &str) -> Result<TrashJournal> {
        let empty = || TrashJournal { schema_version: 1, account_id: account.into(),
            root_id: root.into(), attempts: BTreeMap::new() };
        if !check_regular_directory(&self.directory)? {
            return Ok(empty());
        }
        let metadata = match fs::symlink_metadata(path) {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(empty()),
            Err(_) => return Err(journal_error()),
        };
        if !metadata.is_file() || batch::linked(&metadata) || metadata.len() > MAX_JOURNAL_BYTES {
            return Err(journal_error());
        }
        let mut bytes = Vec::new();
        fs::File::open(path).map_err(|_| journal_error())?.take(MAX_JOURNAL_BYTES + 1)
            .read_to_end(&mut bytes).map_err(|_| journal_error())?;
        if bytes.len() as u64 > MAX_JOURNAL_BYTES { return Err(journal_error()); }
        let journal: TrashJournal = serde_json::from_slice(&bytes).map_err(|_| journal_error())?;
        if journal.schema_version != 1 || journal.root_id != root || journal.account_id != account
            || journal.attempts.len() > MAX_JOURNAL_ITEMS
            || !journal.attempts.iter().all(|(id, attempt)| id == &attempt.node_id && attempt.valid(root))
        {
            return Err(journal_error());
        }
        Ok(journal)
    }

    fn write_trash_journal(&self, path: &Path, journal: &TrashJournal) -> Result<()> {
        ensure_directory(&self.directory)?;
        let bytes = serde_json::to_vec(journal).map_err(|_| journal_error())?;
        if bytes.len() as u64 > MAX_JOURNAL_BYTES { return Err(journal_error()); }
        atomic_io::write(path, &bytes).map_err(|_| journal_error())
    }
}
