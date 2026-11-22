use super::*;
mod content_index;
use content_index::ContentIndex;
use std::{
    collections::VecDeque,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

const MAX_FOLDERS: usize = 48;
const MAX_DOCUMENTS: usize = 32;
const MAX_NODES: usize = 10_000;
const MAX_RESULTS: usize = 100;
const MAX_DEPTH: usize = 32;
const SMALL_READ_BYTES: usize = 2 * 1024 * 1024;
const MAX_READ_BYTES: usize = 8 * 1024 * 1024;
const MAX_STRUCTURED_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_SEARCH_BYTES: usize = 32 * 1024 * 1024;
const MAX_CACHE_BYTES: usize = 32 * 1024 * 1024;
static SEARCH_GATE: Mutex<()> = Mutex::new(());
static CONTENT_CACHE: OnceLock<Mutex<VecDeque<CachedContent>>> = OnceLock::new();

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TextPart {
    page_number: Option<usize>,
    page_id: Option<String>,
    sheet_id: Option<String>,
    row: Option<u64>,
    column: Option<u64>,
    text: String,
}

struct CachedContent {
    key: String,
    loaded: Instant,
    parts: Arc<Vec<TextPart>>,
    bytes: usize,
}

fn search_kind(name: &str) -> Option<&'static str> {
    let extension = name.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match extension.as_str() {
        "md" | "markdown" | "mdown" => "markdown",
        "nbnote" | "knote" => "handwritten",
        "pdf" => "pdf",
        "docx" => "docx",
        "xlsx" => "xlsx",
        "txt" | "csv" | "tsv" | "log" | "json" => "text",
        _ => return None,
    })
}

fn extracted_text_limit(kind: &str) -> usize {
    if matches!(kind, "markdown" | "text") {
        MAX_READ_BYTES
    } else {
        MAX_STRUCTURED_TEXT_BYTES
    }
}

fn search_budget_exhausted() -> Error {
    Error::new(413, "proton-search-read-budget", "La búsqueda alcanzó su límite de lectura.")
}

fn extract_content(kind: &str, bytes: &[u8]) -> Result<Vec<TextPart>> {
    let plain = |text| TextPart {
        page_number: None,
        page_id: None,
        sheet_id: None,
        row: None,
        column: None,
        text,
    };
    let failed = |_| {
        Error::new(
            422,
            "proton-search-text-unavailable",
            "No se pudo obtener texto verificable de este archivo.",
        )
    };
    match kind {
        "pdf" => neubiki_docs::extract_pdf_pages_bounded(bytes, MAX_STRUCTURED_TEXT_BYTES)
            .map_err(failed)
            .map(|pages| {
                pages
                    .into_iter()
                    .map(|(number, text)| TextPart {
                        page_number: Some(number),
                        page_id: None,
                        sheet_id: None,
                        row: None,
                        column: None,
                        text,
                    })
                    .collect()
            }),
        "xlsx" => neubiki_docs::xlsx_search_cells(bytes)
            .map_err(failed)
            .map(|cells| {
                cells
                    .into_iter()
                    .map(|cell| TextPart {
                        page_number: None,
                        page_id: None,
                        sheet_id: cell["sheetId"].as_str().map(str::to_owned),
                        row: cell["row"].as_u64(),
                        column: cell["column"].as_u64(),
                        text: cell["text"].as_str().unwrap_or_default().to_owned(),
                    })
                    .collect()
            }),
        "docx" => neubiki_docs::extract_office_body_text_bounded(bytes, MAX_STRUCTURED_TEXT_BYTES)
            .map_err(failed)
            .map(|text| vec![plain(text)]),
        "handwritten" => {
            let text = std::str::from_utf8(bytes).map_err(|_| Error::invalid_response())?;
            super::super::local_search::note_text_pages(text)
                .map_err(|_| Error::invalid_response())
                .map(|pages| {
                    pages
                        .into_iter()
                        .map(|(number, id, text)| TextPart {
                            page_number: Some(number),
                            page_id: Some(id),
                            sheet_id: None,
                            row: None,
                            column: None,
                            text,
                        })
                        .collect()
                })
        }
        _ => String::from_utf8(bytes.to_vec())
            .map(|text| vec![plain(text)])
            .map_err(|_| Error::invalid_response()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchMatch {
    node: Node,
    parents: Vec<Node>,
    line: Option<usize>,
    excerpt: Option<String>,
    page_number: Option<usize>,
    page_id: Option<String>,
    sheet_id: Option<String>,
    row: Option<u64>,
    column: Option<u64>,
}

impl Workspace<'_> {
    pub(super) fn search(&self, body: &Value) -> Result<Value> {
        let account = token(body, "accountId")?;
        let root = token(body, "rootId")?;
        let query = body["query"]
            .as_str()
            .map(str::trim)
            .filter(|query| {
                !query.is_empty() && query.len() <= 512 && !query.chars().any(char::is_control)
            })
            .ok_or_else(Error::input)?
            .to_lowercase();
        let content = match body["mode"].as_str() {
            Some("files") => false,
            Some("content") => true,
            _ => return Err(Error::input()),
        };
        let filter = body["fileType"].as_str().unwrap_or("all");
        if !matches!(
            filter,
            "all" | "markdown" | "handwritten" | "pdf" | "docx" | "xlsx" | "text"
        ) {
            return Err(Error::input());
        }
        let selection = self
            .selection()?
            .filter(|selection| selection.account_id == account && selection.root.node_id == root)
            .ok_or_else(|| {
                Error::new(
                    409,
                    "proton-workspace-changed",
                    "La carpeta de trabajo cambió. Vuelve a abrir Buscar.",
                )
            })?;
        let _search = SEARCH_GATE.try_lock().map_err(|_| {
            Error::new(
                409,
                "proton-search-busy",
                "Todavía se está completando otra búsqueda. Vuelve a intentarlo.",
            )
        })?;
        let mut saved_index = if content { self.read_content_index(account, root).ok().flatten() } else { None };

        let mut initial = vec![selection.root];
        if !body["folderId"].is_null() {
            let folder_id = token(body, "folderId")?;
            if folder_id != root {
                let folder: Node = self.provider(
                    account,
                    "drive.workspaceFolder",
                    json!({"rootId":folder_id,"scopeRootId":root}),
                )?;
                validate_node(&folder)?;
                if folder.node_id != folder_id || folder.kind != NodeKind::Folder {
                    return Err(Error::invalid_response());
                }
                initial.push(folder);
            }
        }
        let mut visited: BTreeSet<String> =
            initial.iter().map(|node| node.node_id.clone()).collect();
        let mut queue = VecDeque::from([initial]);
        let mut results = Vec::new();
        let mut folders = 0;
        let mut documents = 0;
        let mut nodes = 0;
        let mut failures = 0;
        let mut oversized = 0;
        let mut limited = false;
        let mut read_bytes = 0;
        let mut cache_hits = 0;
        let mut without_text = 0;
        let started = Instant::now();

        'scan: while let Some(parents) = queue.pop_front() {
            if folders == MAX_FOLDERS || started.elapsed() >= Duration::from_secs(20) {
                limited = true;
                break;
            }
            self.check_selection(account, root)?;
            let parent = parents.last().ok_or_else(Error::invalid_response)?;
            let list = match self
                .list(&json!({"accountId":account,"rootId":root,"parentId":parent.node_id}))
            {
                Ok(list) => list,
                Err(error) if folders == 0 => return Err(error),
                Err(_) => {
                    failures += 1;
                    continue;
                }
            };
            folders += 1;
            let mut children: Vec<Node> = serde_json::from_value(list["items"].clone())
                .map_err(|_| Error::invalid_response())?;
            children.sort_unstable_by(|left, right| {
                left.name
                    .cmp(&right.name)
                    .then_with(|| left.node_id.cmp(&right.node_id))
            });
            for node in children {
                if super::super::path_policy::reserved(std::ffi::OsStr::new(&node.name))
                    || !visited.insert(node.node_id.clone())
                {
                    continue;
                }
                if nodes == MAX_NODES
                    || results.len() == MAX_RESULTS
                    || started.elapsed() >= Duration::from_secs(20)
                {
                    limited = true;
                    break 'scan;
                }
                nodes += 1;
                let kind = search_kind(&node.name);
                if node.kind == NodeKind::Folder {
                    if parents.len() >= MAX_DEPTH || folders + queue.len() >= MAX_FOLDERS {
                        limited = true;
                    } else {
                        let mut next = parents.clone();
                        next.push(node);
                        queue.push_back(next);
                    }
                } else if filter != "all" && kind != Some(filter) {
                    continue;
                } else if !content && node.name.to_lowercase().contains(&query) {
                    results.push(SearchMatch {
                        node,
                        parents: parents.clone(),
                        line: None,
                        excerpt: None,
                        page_number: None,
                        page_id: None,
                        sheet_id: None,
                        row: None,
                        column: None,
                    });
                } else if content && kind.is_some() {
                    if documents == MAX_DOCUMENTS {
                        limited = true;
                        continue;
                    }
                    documents += 1;
                    match self.search_content(
                        account,
                        root,
                        &node,
                        kind.unwrap(),
                        &mut read_bytes,
                        &mut cache_hits,
                        saved_index.as_mut(),
                    ) {
                        Ok(parts) => {
                            if parts.iter().all(|part| part.text.trim().is_empty()) {
                                without_text += 1;
                            }
                            if let Some((part, line, excerpt)) = parts.iter().find_map(|part| {
                                first_match(&part.text, &query)
                                    .map(|(line, excerpt)| (part, line, excerpt))
                            }) {
                                results.push(SearchMatch {
                                    node,
                                    parents: parents.clone(),
                                    line: Some(line),
                                    excerpt: Some(excerpt),
                                    page_number: part.page_number,
                                    page_id: part.page_id.clone(),
                                    sheet_id: part.sheet_id.clone(),
                                    row: part.row,
                                    column: part.column,
                                });
                            }
                        }
                        Err(error) => match error.code.as_str() {
                            "file-too-large" => {
                                limited = true;
                                oversized += 1;
                            }
                            "proton-search-read-budget" => limited = true,
                            _ => failures += 1,
                        },
                    }
                }
            }
        }

        self.check_selection(account, root)?;
        let mode = match saved_index.as_ref() {
            Some(index) if self.save_content_index(account, root, index).is_ok() => "revision-device",
            _ => "revision-memory",
        };
        Ok(
            json!({"results":results,"partial":limited || failures > 0,"limited":limited,
            "failedReads":failures,"oversizedFiles":oversized,"scannedFolders":folders,"scannedDocuments":documents,
            "withoutText":without_text,"index":{"mode":mode,"reusedDocuments":cache_hits,"readBytes":read_bytes}}),
        )
    }

    fn search_content(
        &self,
        account: &str,
        root: &str,
        node: &Node,
        kind: &str,
        read_bytes: &mut usize,
        cache_hits: &mut usize,
        saved_index: Option<&mut ContentIndex>,
    ) -> Result<Arc<Vec<TextPart>>> {
        let key = json!([
            self.directory,
            account,
            root,
            node.node_id,
            node.revision_id,
            kind
        ])
        .to_string();
        let cache = CONTENT_CACHE.get_or_init(|| Mutex::new(VecDeque::new()));
        if let Some(parts) = cache.lock().ok().and_then(|entries| {
            entries
                .iter()
                .find(|entry| entry.key == key && entry.loaded.elapsed() < Duration::from_secs(600))
                .map(|entry| entry.parts.clone())
        }) {
            *cache_hits += 1;
            if let Some(index) = saved_index {
                index.remember(node, kind, &parts);
            }
            return Ok(parts);
        }
        if let Some(parts) = saved_index.as_ref().and_then(|index| index.find(node, kind)) {
            *cache_hits += 1;
            return Ok(parts);
        }
        let remaining = MAX_SEARCH_BYTES.saturating_sub(*read_bytes);
        let read_limit = if remaining >= MAX_READ_BYTES {
            MAX_READ_BYTES
        } else if remaining >= SMALL_READ_BYTES {
            SMALL_READ_BYTES
        } else {
            return Err(search_budget_exhausted());
        };
        let remote: RemoteRead = self.provider(
            account,
            "drive.workspaceRead",
            json!({
                "accountId":account,"rootId":root,"nodeId":node.node_id,"search":true,
                "expectedRevisionId":node.revision_id,"package":read_limit == MAX_READ_BYTES
            }),
        ).map_err(|error| {
            if error.code == "file-too-large" && read_limit == SMALL_READ_BYTES {
                search_budget_exhausted()
            } else {
                error
            }
        })?;
        if remote.content_base64.len() > read_limit.div_ceil(3) * 4 {
            *read_bytes += read_limit;
            return Err(Error::invalid_response());
        }
        let bytes = BASE64.decode(remote.content_base64).map_err(|_| {
            *read_bytes += read_limit;
            Error::invalid_response()
        })?;
        if bytes.len() > read_limit {
            *read_bytes += read_limit;
            return Err(Error::invalid_response());
        }
        *read_bytes += bytes.len();
        validate_node(&remote.node)?;
        if remote.node.node_id != node.node_id
            || remote.node.kind != NodeKind::File
            || remote.node.name != node.name
            || node.revision_id.as_deref() != Some(remote.revision_id.as_str())
            || remote.node.revision_id.as_deref() != Some(remote.revision_id.as_str())
        {
            return Err(Error::invalid_response());
        }
        let parts = Arc::new(extract_content(kind, &bytes)?);
        let extracted_bytes: usize = parts.iter().map(|part| part.text.len()).sum();
        if extracted_bytes > extracted_text_limit(kind) {
            return Err(Error::invalid_response());
        }
        if let Some(index) = saved_index {
            index.remember(node, kind, &parts);
        }
        if let Ok(mut entries) = cache.lock() {
            let entry_bytes = extracted_bytes + std::mem::size_of::<TextPart>() * parts.len()
                + parts.iter().map(|part| part.page_id.as_ref().map_or(0, String::len)
                    + part.sheet_id.as_ref().map_or(0, String::len)).sum::<usize>();
            while !entries.is_empty()
                && (entries.len() >= 128
                    || entries.iter().map(|entry| entry.bytes).sum::<usize>() + entry_bytes
                        > MAX_CACHE_BYTES)
            {
                entries.pop_front();
            }
            entries.push_back(CachedContent {
                key,
                loaded: Instant::now(),
                parts: parts.clone(),
                bytes: entry_bytes,
            });
        }
        Ok(parts)
    }
}

fn first_match(markdown: &str, lowered_query: &str) -> Option<(usize, String)> {
    markdown.lines().enumerate().find_map(|(index, line)| {
        let folded = line.to_lowercase();
        let offset = folded.find(lowered_query)?;
        let mut folded_bytes = 0;
        let prefix = line
            .chars()
            .take_while(|value| {
                folded_bytes += value.to_lowercase().map(char::len_utf8).sum::<usize>();
                folded_bytes <= offset
            })
            .count()
            .saturating_sub(50);
        let excerpt = line.chars().skip(prefix).take(200).collect::<String>();
        Some((
            index + 1,
            if prefix == 0 {
                excerpt
            } else {
                format!("…{excerpt}")
            },
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io::{Cursor, Write};

    #[test]
    fn proton_search_saved_index_is_opt_in_revision_bound_and_locally_clearable() {
        let temporary = tempfile::tempdir().unwrap();
        let version = Cell::new("vol~memo~r1");
        let reads = Cell::new(0);
        let root = json!({"nodeId":"vol~root","name":"Work","type":"folder"});
        let memo = || json!({"nodeId":"vol~memo","name":"Guide.md","type":"file","revisionId":version.get()});
        let invoke = |_: &str, action: &str, request: Value| match action {
            "drive.workspaceFolder" => Ok(root.clone()),
            "drive.workspaceList" => Ok(json!({"complete":true,"items":[memo()]})),
            "drive.workspaceRead" => {
                assert_eq!(request["expectedRevisionId"], version.get());
                reads.set(reads.get() + 1);
                let text = if version.get().ends_with("r1") { "Alpha" } else { "Beta" };
                Ok(json!({"node":memo(),"revisionId":version.get(),"contentBase64":BASE64.encode(text)}))
            }
            _ => panic!("Unexpected write or off-project access: {action}"),
        };
        let directory = temporary.path().join("workspace");
        let workspace = Workspace { directory: directory.clone(), invoke: &invoke, can_write: false };
        let scope = json!({"accountId":"account","rootId":"vol~root"});
        workspace.handle("select", scope.clone()).unwrap();
        assert_eq!(workspace.handle("content-index-status", scope.clone()).unwrap()["enabled"], false);
        let mut configure = scope.clone();
        configure["enabled"] = json!(true);
        workspace.handle("content-index-configure", configure.clone()).unwrap();
        let mut find = scope.clone();
        find["mode"] = json!("content");
        find["query"] = json!("alpha");
        assert_eq!(workspace.search(&find).unwrap()["index"]["mode"], "revision-device");
        assert_eq!(reads.get(), 1);
        let status = workspace.handle("content-index-status", scope.clone()).unwrap();
        assert_eq!(status["documentCount"], 1);
        assert!(status["byteLength"].as_u64().unwrap() > 0);
        CONTENT_CACHE.get().unwrap().lock().unwrap().clear();
        let reopened = Workspace { directory: directory.clone(), invoke: &invoke, can_write: false };
        assert_eq!(reopened.search(&find).unwrap()["results"][0]["excerpt"], "Alpha");
        assert_eq!(reads.get(), 1);
        version.set("vol~memo~r2");
        assert!(reopened.search(&find).unwrap()["results"].as_array().unwrap().is_empty());
        assert_eq!(reads.get(), 2);
        let marker = directory.join("draft-sentinel");
        fs::write(&marker, b"private draft").unwrap();
        let status = reopened.handle("content-index-clear", scope.clone()).unwrap();
        assert_eq!(status, json!({"enabled":true,"documentCount":0,"byteLength":0}));
        configure["enabled"] = json!(false);
        let status = reopened.handle("content-index-configure", configure).unwrap();
        assert_eq!(status, json!({"enabled":false,"documentCount":0,"byteLength":0}));
        assert_eq!(fs::read(&marker).unwrap(), b"private draft");
    }

    #[test]
    fn proton_search_preserves_exact_workbook_cell_coordinates_and_rejects_excess_cells() {
        let workbook = |cells: &str| {
            let mut package = zip::ZipWriter::new(Cursor::new(Vec::new()));
            for (name, xml) in [
                (
                    "xl/workbook.xml",
                    r#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Totals" sheetId="2" r:id="rId2"/></sheets></workbook>"#,
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    r#"<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>"#,
                ),
                ("xl/worksheets/sheet2.xml", cells),
            ] {
                package
                    .start_file(name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                package.write_all(xml.as_bytes()).unwrap();
            }
            package.finish().unwrap().into_inner()
        };
        let bytes = workbook(
            r#"<worksheet><sheetData><row><c r="AA101" t="inlineStr"><is><t>Revised total</t></is></c></row></sheetData></worksheet>"#,
        );
        let parts = extract_content("xlsx", &bytes).unwrap();
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].sheet_id.as_deref(), Some("sheet-2"));
        assert_eq!(parts[0].row, Some(101));
        assert_eq!(parts[0].column, Some(27));
        assert_eq!(parts[0].text, "Revised total");
        let mut xml = String::from("<worksheet><sheetData>");
        for row in 1..=10_001 {
            xml.push_str(&format!(r#"<row><c r="A{row}"><v>1</v></c></row>"#));
        }
        xml.push_str("</sheetData></worksheet>");
        assert!(extract_content("xlsx", &workbook(&xml)).is_err());
    }

    #[test]
    fn proton_search_reports_source_line_and_bounded_excerpt() {
        let markdown = format!(
            "# Título\n{}Árbol y carpeta{}",
            "x".repeat(300),
            "x".repeat(300)
        );
        let (line, excerpt) = first_match(&markdown, "árbol").unwrap();
        assert_eq!(line, 2);
        assert!(excerpt.contains("Árbol"));
        assert!(excerpt.chars().count() <= 201);
    }

    #[test]
    fn proton_search_extracts_text_and_live_note_pages_without_metadata_or_removed_page_text() {
        assert_eq!(search_kind("Apunte.nbnote"), Some("handwritten"));
        assert_eq!(search_kind("Antigua.knote"), Some("handwritten"));
        assert_eq!(search_kind("Acta.DOCX"), Some("docx"));
        let mut note = super::super::super::default_handwritten_note("search-note", "hidden-title");
        let page = note["pages"][0]["id"].as_str().unwrap().to_string();
        note["ocr"]["textByPage"] =
            json!({(page.clone()):"Acuerdo revisado", "removed":"orphan-canary"});
        let parts = extract_content("handwritten", &serde_json::to_vec(&note).unwrap()).unwrap();
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].page_number, Some(1));
        assert_eq!(parts[0].page_id.as_deref(), Some(page.as_str()));
        assert_eq!(parts[0].text, "Acuerdo revisado");
        assert!(extract_content("text", &[0xff]).is_err());
    }

    #[test]
    fn proton_search_is_scoped_and_never_claims_complete_coverage_after_a_failed_read() {
        let root = "volume~root";
        let a = "volume~a";
        let b = "volume~b";
        let calls = Cell::new(0);
        let temp = tempfile::tempdir().unwrap();
        let folder = json!({"nodeId":root,"name":"Carpeta","type":"folder"});
        let first = json!({"nodeId":a,"name":"A.mdown","type":"file","revisionId":"volume~a~base"});
        let second = json!({"nodeId":b,"name":"B.md","type":"file","revisionId":"volume~b~base"});
        let invoke = |account: &str, operation: &str, body: Value| {
            assert_eq!(account, "acct");
            assert_eq!(body["rootId"], root);
            calls.set(calls.get() + 1);
            match operation {
                "drive.workspaceFolder" => Ok(folder.clone()),
                "drive.workspaceList" => Ok(json!({"complete":true,"items":[second, first]})),
                "drive.workspaceRead" if body["nodeId"] == a => {
                    assert_eq!(body["search"], true);
                    Ok(
                        json!({"node":first,"revisionId":"volume~a~base","contentBase64":BASE64.encode("Inicio\nÁRBOL") }),
                    )
                }
                "drive.workspaceRead" if body["nodeId"] == b => Ok(Value::Null),
                other => panic!("unexpected provider operation: {other}"),
            }
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        workspace
            .handle("select", json!({"accountId":"acct","rootId":root}))
            .unwrap();
        let denied = json!({"accountId":"other","rootId":root,"query":"árbol","mode":"content"});
        assert_eq!(workspace.handle("search", denied).unwrap_err().status, 409);
        assert_eq!(calls.get(), 1);
        let request = json!({"accountId":"acct","rootId":root,"query":"árbol","mode":"content"});
        let result = workspace.handle("search", request).unwrap();
        assert_eq!(result["partial"], true);
        assert_eq!(result["failedReads"], 1);
        assert_eq!(result["results"][0]["node"]["nodeId"], a);
        assert_eq!(result["results"][0]["line"], 2);
        let repeated = workspace
            .handle(
                "search",
                json!({"accountId":"acct","rootId":root,"query":"árbol","mode":"content"}),
            )
            .unwrap();
        assert_eq!(repeated["index"]["reusedDocuments"], 1);
        assert_eq!(repeated["index"]["readBytes"], 0);
        let filtered = workspace.handle("search", json!({"accountId":"acct","rootId":root,"query":"árbol","mode":"content","fileType":"pdf"})).unwrap();
        assert_eq!(filtered["scannedDocuments"], 0);
    }

    #[test]
    fn proton_search_reads_large_verified_text_and_reports_out_of_limit_files_separately() {
        let temporary = tempfile::tempdir().unwrap();
        let folder = json!({"nodeId":"vol~root","name":"Proyecto","type":"folder"});
        let available = json!({"nodeId":"vol~a","name":"A.md","type":"file","revisionId":"vol~a~r1"});
        let oversized = json!({"nodeId":"vol~b","name":"B.pdf","type":"file","revisionId":"vol~b~r1"});
        let text = format!("{}\nCoincidencia al final", "x".repeat(SMALL_READ_BYTES));
        let invoke = |_: &str, command: &str, body: Value| match command {
            "drive.workspaceFolder" => Ok(folder.clone()),
            "drive.workspaceList" => Ok(json!({"items":[available,oversized],"complete":true})),
            "drive.workspaceRead" => {
                assert_eq!(body["package"], true);
                assert_eq!(body["search"], true);
                if body["nodeId"] == "vol~a" {
                    assert_eq!(body["expectedRevisionId"], "vol~a~r1");
                    Ok(json!({"node":available,"revisionId":"vol~a~r1","contentBase64":BASE64.encode(&text)}))
                } else {
                    Err(ProviderError::new("file-too-large"))
                }
            }
            other => panic!("Unexpected provider operation {other}"),
        };
        let workspace = Workspace {directory:temporary.path().join("workspace"),invoke:&invoke,can_write:false};
        workspace.handle("select", json!({"accountId":"account","rootId":"vol~root"})).unwrap();
        let result = workspace.search(&json!({"accountId":"account","rootId":"vol~root","mode":"content","query":"al final"})).unwrap();
        assert_eq!(result["results"][0]["line"], 2);
        assert_eq!(result["oversizedFiles"], 1);
        assert_eq!(result["failedReads"], 0);
        assert_eq!(result["partial"], true);
        assert_eq!(result["index"]["readBytes"], text.len());
    }

    #[test]
    fn proton_search_keeps_small_reads_and_cached_documents_available_at_the_budget_edge() {
        let temporary = tempfile::tempdir().unwrap();
        let smaller = json!({"nodeId":"vol~small","name":"Small.md","type":"file","revisionId":"vol~small~r1"});
        let larger = json!({"nodeId":"vol~large","name":"Large.md","type":"file","revisionId":"vol~large~r1"});
        let small_text = "x".repeat(SMALL_READ_BYTES);
        let calls = std::cell::Cell::new(0);
        let invoke = |_: &str, command: &str, body: Value| {
            assert_eq!(command, "drive.workspaceRead");
            assert_eq!(body["search"], true);
            assert_eq!(body["package"], false);
            calls.set(calls.get() + 1);
            if body["nodeId"] == "vol~small" {
                Ok(json!({"node":smaller,"revisionId":"vol~small~r1","contentBase64":BASE64.encode(&small_text)}))
            } else {
                Err(ProviderError::new("file-too-large"))
            }
        };
        let workspace = Workspace {
            directory: temporary.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        let small: Node = serde_json::from_value(smaller.clone()).unwrap();
        let large: Node = serde_json::from_value(larger.clone()).unwrap();
        let mut read_bytes = MAX_SEARCH_BYTES - SMALL_READ_BYTES;
        let mut cache_hits = 0;
        let search = |node: &Node, read_bytes: &mut usize, cache_hits: &mut usize| {
            workspace.search_content("account", "vol~root", node, "markdown", read_bytes, cache_hits, None)
        };
        match search(&large, &mut read_bytes, &mut cache_hits) {
            Err(error) => assert_eq!(error.code, "proton-search-read-budget"),
            Ok(_) => panic!("A file outside the remaining read allowance was extracted"),
        }
        assert_eq!(read_bytes, MAX_SEARCH_BYTES - SMALL_READ_BYTES);
        assert!(search(&small, &mut read_bytes, &mut cache_hits).is_ok());
        assert_eq!(read_bytes, MAX_SEARCH_BYTES);
        assert!(search(&large, &mut read_bytes, &mut cache_hits).is_err());
        assert!(search(&small, &mut read_bytes, &mut cache_hits).is_ok());
        assert_eq!(cache_hits, 1);
        assert_eq!(calls.get(), 2);
    }
}
