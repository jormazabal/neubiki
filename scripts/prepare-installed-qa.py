"""Create a synthetic corpus for the installed Neubiki acceptance campaign."""

import argparse
import hashlib
import json
import pathlib
import re
import struct
import zipfile
import zlib


def write_png(path):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    pixels = bytes.fromhex("00 f37021 6b7280 00 6b7280 f37021")
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


def write_workbook(path):
    document_relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    package_relationships = "http://schemas.openxmlformats.org/package/2006/relationships"
    spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    with zipfile.ZipFile(path, "w") as workbook:
        def add_part(name, xml):
            workbook.writestr(zipfile.ZipInfo(name), xml.strip(), compress_type=zipfile.ZIP_DEFLATED)

        add_part("[Content_Types].xml", """
            <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
              <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
              <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
              <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
            </Types>""")
        add_part("_rels/.rels", f"""
            <Relationships xmlns="{package_relationships}">
              <Relationship Id="rId1" Type="{document_relationships}/officeDocument" Target="xl/workbook.xml"/>
            </Relationships>""")
        add_part("xl/workbook.xml", f"""
            <workbook xmlns="{spreadsheet}" xmlns:r="{document_relationships}">
              <sheets><sheet name="Inventario" sheetId="1" r:id="rId1"/></sheets>
            </workbook>""")
        add_part("xl/_rels/workbook.xml.rels", f"""
            <Relationships xmlns="{package_relationships}">
              <Relationship Id="rId1" Type="{document_relationships}/worksheet" Target="worksheets/sheet1.xml"/>
            </Relationships>""")
        add_part("xl/worksheets/sheet1.xml", f"""
            <worksheet xmlns="{spreadsheet}"><sheetData>
              <row r="1"><c r="B1" t="inlineStr"><is><t>Marcador de prueba</t></is></c></row>
              <row r="2"><c r="B2" t="inlineStr"><is><t>coral-qa-739</t></is></c></row>
            </sheetData></worksheet>""")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("campaign")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}", args.campaign):
        parser.error("campaign must be a new folder label of 1–63 letters, digits, hyphens or underscores")

    repo = pathlib.Path(__file__).resolve().parent.parent
    destination = repo / "output" / "installed-qa" / args.campaign
    if destination.exists():
        parser.error(f"campaign already exists: {destination}")
    destination.mkdir(parents=True, exist_ok=False)

    project = destination / "proyecto"
    (project / "Equipo").mkdir(parents=True)
    (project / "recursos").mkdir()
    limits = destination / "limites"
    limits.mkdir()

    (project / "Inicio QA.md").write_text(
        "# Taller ficticio\n\nEl punto de encuentro está junto al jardín. Marcador coral-qa-739.\n\n"
        "[Recorrido](Equipo/Rutas%20de%20salida.md)\n\n"
        "![Muestra cromática](recursos/muestra.png)\n\n"
        "| Equipo | Acción |\n| --- | --- |\n| Turno A | Avisar |\n\n"
        "```mermaid\nflowchart TD\n  A[Aviso] --> B[Jardín]\n```\n",
        encoding="utf-8",
    )
    (project / "Equipo" / "Rutas de salida.md").write_text(
        "# Rutas de salida\n\nDurante una evacuación, cruzar el pasillo sur y reunirse en el jardín.\n",
        encoding="utf-8",
    )
    (project / "Acta sintética.md").write_text(
        "# Reunión ficticia\n\nSe acuerda volver a comprobar el aviso al final del turno.\n",
        encoding="utf-8",
    )
    write_png(project / "recursos" / "muestra.png")
    write_workbook(project / "Inventario de prueba.xlsx")
    (limits / "fuera-del-proyecto.md").write_text("# Raíz hermana\n\ncoral-qa-739\n", encoding="utf-8")
    (limits / "superior-a-8-MiB.txt").write_bytes(b"Texto de prueba\n" * (512 * 1024) + b"\n")

    files = [
        {"path": path.relative_to(destination).as_posix(), "bytes": path.stat().st_size,
         "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in sorted(destination.rglob("*")) if path.is_file()
    ]
    (destination / "corpus.json").write_text(json.dumps(files, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    main()
