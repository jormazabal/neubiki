import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { searchProtonWorkspace } from "../../lib/api/protonSearch";
import { ProtonSearchDialog } from "./ProtonSearchDialog";

vi.mock("../../lib/api/protonSearch", () => ({ searchProtonWorkspace: vi.fn() }));
afterEach(cleanup);

it("busca en los formatos elegidos y muestra la página y la cobertura parcial", async () => {
  const match = { node: { nodeId: "pdf", name: "Acta.pdf", type: "file" as const, revisionId: "pdf~2" }, parents: [], line: 3, excerpt: "Decisión revisada", pageNumber: 4 };
  vi.mocked(searchProtonWorkspace).mockResolvedValue({ results: [match], partial: true, limited: false, failedReads: 1,
    scannedFolders: 2, scannedDocuments: 3, withoutText: 1 });
  const workspace = { accountId: "account", root: { nodeId: "root", name: "Proyecto", type: "folder" as const }, canWrite: true };
  const onOpen = vi.fn();
  render(<ProtonSearchDialog workspace={workspace} connected onClose={vi.fn()} onOpen={onOpen} fallbackFocus={() => null} />);
  fireEvent.click(screen.getByRole("radio", { name: "Contenido" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Tipo de archivo" }), { target: { value: "pdf" } });
  fireEvent.change(screen.getByRole("searchbox", { name: "Texto de búsqueda" }), { target: { value: "decisión" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  expect(await screen.findByText(/Página 4 · Línea 3/)).toBeVisible();
  expect(screen.getByText(/Resultados parciales/)).toBeVisible();
  expect(screen.getByText(/carecen de texto extraíble/)).toBeVisible();
  expect(searchProtonWorkspace).toHaveBeenCalledWith(workspace, "decisión", "content", expect.any(AbortSignal), undefined, "pdf");
  fireEvent.click(screen.getByRole("button", { name: /Acta.pdf/ }));
  expect(onOpen).toHaveBeenCalledWith(match, "decisión");
});

it("opens batch editing from saved Markdown name results and retains the selected revisions", async () => {
  const first = { nodeId: "one", name: "A.md", type: "file" as const, revisionId: "one~2" };
  const second = { nodeId: "two", name: "B.mdown", type: "file" as const, revisionId: "two~3" };
  const root = { nodeId: "root", name: "Proyecto", type: "folder" as const };
  vi.mocked(searchProtonWorkspace).mockResolvedValue({ results: [first, second].map(node => ({ node, parents: [root], line: null, excerpt: null })),
    partial: false, limited: false, failedReads: 0, scannedFolders: 1, scannedDocuments: 0 });
  render(<ProtonSearchDialog workspace={{ accountId: "account", root, canWrite: true }} connected onClose={vi.fn()}
    fallbackFocus={() => null} onOpen={vi.fn()} onBeforeReplaceReview={async () => {}}
    suggestionAnchor={{ accountId: "account", rootId: root.nodeId, nodeId: first.nodeId, baseRevisionId: first.revisionId }} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "md" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /A.md/ }));
  expect(screen.getByRole("button", { name: "Editar documentos con IA" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /B.mdown/ }));
  fireEvent.click(screen.getByRole("button", { name: "Editar documentos con IA" }));
  expect(screen.getByRole("dialog", { name: "Editar documentos con IA" })).toHaveTextContent("A.md");
  expect(screen.getByRole("dialog", { name: "Editar documentos con IA" })).toHaveTextContent("B.mdown");
});
