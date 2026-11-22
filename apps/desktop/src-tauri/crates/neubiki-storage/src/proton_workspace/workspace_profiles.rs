use super::super::export_profiles::Profile;
use super::*;
use std::io::Read;

const LIMIT: usize = 1024 * 1024;
static PROFILES_GATE: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    node_id: Option<String>,
    revision_id: Option<String>,
    profiles: Vec<Profile>,
    operation_id: Option<String>,
    updated_at: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    schema_version: u8,
    account_id: String,
    root_id: String,
    operation_id: String,
    profile_hash: String,
}

fn invalid_profile() -> Error {
    Error::new(422, "profiles-not-portable", "El perfil contiene campos, rutas o valores no compatibles con los perfiles compartidos. Revisa la plantilla y vuelve a guardar el perfil.")
}

fn portable_style(value: &Value, prototype: &Value, key: &str) -> Result<Value> {
    match (value, prototype) {
        (Value::Object(values), Value::Object(fields)) => {
            if values.keys().any(|key| !fields.contains_key(key))
                || fields.keys().any(|key| !values.contains_key(key))
            {
                return Err(invalid_profile());
            }
            let mut output = serde_json::Map::new();
            for (key, field) in fields {
                output.insert(key.clone(), portable_style(&values[key], field, key)?);
            }
            Ok(Value::Object(output))
        }
        (Value::Bool(_), Value::Bool(_)) => Ok(value.clone()),
        (Value::Number(number), Value::Number(_)) => {
            if number
                .as_f64()
                .is_some_and(|number| number.is_finite() && (0.0..=500.0).contains(&number))
            {
                Ok(value.clone())
            } else {
                Err(invalid_profile())
            }
        }
        (Value::String(text), Value::String(_)) => {
            let valid = match key {
                "name" => text == "shared",
                "size" => matches!(text.as_str(), "A4" | "A5" | "Letter" | "Legal"),
                "textFormat" => matches!(
                    text.as_str(),
                    "normal" | "bold" | "underline" | "bold_underline"
                ),
                "diagramResolution" => matches!(text.as_str(), "low" | "medium" | "high"),
                "fontFamily" | "headingFontFamily" => {
                    !text.is_empty()
                        && text.len() <= 80
                        && text
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || b" -_,".contains(&byte))
                }
                "color" | "linkColor" | "horizontalRuleColor" => {
                    text.len() == 7
                        && text.starts_with('#')
                        && text[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
                }
                _ => false,
            };
            if valid {
                Ok(value.clone())
            } else {
                Err(invalid_profile())
            }
        }
        _ => Err(invalid_profile()),
    }
}

fn portable_profile(profile: &Profile) -> Result<Profile> {
    if !super::super::request_scope::portable_id(&profile.id)
        || !profile.id.starts_with("export-profile-")
        || profile.id.len() > 100
        || profile.name.trim().is_empty()
        || profile.name.chars().count() > 100
        || profile
            .name
            .chars()
            .any(|value| value.is_control() || matches!(value, '/' | '\\' | ':'))
    {
        return Err(invalid_profile());
    }
    let mut style = profile.style.clone();
    let mut prototype = super::super::default_export_template();
    for document in [&mut style, &mut prototype] {
        let fields = document.as_object_mut().ok_or_else(invalid_profile)?;
        fields.remove("updatedAt");
        fields.insert("name".into(), json!("shared"));
    }
    if style["schemaVersion"] != 2 {
        return Err(invalid_profile());
    }
    let mut profile = profile.clone();
    profile.style = portable_style(&style, &prototype, "style")?;
    Ok(profile)
}

fn profile_hash(profiles: &[Profile]) -> Result<String> {
    Ok(super::super::sha256_hex(
        &serde_json::to_vec(profiles).map_err(|_| Error::invalid_response())?,
    ))
}

impl Workspace<'_> {
    fn shared_profiles_remote(&self, account: &str, root: &str) -> Result<Snapshot> {
        self.check_selection(account, root)?;
        let snapshot: Snapshot = self.provider(
            account,
            "drive.workspaceProfilesRead",
            json!({"rootId":root}),
        )?;
        self.validate_shared_profiles(&snapshot)?;
        self.check_selection(account, root)?;
        Ok(snapshot)
    }
    fn validate_shared_profiles(&self, snapshot: &Snapshot) -> Result<()> {
        if snapshot.profiles.len() > 32
            || serde_json::to_vec(snapshot)
                .map_err(|_| Error::invalid_response())?
                .len()
                > LIMIT
            || snapshot
                .profiles
                .iter()
                .map(|profile| &profile.id)
                .collect::<BTreeSet<_>>()
                .len()
                != snapshot.profiles.len()
        {
            return Err(Error::invalid_response());
        }
        let valid = match (&snapshot.node_id, &snapshot.revision_id) {
            (Some(id), Some(revision)) => {
                valid_token(id)
                    && valid_revision(id, revision)
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
                snapshot.profiles.is_empty()
                    && snapshot.operation_id.is_none()
                    && snapshot.updated_at.is_none()
            }
            _ => false,
        };
        if !valid {
            return Err(Error::invalid_response());
        }
        for profile in &snapshot.profiles {
            if portable_profile(profile)?.style != profile.style {
                return Err(invalid_profile());
            }
        }
        Ok(())
    }
    fn shared_profiles_pending_path(&self, account: &str, root: &str) -> PathBuf {
        self.directory.join("shared-profile-attempts").join(format!(
            "{}.json",
            super::super::sha256_hex(json!([account, root]).to_string().as_bytes())
        ))
    }
    fn shared_profiles_pending(&self, account: &str, root: &str) -> Result<Option<Pending>> {
        let folder = self.directory.join("shared-profile-attempts");
        if !check_regular_directory(&self.directory)? || !check_regular_directory(&folder)? {
            return Ok(None);
        }
        let path = self.shared_profiles_pending_path(account, root);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(private_location()),
        };
        if !metadata.is_file() || batch::linked(&metadata) || metadata.len() > 8192 {
            return Err(private_location());
        }
        let mut bytes = Vec::new();
        fs::File::open(path)
            .map_err(|_| private_location())?
            .take(8193)
            .read_to_end(&mut bytes)
            .map_err(|_| private_location())?;
        if bytes.len() > 8192 {
            return Err(private_location());
        }
        let pending: Pending = serde_json::from_slice(&bytes).map_err(|_| private_location())?;
        if pending.schema_version != 1
            || pending.account_id != account
            || pending.root_id != root
            || !valid_token(&pending.operation_id)
            || pending.operation_id.len() > 100
            || pending.profile_hash.len() != 64
            || !pending
                .profile_hash
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(private_location());
        }
        Ok(Some(pending))
    }
    fn shared_profiles_response(
        &self,
        snapshot: Snapshot,
        pending: Option<&Pending>,
    ) -> Result<Value> {
        let confirmed = pending
            .map(|pending| {
                snapshot.operation_id.as_deref() == Some(&pending.operation_id)
                    && profile_hash(&snapshot.profiles).ok().as_deref()
                        == Some(&pending.profile_hash)
            })
            .unwrap_or(true);
        if confirmed {
            if let Some(pending) = pending {
                fs::remove_file(
                    self.shared_profiles_pending_path(&pending.account_id, &pending.root_id),
                )
                .map_err(|_| private_location())?;
            }
        }
        let mut value = serde_json::to_value(snapshot).map_err(|_| Error::invalid_response())?;
        value["outcome"] = json!(if confirmed { "confirmed" } else { "unknown" });
        value["pendingOperationId"] = if confirmed {
            Value::Null
        } else {
            json!(pending.map(|pending| &pending.operation_id))
        };
        value["checkedAt"] = json!(neubiki_core::now_iso());
        Ok(value)
    }

    pub(super) fn shared_profiles(
        &self,
        api: &LocalApi,
        action: &str,
        body: &Value,
    ) -> Result<Value> {
        let _guard = PROFILES_GATE.try_lock().map_err(|_| {
            Error::new(
                409,
                "profiles-busy",
                "Todavía se está comprobando una publicación de perfiles.",
            )
        })?;
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        self.check_selection(account, root)?;
        let pending = self.shared_profiles_pending(account, root)?;
        let remote = self.shared_profiles_remote(account, root)?;
        if matches!(action, "profiles-read" | "profiles-check") {
            return self.shared_profiles_response(remote, pending.as_ref());
        }
        if action != "profiles-publish" {
            return Err(Error::input());
        }
        self.require_write()?;
        if pending.is_some() {
            return Err(Error::new(409, "profiles-pending", "Hay una publicación de perfiles sin confirmar. Comprueba el mismo intento antes de continuar."));
        }
        if body.get("metadataNodeId").is_none()
            || body.get("baseRevisionId").is_none()
            || body["metadataNodeId"] != json!(remote.node_id)
            || body["baseRevisionId"] != json!(remote.revision_id)
        {
            return Err(Error::new(
                409,
                "profiles-stale",
                "El catálogo compartido cambió. Vuelve a revisar la publicación.",
            ));
        }
        let local = api.export_profiles().map_err(Error::local)?;
        if local["revision"].is_null() || local["revision"] != body["localRevision"] {
            return Err(Error::new(
                409,
                "profiles-local-changed",
                "Los perfiles del dispositivo cambiaron. Vuelve a revisar la publicación.",
            ));
        }
        let originals: Vec<Profile> =
            serde_json::from_value(local["profiles"].clone()).map_err(|_| Error::input())?;
        let profiles: Vec<Profile> = originals
            .iter()
            .map(portable_profile)
            .collect::<Result<_>>()?;
        if profiles.len() > 32 {
            return Err(Error::input());
        }
        let digest = profile_hash(&profiles)?;
        let pending = Pending {
            schema_version: 1,
            account_id: account.into(),
            root_id: root.into(),
            operation_id: neubiki_core::compact_id("profiles"),
            profile_hash: digest,
        };
        let content = json!({"schemaVersion":1,"owner":"neubiki","kind":"export-profiles","rootId":root,
            "operationId":pending.operation_id,"updatedAt":neubiki_core::now_iso(),"profiles":profiles});
        let bytes = serde_json::to_vec(&content).map_err(|_| Error::input())?;
        if bytes.len() > LIMIT {
            return Err(Error::new(
                413,
                "profiles-too-large",
                "El catálogo compartido supera 1 MiB.",
            ));
        }
        if api.export_profiles().map_err(Error::local)?["revision"] != body["localRevision"] {
            return Err(Error::generation());
        }
        ensure_directory(&self.directory)?;
        ensure_directory(&self.directory.join("shared-profile-attempts"))?;
        let path = self.shared_profiles_pending_path(account, root);
        atomic_io::create(
            &path,
            &serde_json::to_vec(&pending).map_err(|_| private_location())?,
        )
        .map_err(|_| private_location())?;
        let result: Result<Snapshot> = self.provider(account, "drive.workspaceProfilesWrite", json!({"rootId":root,
            "metadataNodeId":remote.node_id,"baseRevisionId":remote.revision_id,"contentBase64":BASE64.encode(bytes)}));
        match result {
            Ok(snapshot) => {
                self.validate_shared_profiles(&snapshot)?;
                self.check_selection(account, root)?;
                self.shared_profiles_response(snapshot, Some(&pending))
            }
            Err(error) if error.code == "revision-conflict" => {
                fs::remove_file(path).map_err(|_| private_location())?;
                Err(error)
            }
            Err(_) => {
                let mut result =
                    serde_json::to_value(remote).map_err(|_| Error::invalid_response())?;
                result["outcome"] = json!("unknown");
                result["pendingOperationId"] = json!(pending.operation_id);
                result["checkedAt"] = json!(neubiki_core::now_iso());
                Ok(result)
            }
        }
    }
}

impl LocalApi {
    pub(crate) fn proton_shared_export_profile(
        &self,
        body: &Value,
        id: &str,
        revision: &str,
    ) -> std::result::Result<Profile, String> {
        self.with_proton_workspace(|workspace| {
            let account = token(body, "accountId")?;
            let root = token(body, "rootId")?;
            let snapshot = workspace.shared_profiles_remote(account, root)?;
            if snapshot.revision_id.as_deref() != Some(revision) {
                return Err(Error::new(
                    409,
                    "profiles-stale",
                    "El perfil compartido cambió. Abre Exportar y selecciona de nuevo el perfil.",
                ));
            }
            snapshot
                .profiles
                .into_iter()
                .find(|profile| profile.id == id)
                .ok_or_else(|| {
                    Error::new(
                        404,
                        "profile-missing",
                        "El perfil compartido seleccionado ya no existe.",
                    )
                })
        })
        .map_err(|error| error.detail)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn proton_shared_profiles_strip_device_provenance_and_reject_resource_paths() {
        let mut style = super::super::super::default_export_template();
        style["name"] = json!("C:\\private-profile-canary");
        let profile = Profile {
            id: "export-profile-example".into(),
            name: "Informe".into(),
            cover: true,
            contents: false,
            style,
        };
        let portable = portable_profile(&profile).unwrap();
        assert!(portable.style.get("updatedAt").is_none());
        assert_eq!(portable.style["name"], "shared");
        assert!(!serde_json::to_string(&portable)
            .unwrap()
            .contains("private-profile-canary"));
        let mut injected = profile.clone();
        injected.style["document"]["logoPath"] = json!("../private/image.png");
        assert!(portable_profile(&injected).is_err());
        injected = profile.clone();
        injected.style["normal"]["fontFamily"] = json!("C:\\private\\font.ttf");
        assert!(portable_profile(&injected).is_err());
        injected = profile.clone();
        injected.name = "C:\\private".into();
        assert!(portable_profile(&injected).is_err());
    }

    #[test]
    fn proton_shared_profiles_publish_a_frozen_local_catalog_and_reconcile_without_replay() {
        let temp = tempfile::tempdir().unwrap();
        let api = LocalApi::new(temp.path().join("state"), "qa".into(), "test".into());
        let local = api.change_export_profiles(json!({"revision":null,"action":"capture","id":"export-profile-example","name":"Informe","cover":true,"contents":false})).unwrap();
        let remote = RefCell::new(
            json!({"nodeId":null,"revisionId":null,"profiles":[],"operationId":null,"updatedAt":null}),
        );
        let writes = Cell::new(0);
        let invoke = |_: &str, action: &str, body: Value| match action {
            "drive.workspaceFolder" => {
                Ok(json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"}))
            }
            "drive.workspaceProfilesRead" => Ok(remote.borrow().clone()),
            "drive.workspaceProfilesWrite" => {
                writes.set(writes.get() + 1);
                assert!(body["baseRevisionId"].is_null());
                let bytes = BASE64
                    .decode(body["contentBase64"].as_str().unwrap())
                    .unwrap();
                let content: Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(content["kind"], "export-profiles");
                assert!(content["profiles"][0]["style"].get("updatedAt").is_none());
                *remote.borrow_mut() = json!({"nodeId":"vol~profiles","revisionId":"vol~profiles~rev","profiles":content["profiles"],"operationId":content["operationId"],"updatedAt":content["updatedAt"]});
                Err(ProviderError::new("network"))
            }
            other => panic!("Unexpected document operation {other}"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        workspace
            .handle("select", json!({"accountId":"account","rootId":"vol~root"}))
            .unwrap();
        let mut request = json!({"accountId":"account","rootId":"vol~root","metadataNodeId":null,"baseRevisionId":null,"localRevision":"stale"});
        assert_eq!(
            workspace
                .shared_profiles(&api, "profiles-publish", &request)
                .unwrap_err()
                .code,
            "profiles-local-changed"
        );
        assert_eq!(writes.get(), 0);
        request["localRevision"] = local["revision"].clone();
        let uncertain = workspace
            .shared_profiles(&api, "profiles-publish", &request)
            .unwrap();
        assert_eq!(uncertain["outcome"], "unknown");
        assert_eq!(writes.get(), 1);
        assert_eq!(
            workspace
                .shared_profiles(&api, "profiles-publish", &request)
                .unwrap_err()
                .code,
            "profiles-pending"
        );
        let checked = workspace
            .shared_profiles(&api, "profiles-check", &request)
            .unwrap();
        assert_eq!(checked["outcome"], "confirmed");
        assert_eq!(checked["profiles"][0]["name"], "Informe");
        assert_eq!(writes.get(), 1);
        assert_eq!(
            workspace
                .shared_profiles(&api, "profiles-publish", &request)
                .unwrap_err()
                .code,
            "profiles-stale"
        );
    }
}
