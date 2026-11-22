use super::ai_sources::{AiSource, AiSourceRef};
use super::*;
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

pub(crate) const MAX_PROJECT_CANDIDATES: usize = 32;
const MAX_FOLDERS: usize = 48;
const MAX_DEPTH: usize = 32;
const MAX_NODES: usize = 10_000;
const SCAN_BUDGET: Duration = Duration::from_secs(25);

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticProjectCoverage {
    pub scanned_folders: usize,
    pub eligible_files: usize,
    pub unsupported_files: usize,
    pub unavailable_files: usize,
    pub omitted_files: usize,
    pub failed_folders: usize,
    pub limited: bool,
}

pub(crate) struct SemanticProjectScan {
    pub coverage: SemanticProjectCoverage,
    pub sources: Vec<(AiSourceRef, AiSource)>,
}

impl LocalApi {
    pub(crate) fn scan_proton_semantic_project(
        &self,
        body: &Value,
    ) -> std::result::Result<SemanticProjectScan, String> {
        self.with_proton_workspace(|workspace| workspace.scan_semantic_project(body))
            .map_err(|error| error.detail)
    }

    pub(crate) fn read_proton_semantic_project_sources(
        &self,
        body: &Value,
        references: &[AiSourceRef],
    ) -> std::result::Result<Vec<AiSource>, String> {
        self.with_proton_workspace(|workspace| {
            let scope: DocumentScope = parse_input(body)?;
            let sources = references
                .iter()
                .map(|reference| workspace.assistant_source(&scope, reference, None))
                .collect::<Result<Vec<_>>>()?;
            workspace.check_selection(&scope.account_id, &scope.root_id)?;
            Ok(sources)
        })
        .map_err(|error: Error| error.detail)
    }
}

impl Workspace<'_> {
    fn scan_semantic_project(&self, body: &Value) -> Result<SemanticProjectScan> {
        let scope: DocumentScope = parse_input(body)?;
        self.document(&scope)?;
        let mut coverage = SemanticProjectCoverage::default();
        let mut sources = Vec::new();
        let mut folders = VecDeque::from([(scope.root_id.clone(), 0)]);
        let mut visited = BTreeSet::from([scope.root_id.clone()]);
        let started = Instant::now();
        let mut attempts = 0;
        'scan: while let Some((folder, depth)) = folders.pop_front() {
            if coverage.scanned_folders + coverage.failed_folders >= MAX_FOLDERS
                || started.elapsed() >= SCAN_BUDGET
            {
                coverage.limited = true;
                break;
            }
            self.check_selection(&scope.account_id, &scope.root_id)?;
            let listing = self.list(&json!({
                "accountId":scope.account_id,"rootId":scope.root_id,"parentId":folder
            }));
            let mut children: Vec<Node> = match listing {
                Ok(items) => serde_json::from_value(items["items"].clone())
                    .map_err(|_| Error::invalid_response())?,
                Err(error) if depth == 0 => return Err(error),
                Err(_) => {
                    coverage.failed_folders += 1;
                    continue;
                }
            };
            coverage.scanned_folders += 1;
            children.sort_unstable_by(|a, b| {
                a.name.cmp(&b.name).then_with(|| a.node_id.cmp(&b.node_id))
            });
            for node in children {
                if visited.len() >= MAX_NODES || started.elapsed() >= SCAN_BUDGET {
                    coverage.limited = true;
                    break 'scan;
                }
                if !visited.insert(node.node_id.clone()) {
                    coverage.limited = true;
                    continue;
                }
                if node.kind == NodeKind::Folder {
                    if depth >= MAX_DEPTH {
                        coverage.limited = true;
                    } else {
                        folders.push_back((node.node_id, depth + 1));
                    }
                    continue;
                }
                if !text_format(&node.name) {
                    coverage.unsupported_files += 1;
                    continue;
                }
                coverage.eligible_files += 1;
                if attempts >= MAX_PROJECT_CANDIDATES {
                    coverage.omitted_files += 1;
                    continue;
                }
                let Some(revision_id) = node.revision_id else {
                    coverage.unavailable_files += 1;
                    continue;
                };
                attempts += 1;
                let reference = AiSourceRef {
                    node_id: node.node_id,
                    revision_id,
                };
                match self.assistant_source(&scope, &reference, None) {
                    Ok(source) if source.name == node.name => sources.push((reference, source)),
                    _ => coverage.unavailable_files += 1,
                }
            }
        }
        self.check_selection(&scope.account_id, &scope.root_id)?;
        Ok(SemanticProjectScan { sources, coverage })
    }
}

fn text_format(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, extension)| {
        matches!(
            extension.to_ascii_lowercase().as_str(),
            "md" | "markdown"
                | "mdown"
                | "txt"
                | "csv"
                | "tsv"
                | "log"
                | "json"
                | "pdf"
                | "docx"
                | "xlsx"
                | "nbnote"
                | "knote"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn proton_semantic_project_reaches_nested_saved_files_and_requires_exact_revisions() {
        let temp = tempfile::tempdir().unwrap();
        let reads = RefCell::new(Vec::new());
        let provider = |_: &str, action: &str, request: Value| match action {
            "drive.workspaceFolder" => Ok(folder("root", "Proyecto")),
            "drive.workspaceList" => {
                assert_eq!(request["rootId"], "volume~root");
                let items = match request["parentId"].as_str().unwrap() {
                    "volume~root" => vec![
                        file("unsent", "Imagen.png"),
                        folder("nested", "Carpeta"),
                        file("private", ".neubiki-export-profiles.json"),
                        file("active", "Documento activo.md"),
                    ],
                    "volume~nested" => {
                        vec![file("related", "Acta.md"), file("changed", "Carta.md")]
                    }
                    _ => panic!("Unexpected folder"),
                };
                Ok(json!({"items":items,"complete":true}))
            }
            "drive.workspaceRead" => {
                let node_id = request["nodeId"].as_str().unwrap();
                let (_, id) = node_id.split_once('~').unwrap();
                assert_eq!(request["expectedRevisionId"], format!("{node_id}~saved"));
                reads.borrow_mut().push(id.to_owned());
                let node = match id {
                    "active" => file(id, "Documento activo.md"),
                    "related" => file(id, "Acta.md"),
                    "changed" => json!({"nodeId":node_id,"name":"Carta.md","type":"file",
                        "revisionId":format!("{node_id}~different")}),
                    _ => panic!("Unsupported or private metadata reached the reader"),
                };
                Ok(
                    json!({"node":node,"revisionId":node["revisionId"],"ancestorIds":["volume~root"],
                    "contentBase64":BASE64.encode("Presupuesto para la renovación del edificio")}),
                )
            }
            _ => panic!("Unexpected operation"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &provider,
            can_write: false,
        };
        workspace
            .handle(
                "select",
                json!({"accountId":"account","rootId":"volume~root"}),
            )
            .unwrap();
        let scan = workspace.scan_semantic_project(&json!({
            "accountId":"account","rootId":"volume~root","nodeId":"volume~active","query":"Costes"
        })).unwrap();
        assert_eq!(*reads.borrow(), ["active", "related", "changed"]);
        assert_eq!(scan.coverage.scanned_folders, 2);
        assert_eq!(scan.coverage.eligible_files, 3);
        assert_eq!(scan.coverage.unsupported_files, 1);
        assert_eq!(scan.coverage.unavailable_files, 1);
        assert_eq!(scan.coverage.omitted_files, 0);
        assert!(!scan.coverage.limited);
        assert_eq!(scan.sources[1].0.revision_id, "volume~related~saved");
        assert_eq!(scan.sources[1].1.name, "Acta.md");
    }

    fn folder(id: &str, name: &str) -> Value {
        json!({"nodeId":format!("volume~{id}"),"name":name,"type":"folder"})
    }

    fn file(id: &str, name: &str) -> Value {
        json!({"nodeId":format!("volume~{id}"),"name":name,"type":"file",
            "revisionId":format!("volume~{id}~saved")})
    }
}
