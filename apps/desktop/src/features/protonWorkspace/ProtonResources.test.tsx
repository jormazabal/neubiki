import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readProtonReferenceImpact, readProtonResourceCatalog } from "../../lib/api/protonResources";
import { ProtonReferenceImpactPanel } from "./ProtonReferenceImpactPanel";
import { ProtonResourceCatalogDialog } from "./ProtonResourceCatalogDialog";

vi.mock("../../lib/api/protonResources", () => ({ readProtonReferenceImpact: vi.fn(), readProtonResourceCatalog: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("reviews saved file link impact explicitly without submitting the rename form", async () => {
  const source = { nodeId: "source", name: "Origen.md", type: "file" as const, revisionId: "source~rev" };
  vi.mocked(readProtonReferenceImpact).mockResolvedValue({ node: { nodeId: "file", name: "Clip.mp4", type: "file" },
    revisionId: "file~rev", action: "rename", partial: true, scannedDocuments: 16, scannedFolders: 2, outgoing: [],
    references: [{ node: source, parents: [], revisionId: "source~rev", line: 5, target: "Clip.mp4" }] });
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(<form onSubmit={submit}><ProtonReferenceImpactPanel address={{ accountId: "account", rootId: "root", nodeId: "file" }}
    name="Clip.mp4" revisionId="file~rev" parentId="root" action="rename" disabled={false} /></form>);
  expect(readProtonReferenceImpact).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Revisar enlaces afectados" }));
  expect(await screen.findByText(/Comprobación parcial/)).toBeVisible();
  expect(screen.getByText("Clip.mp4")).toBeVisible();
  expect(submit).not.toHaveBeenCalled();
  expect(readProtonReferenceImpact).toHaveBeenCalledWith({ accountId: "account", rootId: "root", nodeId: "file" },
    { revisionId: "file~rev", expectedName: "Clip.mp4", parentId: "root", action: "rename" }, expect.any(AbortSignal));
});

it("shows exact zero occurrences distinctly from a partial impact failure", async () => {
  vi.mocked(readProtonReferenceImpact).mockResolvedValue({ node: { nodeId: "file", name: "Clip.mp4", type: "file" },
    revisionId: "file~rev", action: "move", partial: false, scannedDocuments: 3, scannedFolders: 1, outgoing: [], references: [] });
  render(<ProtonReferenceImpactPanel address={{ accountId: "account", rootId: "root", nodeId: "file" }} name="Clip.mp4"
    revisionId="file~rev" parentId="root" action="move" disabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Revisar enlaces afectados" }));
  expect(await screen.findByText("0 enlaces entrantes encontrados.")).toBeVisible();
  expect(screen.queryByText(/Comprobación parcial/)).not.toBeInTheDocument();
});

it("reviews a folder without a revision and identifies the document of an outgoing link", async () => {
  const address = { accountId: "account", rootId: "root", nodeId: "folder" };
  vi.mocked(readProtonReferenceImpact).mockResolvedValue({
    node: { nodeId: "folder", name: "Contratos", type: "folder" }, revisionId: null, action: "move",
    partial: false, scannedDocuments: 2, scannedFolders: 3, references: [],
    outgoing: [{ target: "../Política.md", line: 5, sourceName: "Propuesta.md" }],
  });
  render(<ProtonReferenceImpactPanel address={address} name="Contratos" parentId="root" action="move" folder disabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Revisar enlaces afectados" }));
  expect(await screen.findByText("Propuesta.md")).toBeVisible();
  expect(screen.getByText(/Política.md/)).toBeVisible();
  expect(readProtonReferenceImpact).toHaveBeenCalledWith(address,
    { nodeKind: "folder", expectedName: "Contratos", parentId: "root", action: "move" }, expect.any(AbortSignal));
});

it("filters a partial metadata catalog by actual file kind and opens the scoped resource", async () => {
  const root = { nodeId: "root", name: "Proyecto", type: "folder" as const };
  const audio = { nodeId: "audio", name: "Entrevista.mp3", type: "file" as const, revisionId: "audio~rev" };
  vi.mocked(readProtonResourceCatalog).mockResolvedValue({ partial: true, scannedFolders: 16, resources: [
    { node: audio, parents: [root], kind: "audio" },
    { node: { nodeId: "pdf", name: "Acta.pdf", type: "file", revisionId: "pdf~rev" }, parents: [root], kind: "pdf" },
  ] });
  const open = vi.fn();
  render(<ProtonResourceCatalogDialog accountId="account" root={root} connected onClose={vi.fn()} onOpen={open} fallbackFocus={() => null} />);
  expect(await screen.findByText(/Catálogo parcial/)).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Tipo de recurso" }), { target: { value: "audio" } });
  expect(screen.queryByRole("button", { name: /Acta.pdf/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Entrevista.mp3/ }));
  expect(open).toHaveBeenCalledWith(audio, [root]);
});
