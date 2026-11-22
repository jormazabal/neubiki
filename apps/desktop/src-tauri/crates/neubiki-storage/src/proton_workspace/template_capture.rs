//! Saved template sources never consult or modify a private document journal.
use super::*;
pub(crate) struct SavedTemplateSource {
    pub name: String,
    pub revision_id: String,
    pub markdown: String,
}
#[derive(PartialEq, Eq)]
pub(crate) struct SavedTemplateAsset {
    pub node_id: String,
    pub revision_id: String,
    pub name: String,
    pub bytes: Vec<u8>,
}
impl LocalApi {
    pub(crate) fn proton_template_source(
        &self,
        body: &Value,
    ) -> std::result::Result<SavedTemplateSource, String> {
        self.with_proton_workspace(|workspace| workspace.template_source(body))
            .map_err(|error| error.detail)
    }
    pub(crate) fn proton_template_asset(
        &self,
        body: &Value,
        relative: &str,
    ) -> std::result::Result<SavedTemplateAsset, String> {
        self.with_proton_workspace(|workspace| {
            let scope: DocumentScope = parse_input(body)?;
            let document = workspace.document(&scope)?;
            let remote = workspace.remote_read(&document, Some(relative))?;
            if !valid_revision(&remote.node.node_id, &remote.revision_id)
                || remote.content_base64.len() > 4 * (8usize * 1024 * 1024).div_ceil(3)
            {
                return Err(Error::invalid_response());
            }
            let bytes = BASE64
                .decode(remote.content_base64)
                .map_err(|_| Error::invalid_response())?;
            if bytes.len() > 8 * 1024 * 1024 {
                return Err(Error::input());
            }
            workspace.check_selection(&scope.account_id, &scope.root_id)?;
            Ok(SavedTemplateAsset {
                node_id: remote.node.node_id,
                revision_id: remote.revision_id,
                name: remote.node.name,
                bytes,
            })
        })
        .map_err(|error: Error| error.detail)
    }
}
impl Workspace<'_> {
    fn template_source(&self, body: &Value) -> Result<SavedTemplateSource> {
        let scope: DocumentScope = parse_input(body)?;
        let expected = token(body, "revisionId")?;
        if !valid_revision(&scope.node_id, expected) {
            return Err(Error::input());
        }
        let document = self.document(&scope)?;
        let remote = self.remote_read(&document, None)?;
        if remote.revision_id != expected {
            return Err(Error::new(409,"template-source-changed","La revisión guardada cambió. Vuelve a leer el documento antes de capturar la plantilla."));
        }
        if !is_markdown(&remote.node.name)
            || remote.content_base64.len() > 4 * (1024usize * 1024).div_ceil(3)
        {
            return Err(Error::new(
                413,
                "template-source-limit",
                "La captura requiere un documento Markdown guardado de hasta1MiB.",
            ));
        }
        let bytes = BASE64
            .decode(remote.content_base64)
            .map_err(|_| Error::invalid_response())?;
        if bytes.len() > 1024 * 1024 {
            return Err(Error::input());
        }
        let markdown = String::from_utf8(bytes).map_err(|_| {
            Error::new(
                422,
                "invalid-markdown-encoding",
                "El documento guardado necesita UTF-8 válido.",
            )
        })?;
        self.check_selection(&scope.account_id, &scope.root_id)?;
        Ok(SavedTemplateSource {
            name: remote.node.name,
            revision_id: remote.revision_id,
            markdown,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn template_source_reads_saved_content_and_refuses_another_revision() {
        let directory = tempfile::tempdir().unwrap();
        let invoke = |_: &str, action: &str, _body: Value| match action {
            "drive.workspaceFolder" => {
                Ok(json!({"nodeId":"v~root","name":"Proyecto","type":"folder"}))
            }
            "drive.workspaceRead" => Ok(
                json!({"node":{"nodeId":"v~doc","name":"Acta.mdown","type":"file","revisionId":"v~doc~r1"},"revisionId":"v~doc~r1","contentBase64":BASE64.encode("# Guardado")}),
            ),
            _ => panic!("Unexpected {action}"),
        };
        let workspace = Workspace {
            directory: directory.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        workspace
            .handle("select", json!({"accountId":"account","rootId":"v~root"}))
            .unwrap();
        let mut body = json!({"accountId":"account","rootId":"v~root","nodeId":"v~doc","revisionId":"v~doc~r1"});
        assert_eq!(
            workspace.template_source(&body).unwrap().markdown,
            "# Guardado"
        );
        body["revisionId"] = json!("v~doc~r2");
        assert_eq!(
            workspace.template_source(&body).err().unwrap().code,
            "template-source-changed"
        );
    }
}
