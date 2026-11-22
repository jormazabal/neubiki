//! Render a revision-verified note page; uploads retain the existing image asset contract.
use super::*;

impl Workspace<'_> {
    pub(super) fn note_page_render(&self, body: &Value) -> Result<Value> {
        let scope: DocumentScope = parse_input(body)?;
        let target = self.document(&scope)?;
        let remote_target = self.remote_read(&target, None)?;
        if !is_markdown(&remote_target.node.name)
            || remote_target.revision_id != token(body, "baseRevisionId")?
        {
            return Err(Error::generation());
        }
        let source_id = token(body, "sourceNodeId")?;
        let source_scope = DocumentScope {
            node_id: source_id.into(),
            ..scope.clone()
        };
        let document = self.document(&source_scope)?;
        let source = self.remote_read(&document, None)?;
        let revision = token(body, "sourceRevisionId")?;
        if source.revision_id != revision || !is_handwritten(&source.node.name) {
            return Err(Error::generation());
        }
        let note = read_preview_note(&source, source_id)?;
        let page_id = token(body, "pageId")?;
        let page_number = note["pages"]
            .as_array()
            .and_then(|pages| pages.iter().position(|page| page["id"] == page_id))
            .map(|position| position + 1)
            .ok_or_else(Error::input)?;
        let catalog = self.resource_catalog(body)?;
        let items = catalog["resources"]
            .as_array()
            .ok_or_else(Error::invalid_response)?;
        let find = |node_id: &str| {
            items.iter().find(|item|item["node"]["nodeId"]==node_id)
            .ok_or_else(||Error::new(409,"proton-note-embed-path","No se pudo confirmar la ruta de la nota y del destino. Actualiza el catálogo."))
        };
        let source_entry = find(source_id)?;
        let target_entry = find(&scope.node_id)?;
        if source_entry["node"]["name"] != source.node.name
            || source_entry["node"]["revisionId"] != revision
            || target_entry["node"]["revisionId"] != remote_target.revision_id
        {
            return Err(Error::generation());
        }
        let path = source_path(
            &target_entry["parents"],
            &source_entry["parents"],
            &source.node.name,
        )?;
        let (_, png) =
            neubiki_docs::handwritten_note_png(&note, Some(page_id), 1.5).map_err(Error::local)?;
        if png.is_empty() || png.len() > MAX_IMAGE_BYTES {
            return Err(Error::new(
                413,
                "proton-note-embed-size",
                "La imagen de página supera 8 MiB.",
            ));
        }
        self.check_selection(&scope.account_id, &scope.root_id)?;
        Ok(
            json!({"sourceName":source.node.name,"sourceRevisionId":revision,"sourceNodeId":source_id,
            "pageId":page_id,"pageNumber":page_number,"sourceRelativePath":path,"contentBase64":BASE64.encode(png)}),
        )
    }
}

fn source_path(target: &Value, source: &Value, name: &str) -> Result<String> {
    let target = target.as_array().ok_or_else(Error::invalid_response)?;
    let source = source.as_array().ok_or_else(Error::invalid_response)?;
    if target.is_empty() || source.is_empty() || target[0]["nodeId"] != source[0]["nodeId"] {
        return Err(Error::input());
    }
    let common = target
        .iter()
        .zip(source)
        .take_while(|(left, right)| left["nodeId"] == right["nodeId"])
        .count();
    let mut parts = vec!["..".to_string(); target.len() - common];
    for parent in &source[common..] {
        parts.push(segment(
            parent["name"]
                .as_str()
                .ok_or_else(Error::invalid_response)?,
        ));
    }
    parts.push(segment(name));
    Ok(parts.join("/"))
}
fn segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn proton_note_embed_links_keep_scope_and_encode_names() {
        let target = json!([{"nodeId":"root","name":"Root"},{"nodeId":"a","name":"A"}]);
        let source = json!([{"nodeId":"root","name":"Root"},{"nodeId":"b","name":"B space"}]);
        assert_eq!(
            source_path(&target, &source, "Nota #1.nbnote").unwrap(),
            "../B%20space/Nota%20%231.nbnote"
        );
        assert!(source_path(&target, &json!([{"nodeId":"other"}]), "Note.nbnote").is_err());
    }

    #[test]
    fn proton_note_embed_renders_only_the_reviewed_page_without_remote_writes() {
        let temporary = tempfile::tempdir().unwrap();
        let note = handwritten::new_note("Note one.nbnote");
        let node = |id: &str, name: &str, revision: &str| json!({"nodeId":id,"name":name,"type":"file","revisionId":revision});
        let target = node("v~target", "Target.md", "v~target~rev");
        let source = node("v~source", "Note one.nbnote", "v~source~rev");
        let invoke = |_: &str, action: &str, body: Value| match action {
            "drive.workspaceFolder" => Ok(json!({"nodeId":"v~root","name":"Root","type":"folder"})),
            "drive.workspaceList" => Ok(json!({"items":[target,source],"complete":true})),
            "drive.workspaceRead" => {
                let (node, content) = if body["nodeId"] == "v~target" {
                    (&target, String::from("# Target"))
                } else {
                    (&source, note.to_string())
                };
                Ok(
                    json!({"node":node,"revisionId":node["revisionId"],"ancestorIds":["v~root"],"contentBase64":BASE64.encode(content)}),
                )
            }
            _ => panic!("A render cannot write or call another provider action: {action}"),
        };
        let workspace = Workspace {
            directory: temporary.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        let mut request = json!({"accountId":"account","rootId":"v~root","nodeId":"v~target","baseRevisionId":"v~target~rev",
            "sourceNodeId":"v~source","sourceRevisionId":"v~source~rev","pageId":"page-1"});
        workspace.handle("select", request.clone()).unwrap();
        let rendered = workspace.note_page_render(&request).unwrap();
        assert_eq!(rendered["sourceRelativePath"], "Note%20one.nbnote");
        assert_eq!(rendered["pageNumber"], 1);
        assert!(BASE64
            .decode(rendered["contentBase64"].as_str().unwrap())
            .unwrap()
            .starts_with(b"\x89PNG\r\n\x1a\n"));
        request["sourceRevisionId"] = json!("v~source~old");
        assert!(workspace.note_page_render(&request).is_err());
    }
}
