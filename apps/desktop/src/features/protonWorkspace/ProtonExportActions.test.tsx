import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getExportProfiles } from "../../lib/api/portabilityWorkspace";
import { exportProtonDocument } from "../../lib/api/protonExport";
import { prepareMermaidDiagramAssets } from "../editor/mermaidDiagrams";
import { ProtonExportActions } from "./ProtonExportActions";
import { readSharedExportProfiles } from "../../lib/api/protonSharedProfiles";
import type { OpenedDocument } from "./useProtonDocument";

vi.mock("../../lib/api/portabilityWorkspace", () => ({ getExportProfiles: vi.fn() }));
vi.mock("../../lib/api/protonSharedProfiles", () => ({ readSharedExportProfiles: vi.fn() }));
vi.mock("../../lib/api/protonExport", () => ({ exportProtonDocument: vi.fn() }));
vi.mock("../../lib/runtime/exportDialogs", () => ({
  selectExportFilePath: vi.fn(async () => "C:\\fixture\\Documento.docx"),
}));
vi.mock("../../lib/runtime/platform", () => ({ isTauriMobileRuntime: () => false }));
vi.mock("../editor/mermaidDiagrams", () => ({ prepareMermaidDiagramAssets: vi.fn(async () => []) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => vi.mocked(readSharedExportProfiles).mockResolvedValue({ nodeId: null, revisionId: null, profiles: [], operationId: null, updatedAt: null, checkedAt: "", outcome: "confirmed", pendingOperationId: null }));

it("uses the selected profile and its diagram resolution for PDF or Word, with a plain Markdown export", async () => {
  const profileId = "export-profile-example";
  const revision = "a".repeat(64);
  vi.mocked(getExportProfiles).mockResolvedValue({ schemaVersion: 1, revision, checkedAt: "",
    profiles: [{ id: profileId, name: "Informe", cover: true, contents: true, style: { document: { diagramResolution: "high" } } }] });
  vi.mocked(exportProtonDocument).mockResolvedValue({ outputPath: "C:\\fixture\\Documento.docx" });
  const source: OpenedDocument = {
    address: { accountId: "a", rootId: "r", nodeId: "n" },
    document: { node: { name: "Documento.md", nodeId: "n", type: "file" }, revisionId: "n~revision",
      markdown: "# Original", contentBase64: null, draft: null },
    editorKey: 1, ancestorIds: [], markdown: "# Borrador", draft: null, uncertain: false, receipt: null, remoteChanged: false,
  };
  const user = userEvent.setup();
  render(<ProtonExportActions disabled={false} snapshot={() => source} requested={false} onRequestHandled={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Exportar" });
  await user.click(trigger);
  await user.selectOptions(await screen.findByRole("combobox", { name: "Perfil para PDF y Word" }), profileId);
  await user.click(screen.getByRole("button", { name: "Word (.docx)" }));
  await waitFor(() => expect(exportProtonDocument).toHaveBeenCalledTimes(1));
  expect(prepareMermaidDiagramAssets).toHaveBeenCalledWith(source.markdown, "high");
  expect(vi.mocked(exportProtonDocument).mock.calls[0][0]).toMatchObject({ profileId, profileRevision: revision, markdown: source.markdown });

  await user.click(trigger);
  await user.selectOptions(await screen.findByRole("combobox", { name: "Perfil para PDF y Word" }), profileId);
  await user.click(screen.getByRole("button", { name: "Markdown (.md)" }));
  await waitFor(() => expect(exportProtonDocument).toHaveBeenCalledTimes(2));
  expect(vi.mocked(exportProtonDocument).mock.calls[1][0]).not.toHaveProperty("profileId");
  expect(prepareMermaidDiagramAssets).toHaveBeenCalledTimes(1);
});

it("explicitly exports a project profile with its remote revision and source", async () => {
  const profile = { id: "export-profile-shared", name: "Compartido", cover: false, contents: false, style: { document: { diagramResolution: "high" } } };
  vi.mocked(getExportProfiles).mockResolvedValue({ schemaVersion: 1, revision: null, checkedAt: "", profiles: [] });
  vi.mocked(readSharedExportProfiles).mockResolvedValue({ nodeId: "v~profiles", revisionId: "v~profiles~rev", profiles: [profile], operationId: "op", updatedAt: "", checkedAt: "", outcome: "confirmed", pendingOperationId: null });
  vi.mocked(exportProtonDocument).mockResolvedValue({ outputPath: "C:\\fixture\\Documento.docx" });
  const source = { address: { accountId: "a", rootId: "r", nodeId: "n" }, document: { node: { name: "Documento.md", nodeId: "n", type: "file" },
    revisionId: "n~revision", markdown: "# Guardado", contentBase64: null, draft: null }, markdown: "# Borrador", editorKey: 1, ancestorIds: [], draft: null, uncertain: false, receipt: null, remoteChanged: false } as OpenedDocument;
  const user = userEvent.setup();
  render(<ProtonExportActions disabled={false} snapshot={() => source} requested={false} onRequestHandled={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Exportar" }));
  await user.selectOptions(await screen.findByRole("combobox", { name: "Perfil para PDF y Word" }), `project:${profile.id}`);
  await user.click(screen.getByRole("button", { name: "Word (.docx)" }));
  await waitFor(() => expect(exportProtonDocument).toHaveBeenCalledTimes(1));
  expect(vi.mocked(exportProtonDocument).mock.calls[0][0]).toMatchObject({ profileId: profile.id, profileRevision: "v~profiles~rev", profileSource: "project" });
  expect(prepareMermaidDiagramAssets).toHaveBeenCalledWith(source.markdown, "high");
});

it("uses English profiles and controls while keeping document and output names", async () => {
  vi.mocked(getExportProfiles).mockResolvedValue({ schemaVersion: 1, revision: "r1", checkedAt: "", profiles: [{ id: "p1", name: "Informe original", cover: false, contents: false, style: {} }] });
  vi.mocked(exportProtonDocument).mockResolvedValue({ outputPath: "C:/fixture/Documento.docx" });
  const source = { address: { accountId: "a", rootId: "r", nodeId: "n" }, document: { node: { name: "Documento.md", nodeId: "n", type: "file" }, revisionId: "n~r1", markdown: "# Original", contentBase64: null, draft: null }, markdown: "# Borrador" } as OpenedDocument;
  const user = userEvent.setup();
  render(<UiLocaleProvider language="en"><ProtonExportActions disabled={false} snapshot={() => source} requested={false} onRequestHandled={vi.fn()} /></UiLocaleProvider>);
  await user.click(screen.getByRole("button", { name: "Export" }));
  expect(screen.getByRole("dialog", { name: "Export document" })).toBeVisible();
  await user.selectOptions(await screen.findByRole("combobox", { name: "Profile for PDF and Word" }), "p1");
  expect(screen.getByRole("option", { name: "Informe original" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Word (.docx)" }));
  expect(await screen.findByText("Exported Documento.docx.")).toBeVisible();
  expect(vi.mocked(exportProtonDocument).mock.calls[0][0]).toMatchObject({ name: "Documento.md", markdown: "# Borrador", profileId: "p1", profileRevision: "r1" });
});
