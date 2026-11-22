import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { searchProtonWorkspace } from "../../lib/api/protonSearch";
import { applyProtonReplacements, checkProtonReplacements, reviewProtonReplacements } from "../../lib/api/protonReplacements";
import { listProtonIncomingReferences } from "../../lib/api/protonReferences";
import { readProtonReferenceImpact, readProtonResourceCatalog } from "../../lib/api/protonResources";
import { ProtonSearchDialog } from "./ProtonSearchDialog";
import { ProtonReplacementDialog } from "./ProtonReplacementDialog";
import { ProtonResourceCatalogDialog } from "./ProtonResourceCatalogDialog";
import { ProtonReferencesTool } from "./ProtonReferencesTool";
import { ProtonReferenceImpactPanel } from "./ProtonReferenceImpactPanel";

vi.mock("../../lib/api/protonSearch", () => ({ searchProtonWorkspace: vi.fn() }));
vi.mock("../../lib/api/protonReplacements", () => ({ applyProtonReplacements: vi.fn(), checkProtonReplacements: vi.fn(), reviewProtonReplacements: vi.fn() }));
vi.mock("../../lib/api/protonReferences", () => ({ listProtonIncomingReferences: vi.fn(), listProtonReferences: vi.fn() }));
vi.mock("../../lib/api/protonResources", () => ({ readProtonResourceCatalog: vi.fn(), readProtonReferenceImpact: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const root = { nodeId: "root", name: "Mi proyecto", type: "folder" as const };
const workspace = { accountId: "account", root, canWrite: true };

it("switches search labels and positions while preserving query, filenames and result navigation", async () => {
  const match = { node: { nodeId: "file", name: "Árbol.xlsx", type: "file" as const, revisionId: "file~rev" }, parents: [root],
    line: 1, excerpt: "Decisión sin traducir", sheetId: "sheet-2", row: 101, column: 27 };
  vi.mocked(searchProtonWorkspace).mockResolvedValue({ results: [match], partial: true, limited: true, failedReads: 1, scannedFolders: 2, scannedDocuments: 3 });
  const open = vi.fn();
  const dialog = <ProtonSearchDialog workspace={workspace} connected onClose={vi.fn()} onOpen={open} fallbackFocus={() => null} />;
  const view = render(<UiLocaleProvider language="es">{dialog}</UiLocaleProvider>);
  fireEvent.change(screen.getByRole("searchbox", { name: "Texto de búsqueda" }), { target: { value: "decisión" } });
  view.rerender(<UiLocaleProvider language="en">{dialog}</UiLocaleProvider>);
  expect(screen.getByRole("searchbox", { name: "Search text" })).toHaveValue("decisión");
  fireEvent.click(screen.getByRole("radio", { name: "Content" }));
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText(/Sheet sheet-2 · Row 101, column 27/)).toBeVisible();
  expect(screen.getByText(/Partial results/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Árbol.xlsx/ }));
  expect(open).toHaveBeenCalledWith(match, "decisión");
  expect(searchProtonWorkspace).toHaveBeenCalledTimes(1);
});

it("localizes replacement controls and unknown confirmation without changing literal Markdown", async () => {
  const review = { operationId: "attempt", applied: false, items: [{ nodeId: "file", name: "Apunte.md", occurrences: 1,
    before: "[Original](ruta.md)\nTexto español", after: "[Propuesta](ruta.md)\nTexto español", state: "reviewed" as const }] };
  vi.mocked(reviewProtonReplacements).mockResolvedValue(review);
  vi.mocked(applyProtonReplacements).mockRejectedValue({});
  vi.mocked(checkProtonReplacements).mockResolvedValue({ ...review, applied: true, items: [{ ...review.items[0], state: "prepared" }] });
  render(<UiLocaleProvider language="en"><ProtonReplacementDialog workspace={workspace} nodeIds={["file"]} query="Original" replacement="Propuesta"
    onBeforeReview={async () => {}} onPrepared={vi.fn()} onClose={vi.fn()} /></UiLocaleProvider>);
  expect(await screen.findByLabelText("Proposed Markdown")).toHaveTextContent("[Propuesta](ruta.md)");
  expect(screen.getByLabelText("Original Markdown").textContent).toBe(review.items[0].before);
  fireEvent.click(screen.getByRole("button", { name: "Prepare 1 draft" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check result" }));
  expect(await screen.findByText("Apunte.md · Draft prepared")).toBeVisible();
  expect(applyProtonReplacements).toHaveBeenCalledTimes(1);
  expect(checkProtonReplacements).toHaveBeenCalledWith(workspace, "attempt");
});

it("labels an incoming source line in English while retaining its revision and filename", async () => {
  const source = { nodeId: "source", name: "Origen.md", type: "file" as const, revisionId: "source~rev" };
  vi.mocked(listProtonIncomingReferences).mockResolvedValue({ revisionId: "file~rev", references: [{ node: source, parents: [root], revisionId: "source~rev", line: 5 }],
    partial: true, scannedDocuments: 16, scannedFolders: 2 });
  const open = vi.fn();
  render(<UiLocaleProvider language="en"><ProtonReferencesTool address={{ accountId: "account", rootId: "root", nodeId: "file" }}
    revisionId="file~rev" connected onOpen={open} /></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Find incoming links" }));
  fireEvent.click(await screen.findByRole("button", { name: "View source of Origen.md, line 5" }));
  expect(open).toHaveBeenCalledWith(source, { revisionId: "source~rev", line: 5 });
  expect(screen.getByText(/Partial results/)).toBeVisible();
});

it("filters catalog kinds in English and leaves names and scope unchanged", async () => {
  const node = { nodeId: "file", name: "Conversación.mp3", type: "file" as const, revisionId: "file~rev" };
  vi.mocked(readProtonResourceCatalog).mockResolvedValue({ resources: [{ node, parents: [root], kind: "audio" }], partial: true, scannedFolders: 16 });
  const open = vi.fn();
  render(<UiLocaleProvider language="en"><ProtonResourceCatalogDialog accountId="account" root={root} connected onClose={vi.fn()}
    onOpen={open} fallbackFocus={() => null} /></UiLocaleProvider>);
  expect(await screen.findByText(/Partial catalog/)).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Resource type" }), { target: { value: "audio" } });
  fireEvent.click(screen.getByRole("button", { name: /Conversación.mp3/ }));
  expect(open).toHaveBeenCalledWith(node, [root]);
});

it("reviews route impact in English without translating literal link destinations", async () => {
  vi.mocked(readProtonReferenceImpact).mockResolvedValue({ node: { nodeId: "file", name: "Imagen.png", type: "file" }, revisionId: "file~rev", action: "rename",
    partial: true, scannedDocuments: 2, scannedFolders: 1, outgoing: [], references: [{ node: { nodeId: "source", name: "Origen.md", type: "file" }, parents: [root],
      revisionId: "source~rev", line: 5, target: "recursos/Imagen.png" }] });
  render(<UiLocaleProvider language="en"><ProtonReferenceImpactPanel address={{ accountId: "account", rootId: "root", nodeId: "file" }}
    name="Imagen.png" revisionId="file~rev" parentId="root" action="rename" disabled={false} /></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Review affected links" }));
  expect(await screen.findByText("1 incoming link found in the files checked.")).toBeVisible();
  expect(screen.getByText("recursos/Imagen.png")).toBeVisible();
  expect(screen.getByText(/Line 5/)).toBeVisible();
});
