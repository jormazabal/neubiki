use super::*;
use std::io::Read;
use std::time::{Duration, Instant};

static FAVORITES_GATE: Mutex<()> = Mutex::new(());
const MAX_FAVORITES: usize = 200;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FavoritesSnapshot {
    node_id: Option<String>,
    revision_id: Option<String>,
    items: Vec<String>,
    operation_id: Option<String>,
    updated_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn proton_favorite_items_read_only_a_bounded_verified_snapshot_page() {
        let temp = tempfile::tempdir().unwrap();
        let calls = Cell::new(0);
        let invoke = |_: &str, command: &str, body: Value| match command {
            "drive.workspaceFolder" => {
                Ok(json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"}))
            }
            "drive.workspaceFavoritesRead" => Ok(
                json!({"nodeId":"vol~metadata","revisionId":"vol~metadata~rev","operationId":"initial","updatedAt":"2026-11-17T12:00:00Z",
                "items":(0..25).map(|index| format!("vol~file{index}")).collect::<Vec<_>>()}),
            ),
            "drive.workspaceFileStat" => {
                calls.set(calls.get() + 1);
                let id = body["nodeId"].as_str().unwrap();
                assert_eq!(body["rootId"], "vol~root");
                if id == "vol~file3" {
                    return Err(ProviderError::new("not-found"));
                }
                if id == "vol~file4" {
                    return Err(ProviderError::new("outside-workspace"));
                }
                Ok(
                    json!({"nodeId":id,"name":"Archivo.txt","type":"file","revisionId":format!("{id}~rev"),"ancestorIds":["vol~root"]}),
                )
            }
            _ => panic!("Unexpected content read or mutation {command}"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        workspace
            .handle("select", json!({"accountId":"account","rootId":"vol~root"}))
            .unwrap();
        let request =
            json!({"accountId":"account","rootId":"vol~root","offset":0,"nodeId":"unrequested"});
        let result = workspace.favorite_items(&request).unwrap();
        assert_eq!(calls.get(), 20);
        assert_eq!(result["items"].as_array().unwrap().len(), 20);
        assert_eq!(result["total"], 25);
        assert_eq!(result["nextOffset"], 20);
        assert_eq!(result["missing"], 1);
        assert_eq!(result["unavailable"], 1);
        assert_eq!(result["partial"], true);
    }

    #[test]
    fn proton_favorites_use_conditional_metadata_and_never_replay_an_unknown_write() {
        let temp = tempfile::tempdir().unwrap();
        let remote = RefCell::new(
            json!({"nodeId":null,"revisionId":null,"items":[],"operationId":null,"updatedAt":null}),
        );
        let writes = Cell::new(0);
        let lose_reply = Cell::new(false);
        let reject_target = Cell::new(false);
        let invoke = |_: &str, command: &str, body: Value| match command {
            "drive.workspaceFolder" => {
                Ok(json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"}))
            }
            "drive.workspaceFavoritesRead" => Ok(remote.borrow().clone()),
            "drive.workspaceFavoritesWrite" => {
                if reject_target.get() {
                    return Err(ProviderError::new("favorites-target-unavailable"));
                }
                writes.set(writes.get() + 1);
                assert_eq!(body["baseRevisionId"], remote.borrow()["revisionId"]);
                let bytes = BASE64
                    .decode(body["contentBase64"].as_str().unwrap())
                    .unwrap();
                let metadata: Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(metadata["owner"], "neubiki");
                assert_eq!(metadata["rootId"], "vol~root");
                *remote.borrow_mut() = json!({"nodeId":"vol~metadata","revisionId":format!("vol~metadata~rev{}", writes.get()),
                    "items":metadata["items"],"operationId":metadata["operationId"],"updatedAt":metadata["updatedAt"]});
                if lose_reply.get() {
                    Err(ProviderError::new("network-error"))
                } else {
                    Ok(remote.borrow().clone())
                }
            }
            _ => panic!("Unexpected project content operation {command}"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace
            .handle("select", json!({"accountId":"account","rootId":"vol~root"}))
            .unwrap();
        let scope = json!({"accountId":"account","rootId":"vol~root"});
        let mut update = scope.clone();
        update["metadataNodeId"] = Value::Null;
        update["baseRevisionId"] = Value::Null;
        update["items"] = json!(["vol~file"]);
        reject_target.set(true);
        assert_eq!(
            workspace.favorites_update(&update).unwrap_err().code,
            "favorites-target-unavailable"
        );
        assert!(workspace
            .favorites_attempt("account", "vol~root")
            .unwrap()
            .is_none());
        reject_target.set(false);
        let first = workspace.favorites_update(&update).unwrap();
        assert_eq!(first["outcome"], "confirmed");
        assert_eq!(writes.get(), 1);
        assert_eq!(
            workspace.favorites_update(&update).unwrap_err().code,
            "favorites-stale"
        );
        assert_eq!(writes.get(), 1);
        update["metadataNodeId"] = first["nodeId"].clone();
        update["baseRevisionId"] = first["revisionId"].clone();
        update["items"] = json!([]);
        lose_reply.set(true);
        let uncertain = workspace.favorites_update(&update).unwrap();
        assert_eq!(uncertain["outcome"], "unknown");
        assert_eq!(writes.get(), 2);
        assert_eq!(
            workspace.favorites_update(&update).unwrap_err().code,
            "favorites-pending"
        );
        assert_eq!(writes.get(), 2);
        let checked = workspace.favorites_check(&scope).unwrap();
        assert_eq!(checked["outcome"], "confirmed");
        assert_eq!(checked["items"], json!([]));
        assert_eq!(writes.get(), 2);
        let readonly = Workspace {
            directory: workspace.directory.clone(),
            invoke: &invoke,
            can_write: false,
        };
        assert_eq!(readonly.favorites_update(&update).unwrap_err().status, 403);
    }

    #[test]
    fn proton_favorites_close_only_the_reviewed_snapshot_and_recover_receipt_after_restart() {
        let temporary = tempfile::tempdir().unwrap();
        let writes = Cell::new(0);
        let remote_revision = Cell::new("vol~metadata~first");
        let invoke = |_: &str, command: &str, _: Value| match command {
            "drive.workspaceFolder" => Ok(json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"})),
            "drive.workspaceFavoritesRead" => Ok(json!({
                "nodeId":"vol~metadata","revisionId":remote_revision.get(),"items":["vol~other"],
                "operationId":"another-device","updatedAt":"2026-11-17T12:00:00Z"
            })),
            "drive.workspaceFavoritesWrite" => {
                writes.set(writes.get() + 1);
                Err(ProviderError::new("network-error"))
            }
            other => panic!("Unexpected provider operation {other}"),
        };
        let workspace = Workspace {directory:temporary.path().join("workspace"),invoke:&invoke,can_write:true};
        let scope = json!({"accountId":"account","rootId":"vol~root"});
        workspace.handle("select", scope.clone()).unwrap();
        let result = workspace.favorites_update(&json!({
            "accountId":"account","rootId":"vol~root","metadataNodeId":"vol~metadata",
            "baseRevisionId":"vol~metadata~first","items":["vol~other","vol~file"]
        })).unwrap();
        assert!(result.get("canReviewPending").is_none());
        let pending = workspace.favorites_check(&scope).unwrap();
        assert_eq!(pending["canReviewPending"], true);
        let attempt = workspace.favorites_attempt_path("account", "vol~root");
        let interrupted = fs::read(&attempt).unwrap();
        let mut review = scope.clone();
        review["closePending"] = json!({"acknowledged":true,"operationId":pending["pendingOperationId"],
            "metadataNodeId":pending["nodeId"],"revisionId":pending["revisionId"]});
        remote_revision.set("vol~metadata~second");
        assert_eq!(workspace.favorites_check(&review).unwrap_err().code, "favorites-review-changed");
        assert!(attempt.exists());
        review["closePending"]["revisionId"] = json!(remote_revision.get());
        let closure = workspace.favorites_check(&review).unwrap();
        assert_eq!(closure["items"], json!(["vol~other"]));
        assert!(closure["pendingOperationId"].is_null());
        assert!(closure["closedWithoutConfirmation"].is_string());
        assert!(!attempt.exists());

        // A crash between persisting the receipt and unlinking the attempt keeps the acknowledgement.
        fs::write(&attempt, interrupted).unwrap();
        let reopened = Workspace {directory:workspace.directory.clone(),invoke:&invoke,can_write:false};
        let recovered = reopened.favorites_check(&scope).unwrap();
        assert_eq!(recovered["closedWithoutConfirmation"], closure["closedWithoutConfirmation"]);
        assert_eq!(recovered["operationId"], "another-device");
        assert!(!attempt.exists());
        assert_eq!(writes.get(), 1);
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FavoritesAttempt {
    schema_version: u8,
    account_id: String,
    root_id: String,
    operation_id: String,
    items: Vec<String>,
    created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FavoritesClosure {
    schema_version: u8,
    account_id: String,
    root_id: String,
    operation_id: String,
    node_id: Option<String>,
    revision_id: Option<String>,
    closed_at: String,
}

fn valid_items(items: &[String], root: &str) -> bool {
    items.len() <= MAX_FAVORITES
        && items
            .iter()
            .all(|id| valid_token(id) && id.len() <= 512 && id != root)
        && items.iter().collect::<BTreeSet<_>>().len() == items.len()
}

fn favorites_attempt_observed(snapshot: &FavoritesSnapshot, attempt: &FavoritesAttempt) -> bool {
    snapshot.operation_id.as_deref() == Some(attempt.operation_id.as_str()) && snapshot.items == attempt.items
}

fn favorites_review_changed() -> Error {
    Error::new(409, "favorites-review-changed", "La revisión de favoritos cambió. Vuelve a comprobar el estado en Proton.")
}

impl Workspace<'_> {
    fn favorites_identity<'a>(&self, body: &'a Value) -> Result<(&'a str, &'a str)> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        Ok((account, root))
    }

    fn favorites_remote(&self, account: &str, root: &str) -> Result<FavoritesSnapshot> {
        let snapshot: FavoritesSnapshot = self.provider(
            account,
            "drive.workspaceFavoritesRead",
            json!({"rootId":root}),
        ).map_err(|error| match error.code.as_str() {
            "favorites-name-conflict" => Error::new(409, "favorites-name-conflict", "El nombre reservado de favoritos está ocupado por otro elemento. No se modificó su contenido."),
            "favorites-invalid-metadata" => Error::new(422, "favorites-invalid-metadata", "El archivo interno de favoritos no tiene un formato de Neubiki válido. No se sobrescribirá."),
            _ => error,
        })?;
        self.validate_favorites(&snapshot, root)?;
        Ok(snapshot)
    }

    fn validate_favorites(&self, snapshot: &FavoritesSnapshot, root: &str) -> Result<()> {
        let present = match (&snapshot.node_id, &snapshot.revision_id) {
            (Some(node), Some(revision)) => {
                valid_token(node)
                    && valid_revision(node, revision)
                    && snapshot
                        .operation_id
                        .as_ref()
                        .is_some_and(|id| valid_token(id) && id.len() <= 100)
                    && snapshot
                        .updated_at
                        .as_ref()
                        .is_some_and(|time| !time.is_empty() && time.len() <= 100)
            }
            (None, None) => {
                snapshot.operation_id.is_none()
                    && snapshot.updated_at.is_none()
                    && snapshot.items.is_empty()
            }
            _ => false,
        };
        if !present || !valid_items(&snapshot.items, root) {
            return Err(Error::invalid_response());
        }
        Ok(())
    }

    fn favorites_attempt_path(&self, account: &str, root: &str) -> PathBuf {
        let identity = json!([account, root]).to_string();
        self.directory.join("favorite-attempts").join(format!(
            "{}.json",
            super::super::sha256_hex(identity.as_bytes())
        ))
    }

    fn favorites_closure_path(&self, account: &str, root: &str) -> PathBuf {
        self.favorites_attempt_path(account, root).with_extension("closed.json")
    }

    fn read_favorites_record<T: DeserializeOwned>(&self, path: &Path) -> Result<Option<T>> {
        let folder = self.directory.join("favorite-attempts");
        if !check_regular_directory(&self.directory)? || !check_regular_directory(&folder)? {
            return Ok(None);
        }
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(private_location()),
        };
        if !metadata.is_file() || batch::linked(&metadata) || metadata.len() > 64 * 1024 {
            return Err(private_location());
        }
        let mut data = Vec::new();
        fs::File::open(path)
            .map_err(|_| private_location())?
            .take(64 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(|_| private_location())?;
        if data.len() > 64 * 1024 {
            return Err(private_location());
        }
        serde_json::from_slice(&data).map(Some).map_err(|_| private_location())
    }

    fn favorites_closure(&self, account: &str, root: &str) -> Result<Option<FavoritesClosure>> {
        let closure: Option<FavoritesClosure> = self.read_favorites_record(&self.favorites_closure_path(account, root))?;
        if let Some(closure) = closure.as_ref() {
            let identity_valid = match (&closure.node_id, &closure.revision_id) {
                (Some(node), Some(revision)) => valid_token(node) && valid_revision(node, revision),
                (None, None) => true,
                _ => false,
            };
            if closure.schema_version != 1 || closure.account_id != account || closure.root_id != root
                || !valid_token(&closure.operation_id) || closure.operation_id.len() > 100
                || !identity_valid || closure.closed_at.is_empty() || closure.closed_at.len() > 100
            {
                return Err(private_location());
            }
        }
        Ok(closure)
    }

    fn favorites_attempt(&self, account: &str, root: &str) -> Result<Option<FavoritesAttempt>> {
        let path = self.favorites_attempt_path(account, root);
        let Some(attempt): Option<FavoritesAttempt> = self.read_favorites_record(&path)? else {
            return Ok(None);
        };
        if attempt.schema_version != 1
            || attempt.account_id != account
            || attempt.root_id != root
            || !valid_token(&attempt.operation_id)
            || attempt.operation_id.len() > 100
            || !valid_items(&attempt.items, root)
        {
            return Err(private_location());
        }
        if self.favorites_closure(account, root)?.is_some_and(|closure| closure.operation_id == attempt.operation_id) {
            // The acknowledged state was durable before retiring the pending file.
            fs::remove_file(&path).map_err(|_| private_location())?;
            return Ok(None);
        }
        Ok(Some(attempt))
    }

    fn favorites_response(
        &self,
        snapshot: FavoritesSnapshot,
        attempt: Option<&FavoritesAttempt>,
    ) -> Result<Value> {
        let mut output = serde_json::to_value(&snapshot).map_err(|_| Error::invalid_response())?;
        let outcome = if let Some(attempt) = attempt {
            if favorites_attempt_observed(&snapshot, attempt) {
                fs::remove_file(self.favorites_attempt_path(&attempt.account_id, &attempt.root_id))
                    .map_err(|_| private_location())?;
                "confirmed"
            } else {
                "unknown"
            }
        } else {
            "confirmed"
        };
        output["outcome"] = json!(outcome);
        output["pendingOperationId"] = if outcome == "unknown" {
            json!(attempt.map(|attempt| &attempt.operation_id))
        } else {
            Value::Null
        };
        output["checkedAt"] = json!(neubiki_core::now_iso());
        Ok(output)
    }

    fn favorites_read(&self, body: &Value, allow_closure: bool) -> Result<Value> {
        let _gate = FAVORITES_GATE.try_lock().map_err(|_| {
            Error::new(
                409,
                "favorites-busy",
                "Todavía se está comprobando un cambio de favoritos.",
            )
        })?;
        let (account, root) = self.favorites_identity(body)?;
        let attempt = self.favorites_attempt(account, root)?;
        let snapshot = self.favorites_remote(account, root)?;
        self.check_selection(account, root)?;
        let close = body.get("closePending");
        if close.is_some() && !allow_closure {
            return Err(Error::input());
        }
        if let Some(review) = close {
            let attempt = attempt.as_ref().ok_or_else(favorites_review_changed)?;
            if review["acknowledged"] != true || review["operationId"] != attempt.operation_id
                || review.get("metadataNodeId").is_none() || review["metadataNodeId"] != json!(snapshot.node_id)
                || review.get("revisionId").is_none() || review["revisionId"] != json!(snapshot.revision_id)
            {
                return Err(favorites_review_changed());
            }
            if favorites_attempt_observed(&snapshot, attempt) {
                return self.favorites_response(snapshot, Some(attempt));
            }
            let closure = FavoritesClosure {
                schema_version: 1,
                account_id: account.into(),
                root_id: root.into(),
                operation_id: attempt.operation_id.clone(),
                node_id: snapshot.node_id.clone(),
                revision_id: snapshot.revision_id.clone(),
                closed_at: neubiki_core::now_iso(),
            };
            let receipt = serde_json::to_vec(&closure).map_err(|_| private_location())?;
            atomic_io::write(&self.favorites_closure_path(account, root), &receipt)
                .map_err(|_| private_location())?;
            fs::remove_file(self.favorites_attempt_path(account, root)).map_err(|_| private_location())?;
            let mut output = self.favorites_response(snapshot, None)?;
            output["closedWithoutConfirmation"] = json!(closure.closed_at);
            return Ok(output);
        }
        let disposition = self.favorites_closure(account, root)?.filter(|closure|
            closure.node_id == snapshot.node_id && closure.revision_id == snapshot.revision_id
        );
        let mut output = self.favorites_response(snapshot, attempt.as_ref())?;
        if output["outcome"] == "unknown" {
            output["canReviewPending"] = json!(true);
        } else if let Some(disposition) = disposition {
            output["closedWithoutConfirmation"] = json!(disposition.closed_at);
        }
        Ok(output)
    }

    pub(super) fn favorites(&self, body: &Value) -> Result<Value> {
        self.favorites_read(body, false)
    }

    pub(super) fn favorites_check(&self, body: &Value) -> Result<Value> {
        self.favorites_read(body, true)
    }

    pub(super) fn favorite_items(&self, body: &Value) -> Result<Value> {
        let _gate = FAVORITES_GATE.try_lock().map_err(|_| {
            Error::new(
                409,
                "favorites-busy",
                "Todavía se está comprobando un cambio de favoritos.",
            )
        })?;
        let (account, root) = self.favorites_identity(body)?;
        let offset = if body["offset"].is_null() {
            0
        } else {
            body["offset"]
                .as_u64()
                .filter(|offset| *offset <= MAX_FAVORITES as u64)
                .ok_or_else(Error::input)? as usize
        };
        let snapshot = self.favorites_remote(account, root)?;
        let started = Instant::now();
        let mut items = Vec::new();
        let mut missing = 0;
        let mut unavailable = 0;
        for id in snapshot.items.iter().skip(offset).take(20) {
            let node = (|| -> Result<Node> {
                if started.elapsed() >= Duration::from_secs(20) {
                    return Err(Error::invalid_response());
                }
                self.check_selection(account, root)?;
                let value: Value = self.provider(
                    account,
                    "drive.workspaceFileStat",
                    json!({"rootId":root,"nodeId":id}),
                )?;
                let node: Node =
                    serde_json::from_value(value.clone()).map_err(|_| Error::invalid_response())?;
                validate_node(&node)?;
                let ancestors: Vec<String> = serde_json::from_value(value["ancestorIds"].clone())
                    .map_err(|_| Error::invalid_response())?;
                if node.node_id != *id
                    || node.kind != NodeKind::File
                    || node.name.eq_ignore_ascii_case(".neubiki-favorites.json")
                    || ancestors.is_empty()
                    || ancestors.len() > 128
                    || ancestors.first().map(String::as_str) != Some(root)
                    || ancestors
                        .iter()
                        .any(|ancestor| !valid_token(ancestor) || ancestor == id)
                    || ancestors.iter().collect::<BTreeSet<_>>().len() != ancestors.len()
                {
                    return Err(Error::invalid_response());
                }
                Ok(node)
            })();
            match node {
                Ok(node) => items.push(json!({"nodeId":id,"node":node,"status":"available"})),
                Err(error) if error.code == "not-found" => {
                    missing += 1;
                    items.push(json!({"nodeId":id,"node":null,"status":"missing"}));
                }
                Err(_) => {
                    unavailable += 1;
                    items.push(json!({"nodeId":id,"node":null,"status":"unavailable"}));
                }
            }
        }
        let current = self.favorites_remote(account, root)?;
        if current.node_id != snapshot.node_id
            || current.revision_id != snapshot.revision_id
            || current.items != snapshot.items
        {
            return Err(Error::new(
                409,
                "favorites-stale",
                "Los favoritos cambiaron durante la consulta. Actualiza la lista.",
            ));
        }
        self.check_selection(account, root)?;
        let next = offset + items.len();
        Ok(
            json!({"items":items,"total":snapshot.items.len(),"offset":offset,
            "nextOffset":if next < snapshot.items.len() { Some(next) } else { None },
            "missing":missing,"unavailable":unavailable,"partial":unavailable > 0,"revisionId":snapshot.revision_id,"checkedAt":neubiki_core::now_iso()}),
        )
    }

    pub(super) fn favorites_update(&self, body: &Value) -> Result<Value> {
        self.require_write()?;
        let _gate = FAVORITES_GATE.try_lock().map_err(|_| {
            Error::new(
                409,
                "favorites-busy",
                "Todavía se está comprobando un cambio de favoritos.",
            )
        })?;
        let (account, root) = self.favorites_identity(body)?;
        if self.favorites_attempt(account, root)?.is_some() {
            return Err(Error::new(
                409,
                "favorites-pending",
                "Hay un cambio de favoritos sin confirmar. Comprueba su estado antes de continuar.",
            ));
        }
        let items: Vec<String> =
            serde_json::from_value(body["items"].clone()).map_err(|_| Error::input())?;
        if !valid_items(&items, root) {
            return Err(Error::input());
        }
        let snapshot = self.favorites_remote(account, root)?;
        if body.get("metadataNodeId").is_none()
            || body.get("baseRevisionId").is_none()
            || body["metadataNodeId"] != json!(snapshot.node_id)
            || body["baseRevisionId"] != json!(snapshot.revision_id)
        {
            return Err(Error::new(
                409,
                "favorites-stale",
                "Los favoritos cambiaron en Proton. Actualiza la lista antes de continuar.",
            ));
        }
        if items == snapshot.items {
            return self.favorites_response(snapshot, None);
        }
        let attempt = FavoritesAttempt {
            schema_version: 1,
            account_id: account.into(),
            root_id: root.into(),
            operation_id: neubiki_core::compact_id("favorite"),
            items,
            created_at: neubiki_core::now_iso(),
        };
        let content = json!({"schemaVersion":1,"owner":"neubiki","kind":"favorites","rootId":root,
            "operationId":attempt.operation_id,"updatedAt":attempt.created_at,"items":attempt.items});
        let bytes = serde_json::to_vec(&content).map_err(|_| Error::input())?;
        if bytes.len() > 64 * 1024 {
            return Err(Error::input());
        }
        ensure_directory(&self.directory)?;
        ensure_directory(&self.directory.join("favorite-attempts"))?;
        let receipt = serde_json::to_vec(&attempt).map_err(|_| private_location())?;
        if receipt.len() > 64 * 1024 {
            return Err(Error::input());
        }
        let path = self.favorites_attempt_path(account, root);
        atomic_io::create(&path, &receipt).map_err(|_| private_location())?;
        let result: Result<FavoritesSnapshot> = self.provider(account, "drive.workspaceFavoritesWrite", json!({"rootId":root,
            "metadataNodeId":snapshot.node_id,"baseRevisionId":snapshot.revision_id,"contentBase64":BASE64.encode(bytes)}));
        match result {
            Ok(result) => {
                self.validate_favorites(&result, root)?;
                self.check_selection(account, root)?;
                self.favorites_response(result, Some(&attempt))
            }
            Err(error)
                if matches!(
                    error.code.as_str(),
                    "revision-conflict" | "outside-workspace" | "favorites-target-unavailable"
                ) =>
            {
                fs::remove_file(path).map_err(|_| private_location())?;
                Err(error)
            }
            Err(_) => {
                let mut output =
                    serde_json::to_value(snapshot).map_err(|_| Error::invalid_response())?;
                output["outcome"] = json!("unknown");
                output["pendingOperationId"] = json!(attempt.operation_id);
                output["checkedAt"] = json!(neubiki_core::now_iso());
                Ok(output)
            }
        }
    }
}
