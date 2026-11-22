import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as office from "../../lib/api/protonOffice";
import { ProtonReferenceViewer } from "./ProtonReferenceViewer";

vi.mock("../../lib/api/protonOffice", () => ({ readProtonOfficePreview: vi.fn() }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("renders a Proton text file literally and searches without interpreting markup or patterns", async () => {
  const text = "<script>?</script> example [file] EXAMPLE [file]";
  const user = userEvent.setup();
  const onReload = vi.fn();
  render(<ProtonReferenceViewer name="archivo.TXT" contentBase64={btoa(text)} onReload={onReload} />);

  expect(screen.getByLabelText("Contenido de texto")).toHaveTextContent(text);
  await user.type(screen.getByRole("searchbox", { name: "Buscar en el texto" }), "example");
  expect(screen.getByRole("status")).toHaveTextContent("2 coincidencias");
  await user.click(screen.getByRole("button", { name: "Coincidencia siguiente" }));
  expect(screen.getByRole("button", { name: "Coincidencia siguiente" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Volver a leer de Proton" }));
  expect(onReload).toHaveBeenCalledOnce();
});

it("signals when binary data cannot be displayed as UTF-8 text", () => {
  render(<ProtonReferenceViewer name="archivo.txt" contentBase64={btoa("\xff")} onReload={vi.fn()} />);
  expect(screen.getByText("No se pudo leer el archivo como texto UTF-8.")).toBeVisible();
  expect(screen.getByRole("searchbox")).toBeDisabled();
});

it("loads the chosen Excel sheet for the displayed Proton revision", async () => {
  const address = { accountId: "account", rootId: "root", nodeId: "file" };
  const revision = "file~revision";
  const sheets = [{ id: "1", name: "Entrada", hidden: false }, { id: "2", name: "Totales", hidden: false }];
  vi.mocked(office.readProtonOfficePreview).mockImplementation(async (_address, revisionId, sheetId) => ({
    format: "xlsx",
    revisionId,
    workbook: {
      sheets, sheetId: sheetId ?? "1", rowCount: 1, columnCount: 1, partial: true,
      cells: [{ row: 1, column: 1, value: sheetId === "2" ? "54" : "27" }],
    },
  }));
  const user = userEvent.setup();
  render(<ProtonReferenceViewer name="Resultados.xlsx" contentBase64="" address={address}
    revisionId={revision} onReload={vi.fn()} />);

  expect(await screen.findByRole("cell", { name: "27" })).toBeVisible();
  await user.selectOptions(screen.getByRole("combobox", { name: "Hoja" }), "2");
  expect(await screen.findByRole("cell", { name: "54" })).toBeVisible();
  expect(office.readProtonOfficePreview).toHaveBeenLastCalledWith(address, revision, "2", expect.any(AbortSignal), undefined);
  expect(screen.getByText(/Vista parcial de la hoja/)).toBeVisible();
});

it("opens the exact saved Excel sheet and coordinate window from search and ignores stale jumps", async () => {
  const address = { accountId: "account", rootId: "root", nodeId: "file" };
  vi.mocked(office.readProtonOfficePreview).mockImplementation(async (_address, revisionId, sheetId, _signal, position) => ({
    format: "xlsx", revisionId,
    workbook: { sheets: [{ id: "2", name: "Totales", hidden: false }], sheetId: sheetId ?? "2",
      rowStart: position?.row ?? 1, columnStart: position?.column ?? 1, rowCount: 1, columnCount: 1,
      cells: [{ row: position?.row ?? 1, column: position?.column ?? 1, value: "Acuerdo" }], partial: true },
  }));
  const { rerender } = render(<ProtonReferenceViewer name="Libro.xlsx" contentBase64="" address={address} revisionId="revision"
    onReload={vi.fn()} searchJump={{ query: "Acuerdo", revisionId: "revision", sheetId: "2", row: 101, column: 27 }} />);
  expect(await screen.findByRole("cell", { name: "Acuerdo" })).toHaveFocus();
  expect(screen.getByRole("columnheader", { name: "AA" })).toBeVisible();
  expect(office.readProtonOfficePreview).toHaveBeenLastCalledWith(address, "revision", "2", expect.any(AbortSignal), { row: 101, column: 27 });
  vi.mocked(office.readProtonOfficePreview).mockClear();
  rerender(<ProtonReferenceViewer name="Libro.xlsx" contentBase64="" address={address} revisionId="revision"
    onReload={vi.fn()} searchJump={{ query: "Acuerdo", revisionId: "old", sheetId: "9", row: 900, column: 500 }} />);
  expect(office.readProtonOfficePreview).not.toHaveBeenCalled();
});
