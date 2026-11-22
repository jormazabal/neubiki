import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { readProtonOfficePreview } from "../../lib/api/protonOffice";
import { MarkdownSourceViewer } from "../editor/MarkdownSourceViewer";
import { ProtonMediaPreview } from "./ProtonMediaPreview";
import { ProtonReferenceViewer } from "./ProtonReferenceViewer";

vi.mock("../../lib/api/protonOffice", () => ({ readProtonOfficePreview: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("switches text reading controls while preserving the query and literal content", () => {
  const text = "<script>Texto español</script>\nTexto español";
  const reader = <ProtonReferenceViewer name="Apunte.txt" contentBase64={btoa(String.fromCharCode(...new TextEncoder().encode(text)))} onReload={vi.fn()} />;
  const view = render(<UiLocaleProvider language="en">{reader}</UiLocaleProvider>);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search text" }), { target: { value: "Texto" } });
  expect(screen.getByRole("status")).toHaveTextContent("2 matches");
  expect(screen.getByLabelText("Text content").textContent).toBe(text);
  fireEvent.click(screen.getByRole("button", { name: "Next match" }));
  view.rerender(<UiLocaleProvider language="es">{reader}</UiLocaleProvider>);
  expect(screen.getByRole("searchbox", { name: "Buscar en el texto" })).toHaveValue("Texto");
  expect(screen.getByRole("button", { name: "Coincidencia siguiente" })).toBeDisabled();
  expect(screen.getByLabelText("Contenido de texto").textContent).toBe(text);
});

it("labels the saved worksheet, cell jump and partial window in English", async () => {
  const address = { accountId: "account", rootId: "root", nodeId: "file" };
  vi.mocked(readProtonOfficePreview).mockResolvedValue({ format: "xlsx", revisionId: "file~rev", workbook: {
    sheets: [{ id: "sheet-2", name: "Totales", hidden: true }], sheetId: "sheet-2", rowStart: 101, columnStart: 27,
    rowCount: 1, columnCount: 1, partial: true, cells: [{ row: 101, column: 27, value: "Decisión" }],
  } });
  render(<UiLocaleProvider language="en"><ProtonReferenceViewer name="Resumen.xlsx" address={address} revisionId="file~rev" contentBase64=""
    searchJump={{ query: "Decisión", revisionId: "file~rev", sheetId: "sheet-2", row: 101, column: 27 }} onReload={vi.fn()} /></UiLocaleProvider>);
  expect(await screen.findByRole("cell", { name: "Decisión" })).toHaveFocus();
  expect(screen.getByRole("combobox", { name: "Sheet" })).toHaveDisplayValue("Totales · Hidden");
  expect(screen.getByText("Result in Totales, cell AA101.")).toBeVisible();
  expect(screen.getByText(/Partial sheet view/)).toBeVisible();
});

it("localizes an unknown Office failure, retry and the Word text description", async () => {
  vi.mocked(readProtonOfficePreview).mockRejectedValueOnce(new Error("La revisión de Proton cambió.")).mockResolvedValueOnce({ format: "docx", revisionId: "file~rev", text: "Acta española" });
  render(<UiLocaleProvider language="en"><ProtonReferenceViewer name="Acta.docx" address={{ accountId: "account", rootId: "root", nodeId: "file" }}
    revisionId="file~rev" contentBase64="" onReload={vi.fn()} /></UiLocaleProvider>);
  expect(await screen.findByText("Could not prepare the Office preview.")).toBeVisible();
  expect(screen.queryByText("La revisión de Proton cambió.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Text view · The Word file keeps its formatting in Proton.")).toBeVisible();
  expect(screen.getByLabelText("Text content")).toHaveTextContent("Acta española");
});

it("uses English PDF toolbar names and format error without changing decoder limits", async () => {
  render(<UiLocaleProvider language="en"><ProtonReferenceViewer name="Documento.pdf" contentBase64={btoa("not a PDF")}
    onReload={vi.fn()} /></UiLocaleProvider>);
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  expect(screen.getByRole("searchbox", { name: "Search this page" })).toBeDisabled();
  expect(await screen.findByText("Could not open this PDF. Check the file format and size.")).toBeVisible();
});

it("switches media controls without recreating its object URL or enabling autoplay", () => {
  const create = vi.fn().mockReturnValue("blob:media");
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  const media = <ProtonMediaPreview name="Entrevista.wav" contentBase64={btoa("RIFF0000WAVEdata")} onReload={vi.fn()} />;
  const view = render(<UiLocaleProvider language="es">{media}</UiLocaleProvider>);
  view.rerender(<UiLocaleProvider language="en">{media}</UiLocaleProvider>);
  expect(screen.getByLabelText("Playback of Entrevista.wav")).toBeVisible();
  expect(screen.getByRole("button", { name: "Reload from Proton" })).toBeVisible();
  expect(create).toHaveBeenCalledTimes(1);
  const audio = view.container.querySelector("audio")!;
  expect(audio).not.toHaveAttribute("autoplay");
  fireEvent.error(audio);
  expect(screen.getByRole("alert")).toHaveTextContent("This device could not play the file.");
});

it("changes the focused source-line label while keeping every physical source line", () => {
  const source = "- Uno\n\n- Dos\n\n[Destino](archivo.md)\n";
  const viewer = <MarkdownSourceViewer markdown={source} lineNumber={5} zoomPercent={100} />;
  const view = render(<UiLocaleProvider language="es">{viewer}</UiLocaleProvider>);
  expect(screen.getByLabelText("Línea 5")).toHaveFocus();
  view.rerender(<UiLocaleProvider language="en">{viewer}</UiLocaleProvider>);
  expect(screen.getByLabelText("Line 5")).toHaveFocus();
  expect(screen.getByLabelText("Markdown source").querySelector("code")?.textContent).toBe(source);
});
