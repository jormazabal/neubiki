import { expect, it, vi, afterEach } from "vitest";
import { prepareProtonSavedBatch } from "./prepareProtonSavedBatch";
import { getExportTemplate } from "../../lib/api/config";
import { readDocument } from "../../lib/api/protonWorkspace";
import { prepareProtonExportBatch } from "../../lib/api/protonExportBatch";
import { prepareMermaidDiagramAssets } from "../editor/mermaidDiagrams";
vi.mock("../../lib/api/config", () => ({ getExportTemplate: vi.fn() }));
vi.mock("../../lib/api/protonWorkspace", () => ({ readDocument: vi.fn() }));
vi.mock("../../lib/api/protonExportBatch", () => ({ prepareProtonExportBatch: vi.fn() }));
vi.mock("../editor/mermaidDiagrams", () => ({ prepareMermaidDiagramAssets: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("renders diagrams from the saved text and never sends a private draft", async () => {
  vi.mocked(getExportTemplate).mockResolvedValue({ document: { diagramResolution: "high" } } as Awaited<ReturnType<typeof getExportTemplate>>);
  vi.mocked(readDocument).mockResolvedValue({ node: { nodeId: "doc", name: "Acta.md", type: "file" }, revisionId: "doc~r1", markdown: "# Guardado", contentBase64: null,
    draft: { markdown: "# Privado", generation: 1, baseRevisionId: "doc~r1", state: "draft" } });
  vi.mocked(prepareMermaidDiagramAssets).mockResolvedValue([]);
  await prepareProtonSavedBatch({ accountId: "acct", rootId: "root" }, [{ nodeId: "doc", revisionId: "doc~r1", name: "Acta.md", type: "file" }], "pdf",
    { schemaVersion: 1, revision: null, profiles: [], checkedAt: "2026-11-17T12:00:00Z" }, "", vi.fn());
  expect(prepareMermaidDiagramAssets).toHaveBeenCalledWith("# Guardado", "high");
  expect(prepareProtonExportBatch).toHaveBeenCalledWith({ accountId: "acct", rootId: "root" }, [{ nodeId: "doc", revisionId: "doc~r1", name: "Acta.md", diagramAssets: [] }], "pdf", undefined);
  expect(JSON.stringify(vi.mocked(prepareProtonExportBatch).mock.calls)).not.toContain("Privado");
});

it("formats English local progress while preserving source identities", async () => {
  const progress = vi.fn();
  await prepareProtonSavedBatch({ accountId: "acct", rootId: "root" }, [{ nodeId: "doc", revisionId: "doc~r1", name: "Reunión.md", type: "file" }], "md",
    { schemaVersion: 1, revision: null, profiles: [], checkedAt: "" }, "", progress, undefined, "en");
  expect(progress.mock.calls).toEqual([["Reviewing 1 of 1: Reunión.md"], ["Preparing files and the batch review…"]]);
  expect(prepareProtonExportBatch).toHaveBeenCalledWith({ accountId: "acct", rootId: "root" }, [{ nodeId: "doc", revisionId: "doc~r1", name: "Reunión.md" }], "md", undefined);
});
