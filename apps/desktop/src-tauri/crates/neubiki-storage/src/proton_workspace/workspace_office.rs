use super::*;

const MAX_OFFICE_BYTES: usize = 8 * 1024 * 1024;

impl Workspace<'_> {
    pub(super) fn office_preview(&self, body: &Value) -> Result<Value> {
        let scope: DocumentScope = parse_input(body)?;
        let document = self.document(&scope)?;
        let revision = token(body, "revisionId")?;
        if !valid_revision(&scope.node_id, revision) {
            return Err(Error::input());
        }
        let sheet_id = if body["sheetId"].is_null() {
            None
        } else {
            Some(token(body, "sheetId")?)
        };
        let position = |key: &str| -> Result<Option<u64>> {
            if body[key].is_null() {
                Ok(None)
            } else {
                body[key].as_u64().map(Some).ok_or_else(Error::input)
            }
        };
        let row = position("row")?;
        let column = position("column")?;
        if row.is_some() != column.is_some()
            || row.is_some_and(|row| !(1..=1_048_576).contains(&row))
            || column.is_some_and(|column| !(1..=16_384).contains(&column))
        {
            return Err(Error::input());
        }
        let mut request = document.request();
        request["officeRevisionId"] = json!(revision);
        let remote: RemoteRead =
            self.provider(&scope.account_id, "drive.workspaceRead", request)?;
        validate_node(&remote.node)?;
        if remote.node.kind != NodeKind::File
            || remote.node.node_id != scope.node_id
            || remote.node.revision_id.as_deref() != Some(remote.revision_id.as_str())
        {
            return Err(Error::invalid_response());
        }
        if remote.revision_id != revision {
            return Err(Error::new(
                409,
                "stale-node",
                "El archivo cambió en Proton. Vuelve a leerlo antes de continuar.",
            ));
        }
        let data = remote.content_base64;
        let too_large = || {
            Error::new(
                413,
                "file-too-large",
                "El archivo Office supera el límite de 8 MiB de la vista previa.",
            )
        };
        if data.len() > MAX_OFFICE_BYTES.div_ceil(3) * 4 {
            return Err(too_large());
        }
        let bytes = BASE64.decode(data).map_err(|_| Error::invalid_response())?;
        if bytes.len() > MAX_OFFICE_BYTES {
            return Err(too_large());
        }
        let decode_error = |detail: String| Error::new(422, "office-preview-unavailable", &detail);
        let name = remote.node.name.to_ascii_lowercase();
        let output = if name.ends_with(".docx") && sheet_id.is_none() && row.is_none() {
            let text = neubiki_docs::docx_reference_text(&bytes).map_err(decode_error)?;
            json!({"format":"docx","revisionId":revision,"text":text})
        } else if name.ends_with(".xlsx") {
            let workbook = neubiki_docs::xlsx_reference_at(&bytes, sheet_id, row, column)
                .map_err(decode_error)?;
            json!({"format":"xlsx","revisionId":revision,"workbook":workbook})
        } else {
            return Err(Error::input());
        };
        self.check_selection(&scope.account_id, &scope.root_id)?;
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    #[test]
    fn proton_office_returns_a_revision_bound_workbook_with_bounded_values() {
        let mut package = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let entries = [
            (
                "xl/workbook.xml",
                r#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Prueba" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData><row><c r="A1"><f>SUM(A3:A4)</f><v>7</v></c><c r="AA101"><v>99</v></c></row></sheetData></worksheet>"#,
            ),
        ];
        for (name, content) in entries {
            package
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            package.write_all(content.as_bytes()).unwrap();
        }
        let bytes = BASE64.encode(package.finish().unwrap().into_inner());
        let temp = tempfile::tempdir().unwrap();
        let root = "volume~root";
        let node = "volume~office";
        let revision = "volume~office~revision";
        let invoke = |_: &str, action: &str, request: Value| match action {
            "drive.workspaceFolder" => Ok(json!({"nodeId":root,"name":"Proyecto","type":"folder"})),
            "drive.workspaceRead" => {
                assert_eq!(request["nodeId"], node);
                assert_eq!(request["rootId"], root);
                Ok(
                    json!({"node":{"nodeId":node,"name":"Resumen.xlsx","type":"file","revisionId":revision},
                    "revisionId":revision,"contentBase64":bytes}),
                )
            }
            _ => panic!("Unexpected provider call {action}"),
        };
        let workspace = Workspace {
            directory: temp.path().join("workspace"),
            invoke: &invoke,
            can_write: false,
        };
        workspace
            .handle("select", json!({"accountId":"account","rootId":root}))
            .unwrap();
        let request =
            json!({"accountId":"account","rootId":root,"nodeId":node,"revisionId":revision});
        let result = workspace.handle("office-preview", request.clone()).unwrap();
        assert_eq!(result["format"], "xlsx");
        assert_eq!(
            result["workbook"]["cells"],
            json!([{"row":1,"column":1,"value":"7"}])
        );
        assert_eq!(result["workbook"]["partial"], true);
        let mut targeted = request.clone();
        targeted["sheetId"] = json!("sheet-1");
        targeted["row"] = json!(101);
        targeted["column"] = json!(27);
        let result = workspace
            .handle("office-preview", targeted.clone())
            .unwrap();
        assert_eq!(result["workbook"]["rowStart"], 101);
        assert_eq!(result["workbook"]["columnStart"], 27);
        assert_eq!(
            result["workbook"]["cells"],
            json!([{"row":101,"column":27,"value":"99"}])
        );
        targeted["column"] = json!(16_385);
        assert_eq!(
            workspace
                .handle("office-preview", targeted)
                .unwrap_err()
                .status,
            400
        );
        let mut wrong = request;
        wrong["revisionId"] = json!("volume~office~another-revision");
        assert_eq!(
            workspace.handle("office-preview", wrong).unwrap_err().code,
            "stale-node"
        );
    }
}
