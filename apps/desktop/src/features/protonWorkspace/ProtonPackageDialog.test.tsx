import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { ProtonPackageDialog } from "./ProtonPackageDialog";
import { getProtonRestoreHistory } from "../../lib/api/protonRestore";
import { projectTransfers } from "../../lib/api/projectTransfer";
import { deliverProtonPackage, getProtonPackages, prepareProtonPackage } from "../../lib/api/protonPackage";
import type { ProtonPackage } from "../../types/protonPackage";
import type { ProjectTransferJob } from "../../types/projectTransfer";
vi.mock("../../lib/api/protonRestore", () => ({ getProtonRestoreHistory: vi.fn(async () => []) }));
vi.mock("./ProtonRestoreReview", () => ({ ProtonRestoreReview: () => <div>Destino de restauración</div>, ProtonRestoreResults: () => null }));
vi.mock("../../lib/api/projectTransfer", () => ({ projectTransfers: { list: vi.fn(), begin: vi.fn(), pick: vi.fn(), prepare: vi.fn(), commit: vi.fn(), discard: vi.fn() } }));
vi.mock("../../lib/api/protonPackage", () => ({ getProtonPackages: vi.fn(), prepareProtonPackage: vi.fn(), deliverProtonPackage: vi.fn(), checkProtonPackage: vi.fn(), discardProtonPackage: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const root = { nodeId: "v~root", type: "folder", name: "Proyecto" } as const;
const manifest = { format: "neubiki.project", schemaVersion: 1, projectName: "Copia verificada", createdAt: "2026-11-17T12:00:00Z", directories: ["Vacía"],
  files: [{ path: "Acta.md", size: 7, sha256: "a".repeat(64), kind: "markdown" }], exclusions: [{ path: "secreto.env", reason: "Formato excluido" }], adjustments: [], referenceWarnings: [] } as const;
const packet = { schemaVersion: 1, id: "export-batch-package", projectId: "proton-qa", revision: "b".repeat(64), phase: "prepared", format: "project", profileName: null,
  documents: [{ source: "Acta.md", filename: "Acta.md", bytes: 7, sha256: "a".repeat(64) }], archiveSha256: "c".repeat(64), archiveBytes: 100,
  checkedAt: "2026-11-17T12:00:00Z", frozen: true, includesConfirmedDrafts: false,
  sourceMetadata: { kind: "proton-project-package", accountId: "acct", rootId: root.nodeId, includesPrivateDrafts: false, manifest, results: [] } } as unknown as ProtonPackage;
function setup() { vi.mocked(getProtonRestoreHistory).mockResolvedValue([]); vi.mocked(getProtonPackages).mockResolvedValue([]); vi.mocked(projectTransfers.list).mockResolvedValue({ jobs: [], warnings: [] }); }
it("requires review of excluded files before saving a partial portable copy", async () => {
  setup(); vi.mocked(prepareProtonPackage).mockResolvedValue(packet); vi.mocked(deliverProtonPackage).mockResolvedValue({ ...packet, phase: "cancelled" });
  const beforePrepare = vi.fn(async () => {}); const pending = vi.fn(); const user = userEvent.setup();
  render(<ProtonPackageDialog workspace={{ accountId: "acct", root, canWrite: true }} connected beforePrepare={beforePrepare} onPendingChange={pending} onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Preparar y revisar" }));
  expect(await screen.findByText("Copia verificada")).toBeVisible(); expect(screen.queryByRole("button", { name: "Guardar paquete…" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: /He revisado las exclusiones/ })); await user.click(screen.getByRole("button", { name: "Guardar paquete…" }));
  expect(await screen.findByText("Destino cancelado · copia preparada")).toBeVisible(); expect(beforePrepare).toHaveBeenCalledTimes(1);
  expect(pending.mock.calls).toEqual([[true], [false], [true], [false]]);
});
it("uses the native picker and archive verifier to review without registering or publishing files", async () => {
  setup(); const source = { id: "transfer-qa", kind: "import", phase: "awaiting_source", interrupted: false, manifest: null } as ProjectTransferJob;
  vi.mocked(projectTransfers.begin).mockResolvedValue(source); vi.mocked(projectTransfers.pick).mockResolvedValue({ ...source, phase: "preparing" });
  vi.mocked(projectTransfers.prepare).mockResolvedValue({ ...source, phase: "ready", manifest: manifest as unknown as ProjectTransferJob["manifest"], archiveBytes: 100 });
  const user = userEvent.setup();
  render(<ProtonPackageDialog workspace={{ accountId: "acct", root, canWrite: true }} connected beforePrepare={async () => {}} onClose={vi.fn()} initialMode="review" />);
  await user.click(screen.getByRole("button", { name: "Elegir y revisar paquete…" }));
  expect(await screen.findByText("Copia verificada")).toBeVisible(); expect(projectTransfers.pick).toHaveBeenCalledWith("transfer-qa");
  expect(projectTransfers.prepare).toHaveBeenCalledWith("transfer-qa"); expect(projectTransfers.commit).not.toHaveBeenCalled(); expect(prepareProtonPackage).not.toHaveBeenCalled();
});

it("uses English package captions while preserving the original project and exclusion content", async () => {
  setup(); vi.mocked(prepareProtonPackage).mockResolvedValue(packet); const user = userEvent.setup();
  render(<UiLocaleProvider language="en"><ProtonPackageDialog workspace={{ accountId: "acct", root, canWrite: true }} connected beforePrepare={async () => {}} onClose={vi.fn()} /></UiLocaleProvider>);
  expect(screen.getByRole("dialog", { name: "Portable copies" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Prepare and review" }));
  expect(await screen.findByText("Copia verificada")).toBeVisible(); expect(screen.getByText("Formato excluido")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "I have reviewed the exclusions and want to save a partial copy." })).toBeVisible();
});
