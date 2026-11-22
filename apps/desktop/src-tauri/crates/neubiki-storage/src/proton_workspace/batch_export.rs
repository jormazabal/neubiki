//! Capture only a verified saved revision; private drafts never enter a batch.
use super::*;
impl LocalApi {
    pub(crate) fn proton_batch_scope(&self, body: &Value) -> std::result::Result<(), String> {
        self.with_proton_workspace(|workspace| {
            workspace.check_selection(token(body, "accountId")?, token(body, "rootId")?)
        }).map_err(|error| error.detail)
    }
    pub(crate) fn proton_batch_snapshot(&self, body: &Value) -> std::result::Result<Value, String> {
        self.with_proton_workspace(|workspace| workspace.batch_snapshot(body)).map_err(|error| error.detail)
    }
}
impl Workspace<'_> {
    fn batch_snapshot(&self, body: &Value) -> Result<Value> {
        let scope: DocumentScope = parse_input(body)?;
        let expected = token(body, "revisionId")?;
        if !valid_revision(&scope.node_id, expected) { return Err(Error::input()); }
        let document = self.document(&scope)?;
        let remote = self.remote_read(&document, None)?;
        if remote.revision_id != expected {
            return Err(Error::new(409, "stale-node", "El documento cambió en Proton. Actualiza la selección antes de preparar otro lote."));
        }
        let mut snapshot = json!({"accountId":scope.account_id,"rootId":scope.root_id,
            "nodeId":scope.node_id,"name":remote.node.name,"revisionId":remote.revision_id});
        if is_handwritten(&remote.node.name) {
            snapshot["handwritten"] = read_preview_note(&remote, &document.id)?;
        } else if is_markdown(&remote.node.name) {
            if remote.content_base64.len() > 4 * MAX_MARKDOWN_BYTES.div_ceil(3) { return Err(Error::input()); }
            let bytes = BASE64.decode(&remote.content_base64).map_err(|_| Error::invalid_response())?;
            if bytes.len() > MAX_MARKDOWN_BYTES { return Err(Error::input()); }
            snapshot["markdown"] = json!(String::from_utf8(bytes).map_err(|_| Error::new(422,
                "invalid-markdown-encoding", "El Markdown en Proton no está codificado en UTF-8."))?);
        } else { return Err(Error::new(422, "unsupported-export", "Este archivo no admite exportación documental.")); }
        self.check_selection(&scope.account_id, &scope.root_id)?;
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn batch_capture_is_saved_scoped_and_refuses_changed_revision() {
        let directory = tempfile::tempdir().unwrap();
        let invoke = |_: &str, action: &str, request: Value| match action {
            "drive.workspaceFolder" => Ok(json!({"nodeId":"v~root","name":"Proyecto","type":"folder"})),
            "drive.workspaceRead" => {
                assert_eq!(request["rootId"], "v~root");
                Ok(json!({"node":{"nodeId":"v~doc","name":"Acta.mdown","type":"file","revisionId":"v~doc~r1"},
                    "revisionId":"v~doc~r1","contentBase64":BASE64.encode("# Guardado")}))
            }
            _ => panic!("Unexpected {action}"),
        };
        let workspace = Workspace { directory: directory.path().join("workspace"), invoke: &invoke, can_write: false };
        workspace.handle("select", json!({"accountId":"account","rootId":"v~root"})).unwrap();
        let mut request = json!({"accountId":"account","rootId":"v~root","nodeId":"v~doc","revisionId":"v~doc~r1"});
        assert_eq!(workspace.batch_snapshot(&request).unwrap()["markdown"], "# Guardado");
        request["revisionId"] = json!("v~doc~r2");
        assert_eq!(workspace.batch_snapshot(&request).unwrap_err().code, "stale-node");
        request["rootId"] = json!("v~other");
        assert!(workspace.batch_snapshot(&request).is_err());
    }
}
