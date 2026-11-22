import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getExportProfiles } from "../../lib/api/portabilityWorkspace";
import { checkSharedExportProfiles, publishSharedExportProfiles, readSharedExportProfiles, type SharedExportProfiles } from "../../lib/api/protonSharedProfiles";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { ProtonSharedExportProfilesDialog } from "./ProtonSharedExportProfilesDialog";
vi.mock("../../lib/api/portabilityWorkspace", () => ({ getExportProfiles: vi.fn() }));
vi.mock("../../lib/api/protonSharedProfiles", () => ({ checkSharedExportProfiles: vi.fn(), publishSharedExportProfiles: vi.fn(), readSharedExportProfiles: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const scope = { accountId: "account", rootId: "root" };
const profile = { id: "export-profile-example", name: "Informe", cover: true, contents: false, style: {} };
const initial: SharedExportProfiles = { nodeId: null, revisionId: null, profiles: [], operationId: null, updatedAt: null, checkedAt: "", outcome: "confirmed", pendingOperationId: null };
function setup() {
  vi.mocked(getExportProfiles).mockResolvedValue({ schemaVersion: 1, revision: "a".repeat(64), profiles: [profile], checkedAt: "" });
  vi.mocked(readSharedExportProfiles).mockResolvedValue(initial);
}
it("confirms the whole catalog explicitly and checks an uncertain publication without replay", async () => {
  setup();
  vi.mocked(publishSharedExportProfiles).mockResolvedValue({ ...initial, outcome: "unknown", pendingOperationId: "attempt" });
  vi.mocked(checkSharedExportProfiles).mockResolvedValue({ ...initial, nodeId: "v~profiles", revisionId: "v~profiles~rev", profiles: [profile], operationId: "attempt" });
  const pending = vi.fn();
  render(<ProtonSharedExportProfilesDialog scope={scope} connected canWrite onClose={vi.fn()} onPending={pending} />);
  expect(await screen.findByText("Informe")).toBeVisible();
  fireEvent.click(await screen.findByRole("button", { name: "Publicar perfiles del dispositivo…" }));
  expect(publishSharedExportProfiles).not.toHaveBeenCalled();
  expect(screen.getByText(/Se publicarán 1 perfiles/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Publicar catálogo" }));
  fireEvent.click(await screen.findByRole("button", { name: "Comprobar publicación" }));
  expect(await within(screen.getByRole("region", { name: "Proyecto" })).findByText("Informe")).toBeVisible();
  expect(publishSharedExportProfiles).toHaveBeenCalledTimes(1);
  expect(publishSharedExportProfiles).toHaveBeenCalledWith(scope, initial, "a".repeat(64));
  expect(checkSharedExportProfiles).toHaveBeenCalledWith(scope);
  expect(pending.mock.calls).toEqual([[true], [false]]);
});
it("reads shared profiles in English while a read-only project prevents publication", async () => {
  setup();
  render(<UiLocaleProvider language="en"><ProtonSharedExportProfilesDialog scope={scope} connected canWrite={false} onClose={vi.fn()} /></UiLocaleProvider>);
  expect(await screen.findByText("Informe")).toBeVisible();
  expect(screen.getByRole("button", { name: "Publish device profiles…" })).toBeDisabled();
  expect(readSharedExportProfiles).toHaveBeenCalledWith(scope, expect.any(AbortSignal));
  expect(publishSharedExportProfiles).not.toHaveBeenCalled();
});
