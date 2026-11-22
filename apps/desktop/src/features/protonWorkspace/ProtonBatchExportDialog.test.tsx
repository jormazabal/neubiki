import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProtonBatchExportDialog } from "./ProtonBatchExportDialog";
import { listDriveFolder } from "../../lib/api/protonWorkspace";
import { getExportProfiles } from "../../lib/api/portabilityWorkspace";
import { readSharedExportProfiles } from "../../lib/api/protonSharedProfiles";
import { getProtonExportBatches, deliverProtonExportBatch, checkProtonExportBatch } from "../../lib/api/protonExportBatch";
import { prepareProtonSavedBatch } from "./prepareProtonSavedBatch";
import type { ProtonExportBatch } from "../../types/protonExportBatch";
vi.mock("../../lib/api/protonWorkspace", () => ({ listDriveFolder: vi.fn() }));
vi.mock("../../lib/api/portabilityWorkspace", () => ({ getExportProfiles: vi.fn() }));
vi.mock("../../lib/api/protonSharedProfiles", () => ({ readSharedExportProfiles: vi.fn() }));
vi.mock("../../lib/api/protonExportBatch", () => ({ getProtonExportBatches: vi.fn(), deliverProtonExportBatch: vi.fn(), checkProtonExportBatch: vi.fn(), discardProtonExportBatch: vi.fn() }));
vi.mock("./prepareProtonSavedBatch", () => ({ prepareProtonSavedBatch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const root = { nodeId: "v~root", name: "Proyecto", type: "folder" } as const;
const results = [{ nodeId: "v~doc", revisionId: "v~doc~r1", name: "Acta.md", status: "included" as const },
  { nodeId: "v~gone", revisionId: "v~gone~r1", name: "Anterior.md", status: "omitted" as const, detail: "El documento cambió." }];
const job: ProtonExportBatch = { schemaVersion: 1, id: "export-batch-qa", projectId: "proton-qa", revision: "a".repeat(64),
  phase: "prepared", format: "pdf", profileName: null, documents: [{ source: "Documentos/01/Acta.md", filename: "Documentos/01/Acta.pdf", bytes: 3, sha256: "b".repeat(64) }],
  archiveSha256: "c".repeat(64), archiveBytes: 100, checkedAt: "2026-11-17T12:00:00Z", frozen: true, includesConfirmedDrafts: false,
  sourceMetadata: { kind: "proton-saved-revisions", accountId: "acct", rootId: root.nodeId, includesPrivateDrafts: false, results } };
function setup() {
  vi.mocked(readSharedExportProfiles).mockResolvedValue({ nodeId: null, revisionId: null, profiles: [], operationId: null, updatedAt: null, checkedAt: "", outcome: "confirmed", pendingOperationId: null });
  vi.mocked(getExportProfiles).mockResolvedValue({ schemaVersion: 1, revision: null, profiles: [], checkedAt: job.checkedAt });
  vi.mocked(getProtonExportBatches).mockResolvedValue([]);
  vi.mocked(listDriveFolder).mockResolvedValue({ items: [{ nodeId: "v~doc", revisionId: "v~doc~r1", name: "Acta.md", type: "file" }] });
}
it("requires partial review before delivery and preserves a cancelled destination", async () => {
  setup();
  vi.mocked(prepareProtonSavedBatch).mockResolvedValue({ schemaVersion: 1, batch: job, results, checkedAt: job.checkedAt });
  vi.mocked(deliverProtonExportBatch).mockResolvedValue({ ...job, phase: "cancelled" });
  const onPendingChange = vi.fn(); const beforePrepare = vi.fn(async () => {});
  const user = userEvent.setup();
  render(<ProtonBatchExportDialog workspace={{ accountId: "acct", root, canWrite: true }} connected beforePrepare={beforePrepare} onPendingChange={onPendingChange} onClose={vi.fn()} />);
  await user.click(await screen.findByRole("checkbox", { name: "Acta.md" }));
  await user.click(screen.getByRole("button", { name: "Preparar y revisar" }));
  expect(await screen.findByText("Revisión del lote")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Guardar ZIP…" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: /He revisado/ }));
  await user.click(screen.getByRole("button", { name: "Guardar ZIP…" }));
  expect(await screen.findByText(/No se eligió un destino/)).toBeVisible();
  expect(deliverProtonExportBatch).toHaveBeenCalledTimes(1);
  expect(beforePrepare).toHaveBeenCalledTimes(1);
  expect(onPendingChange.mock.calls).toEqual([[true], [false], [true], [false]]);
});

it("selects a project profile for batch preparation with its source and observed remote revision", async () => {
  setup();
  const profile = { id: "export-profile-project", name: "Proyecto compartido", cover: false, contents: true, style: {} };
  vi.mocked(readSharedExportProfiles).mockResolvedValue({ nodeId: "v~profiles", revisionId: "v~profiles~rev", profiles: [profile], operationId: "op", updatedAt: job.checkedAt, checkedAt: job.checkedAt, outcome: "confirmed", pendingOperationId: null });
  vi.mocked(prepareProtonSavedBatch).mockResolvedValue({ schemaVersion: 1, batch: job, results, checkedAt: job.checkedAt });
  const user = userEvent.setup();
  render(<ProtonBatchExportDialog workspace={{ accountId: "acct", root, canWrite: true }} connected beforePrepare={async () => {}} onClose={vi.fn()} />);
  await user.click(await screen.findByRole("checkbox", { name: "Acta.md" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Perfil para PDF y Word" }), `project:${profile.id}`);
  await user.click(screen.getByRole("button", { name: "Preparar y revisar" }));
  await waitFor(() => expect(prepareProtonSavedBatch).toHaveBeenCalledTimes(1));
  expect(prepareProtonSavedBatch).toHaveBeenCalledWith({ accountId: "acct", rootId: root.nodeId }, expect.any(Array), "pdf",
    expect.objectContaining({ revision: "v~profiles~rev", profiles: [profile] }), profile.id, expect.any(Function), "project", "es");
});
it("reopens a retained uncertain delivery and checks without replaying it", async () => {
  setup();
  vi.mocked(getProtonExportBatches).mockResolvedValue([{ ...job, phase: "uncertain" }]);
  vi.mocked(checkProtonExportBatch).mockResolvedValue({ ...job, phase: "uncertain" });
  const user = userEvent.setup();
  render(<ProtonBatchExportDialog workspace={{ accountId: "acct", root, canWrite: true }} connected={false} beforePrepare={async () => {}} onClose={vi.fn()} />);
  await user.click(await screen.findByText(/Lotes conservados en este dispositivo/));
  await user.click(screen.getByRole("button", { name: /1 archivos · Entrega sin confirmar/ }));
  expect(screen.queryByRole("button", { name: "Guardar ZIP…" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Comprobar resultado" }));
  await waitFor(() => expect(checkProtonExportBatch).toHaveBeenCalledTimes(1));
  expect(deliverProtonExportBatch).not.toHaveBeenCalled();
  expect(prepareProtonSavedBatch).not.toHaveBeenCalled();
});

it("uses English selection and partial review without changing saved names or delivery consent", async () => {
  setup();
  vi.mocked(prepareProtonSavedBatch).mockResolvedValue({ schemaVersion: 1, batch: job, results, checkedAt: job.checkedAt });
  const user = userEvent.setup();
  render(<UiLocaleProvider language="en"><ProtonBatchExportDialog workspace={{ accountId: "acct", root, canWrite: true }} connected beforePrepare={async () => {}} onClose={vi.fn()} /></UiLocaleProvider>);
  expect(screen.getByRole("dialog", { name: "Batch export" })).toBeVisible();
  await user.click(await screen.findByRole("checkbox", { name: "Acta.md" }));
  expect(screen.getByText("1 of 32 documents selected")).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove Acta.md" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Prepare and review" }));
  expect(await screen.findByText("Batch review")).toBeVisible();
  expect(screen.getByText("El documento cambió.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save ZIP…" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: /I have reviewed/ }));
  expect(screen.getByRole("button", { name: "Save ZIP…" })).toBeEnabled();
  expect(prepareProtonSavedBatch).toHaveBeenCalledWith(expect.any(Object), expect.arrayContaining([expect.objectContaining({ name: "Acta.md" })]), "pdf", expect.any(Object), "", expect.any(Function), undefined, "en");
});
it("checks an uncertain batch offline in English without repeating delivery", async () => {
  setup();
  vi.mocked(getProtonExportBatches).mockResolvedValue([{ ...job, phase: "uncertain" }]);
  vi.mocked(checkProtonExportBatch).mockResolvedValue({ ...job, phase: "uncertain" });
  const user = userEvent.setup();
  render(<UiLocaleProvider language="en"><ProtonBatchExportDialog workspace={{ accountId: "acct", root, canWrite: true }} connected={false} beforePrepare={async () => {}} onClose={vi.fn()} /></UiLocaleProvider>);
  await user.click(await screen.findByText("Batches retained on this device (1)"));
  await user.click(screen.getByRole("button", { name: /1 files · Delivery unconfirmed/ }));
  expect(screen.getByText(/An unconfirmed delivery is not repeated/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Check result" }));
  await waitFor(() => expect(checkProtonExportBatch).toHaveBeenCalledTimes(1));
  expect(deliverProtonExportBatch).not.toHaveBeenCalled();
});
