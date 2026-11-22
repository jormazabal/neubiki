use super::*;

impl Journal {
    pub(super) fn is_handwritten(&self) -> bool {
        self.content_kind.as_deref() == Some("handwritten")
    }

    pub(super) fn validate_payload(&self) -> bool {
        match self.content_kind.as_deref() {
            None => self.markdown.len() <= MAX_MARKDOWN_BYTES,
            Some("handwritten") if self.draft.is_some() => {
                serde_json::from_str::<Value>(&self.markdown)
                    .ok()
                    .is_some_and(|content| serialize_note(&content).is_ok())
            }
            Some("handwritten") => self.markdown.is_empty(),
            _ => false,
        }
    }
}

pub(super) fn serialize_note(content: &Value) -> Result<String> {
    super::super::document_validation::handwritten(content).map_err(|_| {
        Error::new(
            422,
            "proton-note-format",
            "La estructura de la nota manuscrita no es compatible.",
        )
    })?;
    let serialized = serde_json::to_string(content).map_err(|_| Error::input())?;
    if serialized.len() > MAX_NOTE_BYTES {
        return Err(Error::new(
            413,
            "proton-note-size",
            "La nota manuscrita admite hasta 8 MiB.",
        ));
    }
    Ok(serialized)
}

pub(super) fn new_note(name: &str) -> Value {
    super::super::default_handwritten_note(
        &neubiki_core::compact_id("note"),
        name.trim_end_matches(".nbnote"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn proton_workspace_note_recovers_conflicts_and_saves_only_against_reviewed_base() {
        let dir = tempfile::tempdir().unwrap();
        let root = "vol~root";
        let node = "vol~note";
        let base = "vol~note~base";
        let next = "vol~note~next";
        let name = "Herencia.knote";
        let original = new_note("Example.nbnote");
        let serialized = RefCell::new(original.to_string());
        let revision = Cell::new(base);
        let writes = Cell::new(0);
        let invoke = |_: &str, operation: &str, payload: Value| match operation {
            "drive.workspaceFolder" => {
                Ok(json!({"nodeId":root,"name":"Workspace","type":"folder"}))
            }
            "drive.workspaceRead" => Ok(
                json!({"node":{"nodeId":node,"name":name,"type":"file","revisionId":revision.get()},
                "revisionId":revision.get(),"contentBase64":BASE64.encode(serialized.borrow().as_bytes())}),
            ),
            "drive.writeRevision" => {
                writes.set(writes.get() + 1);
                assert_eq!(payload["contentKind"], "handwritten");
                if payload["baseRevisionId"] != revision.get() {
                    return Err(ProviderError::new("revision-conflict"));
                }
                *serialized.borrow_mut() = String::from_utf8(
                    BASE64
                        .decode(payload["contentBase64"].as_str().unwrap())
                        .unwrap(),
                )
                .unwrap();
                revision.set("vol~note~saved");
                Ok(json!({"nodeId":node,"revisionId":revision.get()}))
            }
            _ => panic!("Unexpected provider operation {operation}"),
        };
        let workspace = Workspace {
            directory: dir.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        let address = json!({"accountId":"account","rootId":root,"nodeId":node});
        workspace.handle("select", address.clone()).unwrap();
        assert_eq!(
            workspace.handle("read", address.clone()).unwrap()["handwritten"],
            original
        );
        let mut edited = original.clone();
        edited["pages"][0]["title"] = json!("Edited page");
        let mut draft = address.clone();
        draft["documentName"] = json!(name);
        draft["baseRevisionId"] = json!(base);
        draft["expectedGeneration"] = Value::Null;
        draft["handwritten"] = edited.clone();
        assert_eq!(
            workspace.handle("draft", draft).unwrap()["handwritten"],
            edited
        );
        assert_eq!(
            workspace.handle("read", address.clone()).unwrap()["draft"]["handwritten"],
            edited
        );
        let recovered = workspace.handle("recovery-read", json!({"accountId":"account","rootId":root,"nodeId":node,"kind":"draft","generation":1})).unwrap();
        assert_eq!(recovered["handwritten"], edited);
        assert!(recovered["fileName"].as_str().unwrap().ends_with(".nbnote"));

        revision.set(next);
        let mut save = address.clone();
        save["operationId"] = json!("first");
        save["generation"] = json!(1);
        assert_eq!(
            workspace.handle("save", save.clone()).unwrap()["state"],
            "conflict"
        );
        let review = workspace
            .handle("conflict-review", address.clone())
            .unwrap();
        assert_eq!(review["handwritten"], true);
        let mut resolution = json!({"accountId":"account","rootId":root,"nodeId":node,
            "remoteRevisionId":next,"draftGeneration":1,"markdown":edited.to_string(),
            "handwrittenMerge":{"general":"local","choices":[{"pageId":"page-1","choice":"both"}]}});
        assert!(workspace
            .handle("conflict-resolve", resolution.clone())
            .is_err());
        resolution["handwrittenMerge"]["choices"][0]["choice"] = json!("local");
        resolution["draftGeneration"] = json!(2);
        assert!(workspace
            .handle("conflict-resolve", resolution.clone())
            .is_err());
        resolution["draftGeneration"] = json!(1);
        let resolved = workspace.handle("conflict-resolve", resolution).unwrap();
        assert_eq!(resolved["draft"]["handwritten"], edited);
        assert_eq!(workspace.handle("recovery-read", json!({"accountId":"account","rootId":root,"nodeId":node,"kind":"local-original","generation":1})).unwrap()["handwritten"],edited);
        assert_eq!(workspace.handle("recovery-read", json!({"accountId":"account","rootId":root,"nodeId":node,"kind":"remote-original","generation":1})).unwrap()["handwritten"],original);
        save["operationId"] = json!("resolved");
        save["generation"] = json!(2);
        assert_eq!(workspace.handle("save", save).unwrap()["state"], "saved");
        assert_eq!(writes.get(), 2);
        let reloaded = workspace.handle("read", address).unwrap();
        assert_eq!(reloaded["node"]["name"], "Herencia.knote");
        assert_eq!(reloaded["handwritten"], edited);
        assert!(reloaded["draft"].is_null());
    }
}
