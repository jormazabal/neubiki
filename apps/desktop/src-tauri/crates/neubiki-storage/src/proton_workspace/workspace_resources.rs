use super::*;
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopedNode {
    #[serde(flatten)]
    node: Node,
    ancestor_ids: Vec<String>,
}

impl Workspace<'_> {
    pub(super) fn resource_catalog(&self, body: &Value) -> Result<Value> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        let selection = self
            .selection()?
            .filter(|item| item.account_id == account && item.root.node_id == root)
            .ok_or_else(Error::generation)?;
        let started = Instant::now();
        let mut queue = VecDeque::from([vec![selection.root]]);
        let mut seen = BTreeSet::from([root.to_string()]);
        let mut resources = Vec::new();
        let mut folders = 0;
        let mut nodes = 0;
        let mut partial = false;
        'scan: while let Some(parents) = queue.pop_front() {
            if folders == 16 || started.elapsed() >= Duration::from_secs(15) {
                partial = true;
                break;
            }
            let parent = parents.last().ok_or_else(Error::invalid_response)?;
            let list = match self
                .list(&json!({"accountId":account,"rootId":root,"parentId":parent.node_id}))
            {
                Ok(list) => list,
                Err(_) => {
                    partial = true;
                    continue;
                }
            };
            folders += 1;
            let children: Vec<Node> = serde_json::from_value(list["items"].clone())
                .map_err(|_| Error::invalid_response())?;
            for node in children {
                if !seen.insert(node.node_id.clone())
                    || super::super::path_policy::reserved(std::ffi::OsStr::new(&node.name))
                {
                    continue;
                }
                nodes += 1;
                if nodes > 10_000
                    || resources.len() == 200
                    || started.elapsed() >= Duration::from_secs(15)
                {
                    partial = true;
                    break 'scan;
                }
                if node.kind == NodeKind::Folder {
                    if parents.len() >= 32 || folders + queue.len() >= 16 {
                        partial = true;
                        continue;
                    }
                    let mut next = parents.clone();
                    next.push(node);
                    queue.push_back(next);
                } else {
                    resources.push(
                        json!({"kind":resource_kind(&node.name),"node":node,"parents":parents}),
                    );
                }
            }
        }
        self.check_selection(account, root)?;
        Ok(json!({"resources":resources,"partial":partial,"scannedFolders":folders,"checkedAt":neubiki_core::now_iso()}))
    }

    pub(super) fn reference_impact(&self, body: &Value) -> Result<Value> {
        let scope: DocumentScope = parse_input(body)?;
        let document = self.document(&scope)?;
        let folder_target = match body["nodeKind"].as_str() {
            Some("folder") => true,
            Some(_) => return Err(Error::input()),
            None if body["nodeKind"].is_null() => false,
            None => return Err(Error::input()),
        };
        let revision = if folder_target {
            if !body["revisionId"].is_null() || scope.node_id == scope.root_id {
                return Err(Error::input());
            }
            None
        } else {
            let revision = token(body, "revisionId")?;
            if !valid_revision(&scope.node_id, revision) {
                return Err(Error::input());
            }
            Some(revision)
        };
        let parent = token(body, "parentId")?;
        let name = body["expectedName"]
            .as_str()
            .filter(|value| !value.is_empty() && value.len() <= 1024)
            .ok_or_else(Error::input)?;
        let action = body["action"]
            .as_str()
            .filter(|action| matches!(*action, "rename" | "move"))
            .ok_or_else(Error::input)?;
        let stat = || -> Result<ScopedNode> {
            let operation = if folder_target { "drive.workspaceFolderStat" } else { "drive.workspaceFileStat" };
            let kind = if folder_target { NodeKind::Folder } else { NodeKind::File };
            let target: ScopedNode = self.provider(
                &scope.account_id,
                operation,
                document.request(),
            )?;
            validate_node(&target.node)?;
            let ids = &target.ancestor_ids;
            if target.node.node_id != scope.node_id
                || target.node.kind != kind
                || target.node.name != name
                || target.node.revision_id.as_deref() != revision
                || ids.is_empty()
                || ids.len() > 128
                || ids.first() != Some(&scope.root_id)
                || ids.last().map(String::as_str) != Some(parent)
                || ids
                    .iter()
                    .any(|id| !valid_token(id) || id == &scope.node_id)
                || ids.iter().collect::<BTreeSet<_>>().len() != ids.len()
            {
                return Err(Error::generation());
            }
            Ok(target)
        };
        let before = stat()?;
        let mut result = self.scan_reference_impact(&document, folder_target, action == "move")?;
        if !folder_target && action == "move" && is_markdown(name) {
            let source = self.references(&document, body)?;
            if source["partial"] == true {
                result["partial"] = json!(true);
            }
            if let Some(links) = source["references"].as_array() {
                result["outgoing"] = json!(
                    links
                        .iter()
                        .filter(|link| {
                            !matches!(link["status"].as_str(), Some("anchor" | "external"))
                        })
                        .collect::<Vec<_>>()
                );
            }
        }
        let after = stat()?;
        if before.ancestor_ids != after.ancestor_ids {
            return Err(Error::generation());
        }
        self.check_selection(&scope.account_id, &scope.root_id)?;
        result["node"] = serde_json::to_value(after.node).map_err(|_| Error::invalid_response())?;
        result["revisionId"] = json!(revision);
        result["action"] = json!(action);
        result["checkedAt"] = json!(neubiki_core::now_iso());
        Ok(result)
    }
}

fn resource_kind(name: &str) -> &'static str {
    match name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("md" | "markdown" | "mdown") => "markdown",
        Some("nbnote" | "knote") => "handwritten",
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg") => "image",
        Some("mp3" | "wav" | "ogg" | "flac" | "m4a") => "audio",
        Some("mp4" | "webm") => "video",
        Some("pdf") => "pdf",
        Some("docx") => "docx",
        Some("xlsx") => "xlsx",
        Some("txt" | "csv" | "tsv" | "log" | "json") => "text",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn proton_resource_catalog_is_metadata_only_scoped_and_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let root = json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"});
        let invoke = |_: &str, command: &str, request: Value| match command {
            "drive.workspaceFolder" => Ok(root.clone()),
            "drive.workspaceList" => {
                assert_eq!(request["rootId"], "vol~root");
                Ok(
                    json!({"complete":true,"items":(0..201).map(|index| json!({"nodeId":format!("vol~file{index}"),"name":format!("Audio{index}.mp3"),"type":"file","revisionId":format!("vol~file{index}~rev")})).collect::<Vec<_>>()}),
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
        let result = workspace
            .resource_catalog(&json!({"accountId":"account","rootId":"vol~root"}))
            .unwrap();
        assert_eq!(result["partial"], true);
        assert_eq!(result["resources"].as_array().unwrap().len(), 200);
        assert_eq!(result["resources"][0]["kind"], "audio");
        assert!(workspace
            .resource_catalog(&json!({"accountId":"other","rootId":"vol~root"}))
            .is_err());
    }

    #[test]
    fn proton_reference_impact_checks_file_ancestry_revision_and_actual_occurrences() {
        let temp = tempfile::tempdir().unwrap();
        let root = json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"});
        let target = json!({"nodeId":"vol~asset","name":"Clip.mp4","type":"file","revisionId":"vol~asset~rev","ancestorIds":["vol~root"]});
        let source = json!({"nodeId":"vol~source","name":"Origen.md","type":"file","revisionId":"vol~source~rev"});
        let moved = Cell::new(false);
        let invoke = |_: &str, command: &str, request: Value| match command {
            "drive.workspaceFolder" => Ok(root.clone()),
            "drive.workspaceFileStat" => {
                let mut node = target.clone();
                if moved.get() {
                    node["ancestorIds"] = json!(["vol~root", "vol~folder"]);
                }
                Ok(node)
            }
            "drive.workspaceList" => Ok(json!({"complete":true,"items":[target,source]})),
            "drive.workspaceRead" => {
                assert_eq!(request["nodeId"], "vol~source");
                Ok(
                    json!({"node":source,"revisionId":"vol~source~rev","ancestorIds":["vol~root"],"contentBase64":BASE64.encode("[Uno](Clip.mp4)\n[Dos](Clip.mp4)\n[Externo](https://private.invalid/Clip.mp4)")}),
                )
            }
            _ => panic!("Unexpected mutation or external fetch {command}"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        workspace
            .handle("select", json!({"accountId":"account","rootId":"vol~root"}))
            .unwrap();
        let request = json!({"accountId":"account","rootId":"vol~root","nodeId":"vol~asset","parentId":"vol~root","revisionId":"vol~asset~rev","expectedName":"Clip.mp4","action":"rename"});
        let result = workspace.reference_impact(&request).unwrap();
        assert_eq!(result["references"].as_array().unwrap().len(), 2);
        assert_eq!(result["references"][1]["line"], 2);
        assert_eq!(result["references"][1]["target"], "Clip.mp4");
        assert_eq!(result["partial"], false);
        moved.set(true);
        assert!(workspace.reference_impact(&request).is_err());
    }

    #[test]
    fn proton_folder_reference_impact_reviews_only_relative_links_crossing_the_changed_path() {
        let temp = tempfile::tempdir().unwrap();
        let root = json!({"nodeId":"vol~root","name":"Project","type":"folder"});
        let folder = json!({"nodeId":"vol~folder","name":"Cases","type":"folder"});
        let inside = json!({"nodeId":"vol~inside","name":"Inside.md","type":"file","revisionId":"vol~inside~rev"});
        let outside = json!({"nodeId":"vol~outside","name":"Outside.md","type":"file","revisionId":"vol~outside~rev"});
        let invoke = |_: &str, command: &str, request: Value| match command {
            "drive.workspaceFolder" => Ok(root.clone()),
            "drive.workspaceFolderStat" => {
                assert_eq!(request["nodeId"], "vol~folder");
                let mut target = folder.clone();
                target["ancestorIds"] = json!(["vol~root"]);
                Ok(target)
            }
            "drive.workspaceList" if request["parentId"] == "vol~root" => {
                Ok(json!({"complete":true,"items":[folder,outside]}))
            }
            "drive.workspaceList" => {
                assert_eq!(request["parentId"], "vol~folder");
                Ok(json!({"complete":true,"items":[inside]}))
            }
            "drive.workspaceRead" => {
                let (node, ancestors, text) = if request["nodeId"] == "vol~inside" {
                    (&inside, vec!["vol~root","vol~folder"], "[Self](Inside.md)\n[Outside](../Outside.md)\n[Back](../Cases/Inside.md)")
                } else {
                    assert_eq!(request["nodeId"], "vol~outside");
                    (&outside, vec!["vol~root"], "[Inside](Cases/Inside.md)\n[Folder](Cases)\n[External](https://example.invalid/Cases/Inside.md)")
                };
                Ok(json!({"node":node,"revisionId":node["revisionId"],"ancestorIds":ancestors,"contentBase64":BASE64.encode(text)}))
            }
            _ => panic!("Unexpected write or external access {command}"),
        };
        let workspace = Workspace { directory: temp.path().join("workspace"), invoke: &invoke, can_write: false };
        workspace.handle("select", json!({"accountId":"account","rootId":"vol~root"})).unwrap();
        let mut body = json!({"accountId":"account","rootId":"vol~root","nodeId":"vol~folder","parentId":"vol~root","nodeKind":"folder","expectedName":"Cases","action":"move"});
        let moving = workspace.reference_impact(&body).unwrap();
        assert_eq!(moving["partial"], false);
        assert!(moving["revisionId"].is_null());
        assert_eq!(moving["references"].as_array().unwrap().len(), 2);
        assert_eq!(moving["outgoing"].as_array().unwrap().len(), 2);
        assert_eq!(moving["outgoing"][0]["target"], "../Outside.md");
        assert_eq!(moving["outgoing"][0]["sourceName"], "Inside.md");
        body["action"] = json!("rename");
        let renaming = workspace.reference_impact(&body).unwrap();
        assert_eq!(renaming["references"].as_array().unwrap().len(), 3);
        assert!(renaming["outgoing"].as_array().unwrap().is_empty());
    }
}
