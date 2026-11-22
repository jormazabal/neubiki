//! Read selected Office parts for a preview, without extracting the package or evaluating formulas.
use super::{
    collect_descendant_text, first_child_text, shared_strings, spreadsheet_column, spreadsheet_row,
    workbook_relationships, workbook_sheets,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    io::{Cursor, Read},
};

const MAX_PACKAGE: usize = 8 * 1024 * 1024;
const XML_BUDGET: usize = 4 * 1024 * 1024;
const TEXT_BUDGET: usize = 1024 * 1024;
const WORKSHEET_ROWS: u64 = 100;
const WORKSHEET_COLUMNS: u64 = 26;

type OfficePackage<'a> = zip::ZipArchive<Cursor<&'a [u8]>>;

fn valid_cell_address(address: &str) -> bool {
    let letters = address.bytes().take_while(u8::is_ascii_uppercase).count();
    letters > 0
        && letters <= 3
        && address.len() > letters
        && address.len() <= 10
        && address.as_bytes()[letters..].iter().all(u8::is_ascii_digit)
}

fn archive(bytes: &[u8]) -> Result<OfficePackage<'_>, String> {
    if bytes.len() > MAX_PACKAGE {
        return Err("El archivo Office supera el límite de 8 MiB de la vista previa.".into());
    }
    let archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "No se pudo leer el paquete Office.".to_string())?;
    if archive.len() > 4096 {
        return Err("El paquete Office contiene demasiados elementos.".into());
    }
    Ok(archive)
}

fn read_xml(
    archive: &mut OfficePackage<'_>,
    name: &str,
    remaining: &mut usize,
) -> Result<Option<String>, String> {
    let mut entry = match archive.by_name(name) {
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(_) => return Err("No se pudo leer el contenido de Office.".into()),
        Ok(entry) => entry,
    };
    if entry.size() > *remaining as u64 {
        return Err("El contenido de Office supera el límite de la vista previa.".into());
    }
    let mut xml = String::new();
    (&mut entry)
        .take(*remaining as u64 + 1)
        .read_to_string(&mut xml)
        .map_err(|_| "El contenido de Office no es XML UTF-8 legible.".to_string())?;
    if xml.len() > *remaining {
        return Err("El contenido de Office supera el límite de la vista previa.".into());
    }
    *remaining -= xml.len();
    Ok(Some(xml))
}

fn required_xml(
    archive: &mut OfficePackage<'_>,
    name: &str,
    remaining: &mut usize,
) -> Result<String, String> {
    read_xml(archive, name, remaining)?
        .ok_or_else(|| "Falta una parte necesaria del archivo Office.".into())
}

pub fn docx_reference_text(bytes: &[u8]) -> Result<String, String> {
    let mut remaining = XML_BUDGET;
    let xml = required_xml(&mut archive(bytes)?, "word/document.xml", &mut remaining)?;
    let doc = roxmltree::Document::parse(&xml)
        .map_err(|_| "No se pudo interpretar el documento Word.".to_string())?;
    let mut text = String::new();
    for node in doc.descendants().filter(roxmltree::Node::is_element) {
        let value = match node.tag_name().name() {
            "p" if !text.is_empty() && !text.ends_with('\n') => "\n",
            "tab" => "\t",
            "br" | "cr" => "\n",
            "t" => node.text().unwrap_or_default(),
            _ => continue,
        };
        if text.len() + value.len() > TEXT_BUDGET {
            return Err("El texto de Word supera el límite de la vista previa.".into());
        }
        text.push_str(value);
    }
    Ok(text)
}

pub fn xlsx_reference(bytes: &[u8], sheet_id: Option<&str>) -> Result<Value, String> {
    xlsx_reference_at(bytes, sheet_id, None, None)
}

pub fn xlsx_reference_at(
    bytes: &[u8],
    sheet_id: Option<&str>,
    row: Option<u64>,
    column: Option<u64>,
) -> Result<Value, String> {
    let (row_start, column_start) = match (row, column) {
        (None, None) => (1, 1),
        (Some(row), Some(column))
            if (1..=1_048_576).contains(&row) && (1..=16_384).contains(&column) =>
        {
            (
                (row - 1) / WORKSHEET_ROWS * WORKSHEET_ROWS + 1,
                (column - 1) / WORKSHEET_COLUMNS * WORKSHEET_COLUMNS + 1,
            )
        }
        _ => return Err("La posición de celda no es válida.".into()),
    };
    let mut package = archive(bytes)?;
    let mut remaining = XML_BUDGET;
    let workbook = required_xml(&mut package, "xl/workbook.xml", &mut remaining)?;
    let relationships = required_xml(&mut package, "xl/_rels/workbook.xml.rels", &mut remaining)?;
    let sheets = workbook_sheets(&workbook, &workbook_relationships(&relationships));
    if sheets.is_empty()
        || sheets.len() > 200
        || sheets.iter().any(|sheet| {
            sheet.id.is_empty()
                || sheet.id.len() > 80
                || sheet.name.is_empty()
                || sheet.name.len() > 256
                || !sheet.path.starts_with("xl/worksheets/")
                || !sheet.path.ends_with(".xml")
        })
    {
        return Err("No se pudieron comprobar las hojas del archivo Excel.".into());
    }
    let selected = match sheet_id {
        Some(id) => sheets.iter().find(|sheet| sheet.id == id),
        None => sheets
            .iter()
            .find(|sheet| !sheet.hidden)
            .or_else(|| sheets.first()),
    }
    .ok_or_else(|| "La hoja elegida no está disponible.".to_string())?;
    let strings = read_xml(&mut package, "xl/sharedStrings.xml", &mut remaining)?
        .map(|xml| shared_strings(&xml))
        .unwrap_or_default();
    let sheet_xml = required_xml(&mut package, &selected.path, &mut remaining)?;
    let sheet = roxmltree::Document::parse(&sheet_xml)
        .map_err(|_| "No se pudo interpretar la hoja.".to_string())?;
    let mut seen = BTreeSet::new();
    let mut cells = Vec::new();
    let mut row_count = 0;
    let mut column_count = 0;
    let mut budget = TEXT_BUDGET;
    let mut partial = false;
    for cell in sheet
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "c")
    {
        let address = cell.attribute("r").unwrap_or_default();
        if !valid_cell_address(address) {
            partial = true;
            continue;
        }
        let (Some(row), Some(column)) = (spreadsheet_row(address), spreadsheet_column(address))
        else {
            partial = true;
            continue;
        };
        if !(row_start..row_start + WORKSHEET_ROWS).contains(&row)
            || !(column_start..column_start + WORKSHEET_COLUMNS).contains(&column)
        {
            partial = true;
            continue;
        }
        if !seen.insert((row, column)) {
            return Err("La hoja contiene posiciones de celda duplicadas.".into());
        }
        let raw = first_child_text(cell, "v").unwrap_or_default();
        let value = match cell.attribute("t") {
            Some("s") => raw
                .parse::<usize>()
                .ok()
                .and_then(|index| strings.get(index))
                .cloned()
                .unwrap_or_default(),
            Some("b") => {
                if raw == "1" {
                    "TRUE".into()
                } else {
                    "FALSE".into()
                }
            }
            Some("inlineStr") => collect_descendant_text(cell, "t"),
            _ => raw,
        };
        if value.len() > budget || value.len() > 4096 {
            partial = true;
            continue;
        }
        budget -= value.len();
        row_count = row_count.max(row - row_start + 1);
        column_count = column_count.max(column - column_start + 1);
        cells.push(json!({"row":row,"column":column,"value":value}));
    }
    Ok(json!({
        "sheets": sheets.iter().map(|sheet| json!({"id":sheet.id,"name":sheet.name,"hidden":sheet.hidden})).collect::<Vec<_>>(),
        "sheetId":selected.id,"rowStart":row_start,"columnStart":column_start,"rowCount":row_count,"columnCount":column_count,"cells":cells,"partial":partial,
    }))
}

/// Bounded cached values with exact worksheet coordinates; never evaluates formulas or opens relationships.
pub fn xlsx_search_cells(bytes: &[u8]) -> Result<Vec<Value>, String> {
    let mut package = archive(bytes)?;
    let mut remaining = XML_BUDGET;
    let workbook = required_xml(&mut package, "xl/workbook.xml", &mut remaining)?;
    let relationships = required_xml(&mut package, "xl/_rels/workbook.xml.rels", &mut remaining)?;
    let sheets = workbook_sheets(&workbook, &workbook_relationships(&relationships));
    if sheets.is_empty()
        || sheets.len() > 200
        || sheets.iter().any(|sheet| {
            sheet.id.is_empty()
                || sheet.id.len() > 80
                || sheet.name.is_empty()
                || sheet.name.len() > 256
                || !sheet.path.starts_with("xl/worksheets/")
                || !sheet.path.ends_with(".xml")
        })
    {
        return Err("No se pudieron comprobar las hojas del archivo Excel.".into());
    }
    let strings = read_xml(&mut package, "xl/sharedStrings.xml", &mut remaining)?
        .map(|xml| shared_strings(&xml))
        .unwrap_or_default();
    let mut budget = TEXT_BUDGET;
    let mut output = Vec::new();
    let mut inspected = 0usize;
    for selected in sheets {
        let xml = required_xml(&mut package, &selected.path, &mut remaining)?;
        let sheet = roxmltree::Document::parse(&xml)
            .map_err(|_| "No se pudo interpretar la hoja.".to_string())?;
        let mut seen = BTreeSet::new();
        for cell in sheet
            .descendants()
            .filter(|node| node.is_element() && node.tag_name().name() == "c")
        {
            inspected += 1;
            if inspected > 10_000 {
                return Err("El libro supera el límite de 10.000 celdas de búsqueda.".into());
            }
            let address = cell.attribute("r").unwrap_or_default();
            if !valid_cell_address(address) {
                return Err("No se pudo comprobar una posición de celda.".into());
            }
            let (Some(row), Some(column)) = (spreadsheet_row(address), spreadsheet_column(address))
            else {
                return Err("No se pudo comprobar una posición de celda.".into());
            };
            if !(1..=1_048_576).contains(&row)
                || !(1..=16_384).contains(&column)
                || !seen.insert((row, column))
            {
                return Err("No se pudo comprobar una posición de celda.".into());
            }
            let raw = first_child_text(cell, "v").unwrap_or_default();
            let text = match cell.attribute("t") {
                Some("s") => raw
                    .parse::<usize>()
                    .ok()
                    .and_then(|index| strings.get(index))
                    .cloned()
                    .unwrap_or_default(),
                Some("b") => {
                    if raw == "1" {
                        "TRUE".into()
                    } else {
                        "FALSE".into()
                    }
                }
                Some("inlineStr") => collect_descendant_text(cell, "t"),
                _ => raw,
            };
            if text.len() > budget || text.len() > 4096 {
                return Err("El texto del libro supera el límite de búsqueda.".into());
            }
            budget -= text.len();
            if !text.is_empty() {
                output.push(json!({"sheetId":selected.id,"row":row,"column":column,"text":text}));
            }
        }
    }
    Ok(output)
}
