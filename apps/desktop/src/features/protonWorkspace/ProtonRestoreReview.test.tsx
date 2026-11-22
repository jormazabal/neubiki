import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { ProtonRestoreReview } from "./ProtonRestoreReview";
import { actOnProtonRestore, getProtonRestore, reviewProtonRestore } from "../../lib/api/protonRestore";
import type { ProtonRestore } from "../../types/protonRestore";
import type { ProjectTransferJob } from "../../types/projectTransfer";
vi.mock("../../lib/api/protonRestore", () => ({ actOnProtonRestore: vi.fn(), getProtonRestore: vi.fn(), reviewProtonRestore: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const root = { nodeId: "v~root", name: "Proyecto", type: "folder" } as const;
const source = { id: "transfer-qa", archiveSha256: "a".repeat(64), manifest: { projectName: "Actas" } } as ProjectTransferJob;
const entry = { path: "", name: "Actas copia", kind: "folder", status: "planned", nodeId: null, revisionId: null, parentId: null, bytes: 0, sha256: null, detail: null } as const;
const reviewed: ProtonRestore = { schemaVersion: 1, revision: "b".repeat(64), accountId: "acct", rootId: root.nodeId, transferId: source.id,
  archiveSha256: source.archiveSha256!, name: "Actas copia", phase: "reviewed", entries: [entry], checkedAt: "2026-11-17T12:00:00Z" };
it("requires review and explicit confirmation, then blocks replay of an unknown create", async () => {
  vi.mocked(getProtonRestore).mockResolvedValue(null); vi.mocked(reviewProtonRestore).mockResolvedValue(reviewed);
  vi.mocked(actOnProtonRestore).mockResolvedValue({ ...reviewed, phase: "uncertain", entries: [{ ...entry, status: "pending", detail: "La respuesta no llegó." }] });
  const beforeApply = vi.fn(async () => {}); const restored = vi.fn(); const user = userEvent.setup();
  render(<ProtonRestoreReview workspace={{ accountId: "acct", root, canWrite: true }} source={source} connected beforeApply={beforeApply} onPendingChange={vi.fn()} onRestored={restored} />);
  await user.click(await screen.findByRole("button", { name: "Revisar destino" }));
  const create = await screen.findByRole("button", { name: "Crear copia en Proton" }); expect(create).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /He revisado el paquete/ })); await user.click(create);
  expect(await screen.findByText(/Hay una creación sin confirmar/)).toBeVisible(); expect(screen.queryByRole("button", { name: "Crear copia en Proton" })).toBeNull();
  expect(beforeApply).toHaveBeenCalledTimes(1); expect(actOnProtonRestore).toHaveBeenCalledTimes(1); expect(restored).toHaveBeenCalledTimes(1);
});
it("keeps the close guard after a lost apply reply until native status is checked", async () => {
  vi.mocked(getProtonRestore).mockResolvedValueOnce(reviewed).mockResolvedValueOnce({ ...reviewed, phase: "uncertain", entries: [{ ...entry, status: "pending" }] });
  vi.mocked(actOnProtonRestore).mockRejectedValue(new Error("Respuesta perdida"));
  const pending = vi.fn(); const user = userEvent.setup();
  render(<ProtonRestoreReview workspace={{ accountId: "acct", root, canWrite: true }} source={source} connected beforeApply={async () => {}} onPendingChange={pending} />);
  await user.click(await screen.findByRole("checkbox", { name: /He revisado el paquete/ })); await user.click(screen.getByRole("button", { name: "Crear copia en Proton" }));
  expect(await screen.findByText("Respuesta perdida")).toBeVisible(); expect(pending).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole("button", { name: "Crear copia en Proton" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Consultar estado" }));
  await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false)); expect(actOnProtonRestore).toHaveBeenCalledTimes(1);
});

it("uses English restore controls and keeps saved folder names unchanged", async () => {
  vi.mocked(getProtonRestore).mockResolvedValue(reviewed);
  render(<UiLocaleProvider language="en"><ProtonRestoreReview workspace={{ accountId: "acct", root, canWrite: true }} source={source} connected beforeApply={async () => {}} onPendingChange={vi.fn()} /></UiLocaleProvider>);
  expect(await screen.findByRole("button", { name: "Create copy in Proton" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "New folder name" })).toHaveValue("Actas copia");
  expect(screen.getByText("Proyecto")).toBeVisible(); expect(screen.getByText(/Destination reviewed/)).toHaveTextContent("Actas copia");
});
