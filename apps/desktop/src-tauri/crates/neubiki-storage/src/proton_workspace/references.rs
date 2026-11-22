use super::*;
use std::{
    collections::{BTreeMap, VecDeque},
    time::{Duration, Instant},
};

const MAX_REFERENCES: usize = 100;
const MAX_FOLDERS: usize = 16;
static INCOMING_GATE: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum Resolution {
    Available { node: Node },
    External,
    Anchor,
    Folder,
    Missing,
    Blocked,
    Unverified,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reference {
    target: String,
    line: usize,
    image: bool,
    #[serde(flatten)]
    resolution: Resolution,
}

struct ReferenceLookup<'a, 'b> {
    workspace: &'a Workspace<'b>,
    scope: &'a DocumentScope,
    folders: BTreeMap<String, Option<Vec<Node>>>,
    started: Instant,
}

#[derive(Default)]
struct FolderCrossings {
    entered_by_name: bool,
    left: bool,
}

impl Workspace<'_> {
    pub(super) fn incoming_references(
        &self,
        document: &Document<'_>,
        body: &Value,
    ) -> Result<Value> {
        let target_revision = token(body, "revisionId")?;
        let target = self.remote_read(document, None)?;
        if target.revision_id != target_revision || !is_markdown(&target.node.name) {
            return Err(Error::generation());
        }
        let scope = document.scope;
        let mut result = self.scan_incoming_references(document)?;
        let current = self.remote_read(document, None)?;
        if current.revision_id != target_revision {
            return Err(Error::generation());
        }
        self.check_selection(&scope.account_id, &scope.root_id)?;
        result["revisionId"] = json!(target_revision);
        Ok(result)
    }

    pub(super) fn scan_incoming_references(&self, document: &Document<'_>) -> Result<Value> {
        self.scan_reference_impact(document, false, false)
    }

    pub(super) fn scan_reference_impact(
        &self,
        document: &Document<'_>,
        folder_target: bool,
        moving: bool,
    ) -> Result<Value> {
        let _request = INCOMING_GATE.try_lock().map_err(|_| {
            Error::new(
                409,
                "proton-reference-busy",
                "Todavía se está comprobando otra lista de referencias.",
            )
        })?;
        let scope = document.scope;
        let selection = self.recovery_selection(document)?;
        let mut folders = VecDeque::from([vec![selection.root]]);
        let mut visited = BTreeSet::new();
        let mut scanned = 0;
        let mut scanned_folders = 0;
        let mut source_bytes = 0;
        let mut nodes = 0;
        let mut partial = false;
        let mut references = Vec::new();
        let mut outgoing = Vec::new();
        let started = Instant::now();
        'scan: while let Some(parents) = folders.pop_front() {
            if scanned_folders == 16 || started.elapsed() >= Duration::from_secs(15) {
                partial = true;
                break;
            }
            let parent = parents.last().ok_or_else(Error::invalid_response)?;
            let list = match self.list(&json!({"accountId":scope.account_id,"rootId":scope.root_id,"parentId":parent.node_id})) {
                Ok(list) => list,
                Err(_) => { partial = true; continue; }
            };
            scanned_folders += 1;
            let children: Vec<Node> = serde_json::from_value(list["items"].clone())
                .map_err(|_| Error::invalid_response())?;
            for node in children {
                if super::super::path_policy::reserved(std::ffi::OsStr::new(&node.name))
                    || !visited.insert(node.node_id.clone())
                {
                    continue;
                }
                nodes += 1;
                if nodes > 10_000 || started.elapsed() >= Duration::from_secs(15) {
                    partial = true;
                    break 'scan;
                }
                if node.kind == NodeKind::Folder {
                    if parents.len() >= 32 || scanned_folders + folders.len() >= 16 {
                        partial = true;
                        continue;
                    }
                    let mut next = parents.clone();
                    next.push(node);
                    folders.push_back(next);
                    continue;
                }
                if !is_markdown(&node.name) {
                    continue;
                }
                if scanned == 16
                    || source_bytes >= 2 * 1024 * 1024
                    || references.len() + outgoing.len() >= MAX_REFERENCES
                {
                    partial = true;
                    break 'scan;
                }
                scanned += 1;
                let source = (|| {
                    let remote: RemoteRead = self.provider(
                        &scope.account_id,
                        "drive.workspaceRead",
                        json!({"rootId":scope.root_id,"nodeId":node.node_id,"search":true}),
                    )?;
                    validate_node(&remote.node)?;
                    if remote.node.node_id != node.node_id
                        || remote.node.name != node.name
                        || remote.node.revision_id != node.revision_id
                        || remote.ancestor_ids.as_ref()
                            != Some(
                                &parents
                                    .iter()
                                    .map(|node| node.node_id.clone())
                                    .collect::<Vec<_>>(),
                            )
                        || remote.node.revision_id.as_deref() != Some(remote.revision_id.as_str())
                        || remote.content_base64.len() > 4 * (2 * 1024 * 1024usize).div_ceil(3)
                    {
                        return Err(Error::invalid_response());
                    }
                    let bytes = BASE64
                        .decode(remote.content_base64)
                        .map_err(|_| Error::invalid_response())?;
                    source_bytes += bytes.len();
                    if source_bytes > 2 * 1024 * 1024 {
                        return Err(Error::invalid_response());
                    }
                    let text = String::from_utf8(bytes).map_err(|_| Error::invalid_response())?;
                    Ok((remote.revision_id, text))
                })();
                let Ok((revision, text)) = source else {
                    partial = true;
                    continue;
                };
                let source_scope = DocumentScope {
                    account_id: scope.account_id.clone(),
                    root_id: scope.root_id.clone(),
                    node_id: node.node_id.clone(),
                };
                let mut lookup = ReferenceLookup {
                    workspace: self,
                    scope: &source_scope,
                    folders: BTreeMap::new(),
                    started,
                };
                let ancestors: Vec<_> = parents.iter().map(|node| node.node_id.clone()).collect();
                let mut offset = 0;
                let mut line = 1;
                let mut links = 0;
                for link in neubiki_docs::markdown_destinations(&text) {
                    links += 1;
                    if links > 200
                        || references.len() + outgoing.len() >= MAX_REFERENCES
                        || started.elapsed() >= Duration::from_secs(15)
                    {
                        partial = true;
                        break;
                    }
                    line += text.as_bytes()[offset..link.range.start]
                        .iter()
                        .filter(|byte| **byte == b'\n')
                        .count();
                    offset = link.range.start;
                    let mut crossings = FolderCrossings::default();
                    let trace = folder_target.then_some((scope.node_id.as_str(), &mut crossings));
                    match lookup.resolve_traced(&link.target, Some(&ancestors), trace) {
                        Resolution::Available { node: found } if !folder_target && found.node_id == scope.node_id => {
                            references.push(json!({"node":node,"parents":parents,"revisionId":revision,"line":line,"target":link.target,"image":link.is_image}));
                        }
                        Resolution::Available { .. } | Resolution::Folder if moving && crossings.left => {
                            outgoing.push(json!({"sourceName":node.name,"line":line,"target":link.target}));
                        }
                        Resolution::Available { .. } | Resolution::Folder if crossings.entered_by_name => {
                            references.push(json!({"node":node,"parents":parents,"revisionId":revision,"line":line,"target":link.target,"image":link.is_image}));
                        }
                        Resolution::Unverified => partial = true,
                        _ => {}
                    }
                }
            }
        }
        self.check_selection(&scope.account_id, &scope.root_id)?;
        Ok(
            json!({"references":references,"outgoing":outgoing,"partial":partial,"scannedDocuments":scanned,"scannedFolders":scanned_folders}),
        )
    }

    pub(super) fn references(&self, document: &Document<'_>, body: &Value) -> Result<Value> {
        let revision = token(body, "revisionId")?;
        if !valid_revision(&document.scope.node_id, revision) {
            return Err(Error::input());
        }
        let remote = self.remote_read(document, None)?;
        if !is_markdown(&remote.node.name) || remote.revision_id != revision {
            return Err(Error::new(409, "proton-reference-source-changed", "La revisión guardada cambió. Vuelve a leer el documento antes de consultar las referencias."));
        }
        if remote.content_base64.len() > 4 * MAX_MARKDOWN_BYTES.div_ceil(3) {
            return Err(Error::new(
                413,
                "proton-reference-source-too-large",
                "La nota supera el límite de 4 MiB para revisar referencias.",
            ));
        }
        let bytes = BASE64
            .decode(&remote.content_base64)
            .map_err(|_| Error::invalid_response())?;
        if bytes.len() > MAX_MARKDOWN_BYTES {
            return Err(Error::invalid_response());
        }
        let markdown = String::from_utf8(bytes).map_err(|_| Error::invalid_response())?;
        let mut lookup = ReferenceLookup {
            workspace: self,
            scope: document.scope,
            folders: BTreeMap::new(),
            started: Instant::now(),
        };
        let mut seen = BTreeSet::new();
        let mut references = Vec::new();
        let mut partial = false;
        let mut offset = 0;
        let mut line = 1;
        for link in neubiki_docs::markdown_destinations(&markdown) {
            if !seen.insert((link.target.clone(), link.is_image)) {
                continue;
            }
            if references.len() == MAX_REFERENCES {
                partial = true;
                break;
            }
            line += markdown.as_bytes()[offset..link.range.start]
                .iter()
                .filter(|byte| **byte == b'\n')
                .count();
            offset = link.range.start;
            let resolution = lookup.resolve(&link.target, remote.ancestor_ids.as_deref());
            if matches!(resolution, Resolution::Unverified) {
                partial = true;
            }
            let target = if link.target.len() > 4096 {
                format!("{}…", link.target.chars().take(512).collect::<String>())
            } else {
                link.target
            };
            references.push(Reference {
                target,
                line,
                image: link.is_image,
                resolution,
            });
        }
        self.check_selection(&document.scope.account_id, &document.scope.root_id)?;
        Ok(json!({"revisionId":remote.revision_id,"references":references,"partial":partial}))
    }
}

impl ReferenceLookup<'_, '_> {
    fn resolve(&mut self, target: &str, ancestors: Option<&[String]>) -> Resolution {
        self.resolve_traced(target, ancestors, None)
    }

    fn resolve_traced(
        &mut self,
        target: &str,
        ancestors: Option<&[String]>,
        mut trace: Option<(&str, &mut FolderCrossings)>,
    ) -> Resolution {
        if target.is_empty()
            || target.len() > 4096
            || target.chars().any(char::is_control)
            || target.contains('\\')
        {
            return Resolution::Blocked;
        }
        let lower = target.to_ascii_lowercase();
        if lower.starts_with("https://") || lower.starts_with("http://") {
            return Resolution::External;
        }
        if target.starts_with('#') {
            return Resolution::Anchor;
        }
        let path = target.split(['#', '?']).next().unwrap_or("");
        if path.is_empty() || path.starts_with('/') || path.contains(':') {
            return Resolution::Blocked;
        }
        let parts: Option<Vec<_>> = path.split('/').map(decode_segment).collect();
        let Some(parts) = parts.filter(|parts| parts.len() <= 128) else {
            return Resolution::Blocked;
        };
        let Some(mut stack) = ancestors.map(<[String]>::to_vec) else {
            return Resolution::Unverified;
        };
        let mut last_folder = None;
        for (index, part) in parts.iter().enumerate() {
            if part == "." {
                continue;
            }
            if part == ".." {
                if stack.len() <= 1 {
                    return Resolution::Blocked;
                }
                if let Some((watched, crossings)) = trace.as_mut() {
                    crossings.left |= stack.last().map(String::as_str) == Some(*watched);
                }
                stack.pop();
                last_folder = None;
                continue;
            }
            let Some(parent) = stack.last() else {
                return Resolution::Unverified;
            };
            let children = match self.children(parent) {
                Some(children) => children,
                None => return Resolution::Unverified,
            };
            let mut found = children.iter().filter(|node| node.name == *part);
            let Some(node) = found.next() else {
                return Resolution::Missing;
            };
            if found.next().is_some() || stack.contains(&node.node_id) {
                return Resolution::Unverified;
            }
            match node.kind {
                NodeKind::Folder => {
                    if let Some((watched, crossings)) = trace.as_mut() {
                        crossings.entered_by_name |= node.node_id == *watched;
                    }
                    stack.push(node.node_id.clone());
                    last_folder = Some(node.clone());
                }
                NodeKind::File if index + 1 == parts.len() => {
                    return Resolution::Available { node: node.clone() }
                }
                NodeKind::File => return Resolution::Missing,
            }
        }
        if let Some(node) = last_folder {
            return Resolution::Available { node };
        }
        // "." and ".." resolve to a folder even when no named segment was read.
        Resolution::Folder
    }

    fn children(&mut self, parent: &str) -> Option<&[Node]> {
        if !self.folders.contains_key(parent) {
            if self.folders.len() == MAX_FOLDERS
                || self.started.elapsed() >= Duration::from_secs(15)
            {
                return None;
            }
            let list = self.workspace.list(&json!({"accountId":self.scope.account_id,"rootId":self.scope.root_id,"parentId":parent}))
                .ok().and_then(|value| serde_json::from_value(value["items"].clone()).ok());
            self.folders.insert(parent.into(), list);
        }
        self.folders.get(parent)?.as_deref()
    }
}

fn decode_segment(segment: &str) -> Option<String> {
    if segment.is_empty() {
        return None;
    }
    let bytes = segment.as_bytes();
    let mut index = 0;
    let mut decoded = Vec::with_capacity(bytes.len());
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            if !pair.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return None;
            }
            decoded.push(u8::from_str_radix(pair, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let value = String::from_utf8(decoded).ok()?;
    (!value.is_empty()
        && value.len() <= 1024
        && !value.contains(['/', '\\', ':'])
        && !value.chars().any(char::is_control)
        && !super::super::path_policy::reserved(std::ffi::OsStr::new(&value)))
    .then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proton_incoming_references_use_verified_paths_and_never_fetch_external_links() {
        let temporary = tempfile::tempdir().unwrap();
        let root = json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"});
        let target = json!({"nodeId":"vol~target","name":"Destino.md","type":"file","revisionId":"vol~target~rev"});
        let source = json!({"nodeId":"vol~source","name":"Origen.md","type":"file","revisionId":"vol~source~rev"});
        let invoke = |_: &str, command: &str, body: Value| match command {
            "drive.workspaceFolder" => Ok(root.clone()),
            "drive.workspaceList" => Ok(json!({"items":[target,source],"complete":true})),
            "drive.workspaceRead" => {
                let (node, text) = if body["nodeId"] == "vol~source" {
                    (source.clone(), "[Nota](Destino.md)\n[Web](https://private.invalid/Destino.md)\n[Fuera](../Destino.md)")
                } else {
                    (target.clone(), "# Destino")
                };
                Ok(
                    json!({"revisionId":node["revisionId"],"node":node,"contentBase64":BASE64.encode(text),"ancestorIds":["vol~root"]}),
                )
            }
            _ => panic!("Unexpected external fetch or mutation {command}"),
        };
        let workspace = Workspace {
            directory: temporary.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        let body = json!({"accountId":"account","rootId":"vol~root","nodeId":"vol~target","revisionId":"vol~target~rev"});
        workspace.handle("select", body.clone()).unwrap();
        let result = workspace.handle("incoming-references", body).unwrap();
        assert_eq!(result["references"].as_array().unwrap().len(), 1);
        assert_eq!(result["references"][0]["node"], source);
        assert_eq!(result["references"][0]["line"], 1);
        assert_eq!(result["partial"], false);
    }

    #[test]
    fn proton_workspace_references_never_search_outside_root_or_fetch_external_links() {
        let temporary = tempfile::tempdir().unwrap();
        let root = json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"});
        let source = json!({"nodeId":"vol~source","name":"Origen.md","type":"file","revisionId":"vol~source~rev"});
        let asset = json!({"nodeId":"vol~asset","name":"A B.png","type":"file","revisionId":"vol~asset~rev"});
        let invoke = |_: &str, command: &str, body: Value| match command {
            "drive.workspaceFolder" => Ok(root.clone()),
            "drive.workspaceRead" => Ok(
                json!({"node":source,"revisionId":"vol~source~rev","ancestorIds":["vol~root"],
                "contentBase64":BASE64.encode("![Foto](A%20B.png)\n[Perdido](../private.pdf)\n[Web](https://somewhere.invalid/a)\n[No existe](other.pdf)\n[Separador](dir%2Fnote.md)") } ),
            ),
            "drive.workspaceList" => {
                assert_eq!(body["parentId"], "vol~root");
                assert_eq!(body["rootId"], "vol~root");
                Ok(json!({"items":[asset],"complete":true}))
            }
            _ => panic!("Unexpected call {command}"),
        };
        let workspace = Workspace {
            directory: temporary.path().join("workspace"),
            invoke: &invoke,
            can_write: true,
        };
        let body = json!({"accountId":"account","rootId":"vol~root","nodeId":"vol~source","revisionId":"vol~source~rev"});
        workspace.handle("select", body.clone()).unwrap();
        let reply = workspace.handle("references", body).unwrap();
        let refs = reply["references"].as_array().unwrap();
        let statuses: Vec<_> = refs
            .iter()
            .map(|item| item["status"].as_str().unwrap())
            .collect();
        assert_eq!(
            statuses,
            ["available", "blocked", "external", "missing", "blocked"]
        );
        assert_eq!(refs[0]["node"], asset);
        assert_eq!(refs[3]["line"], 4);
        assert_eq!(reply["partial"], false);
    }
}
