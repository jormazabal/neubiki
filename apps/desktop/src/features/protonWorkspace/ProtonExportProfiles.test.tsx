import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { changeExportProfiles, getExportProfiles } from "../../lib/api/portabilityWorkspace";
import type { ExportProfiles } from "../../types/portabilityWorkspace";
import { ProtonExportProfiles } from "./ProtonExportProfiles";

vi.mock("../../lib/api/portabilityWorkspace", () => ({ getExportProfiles: vi.fn(), changeExportProfiles: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const catalog: ExportProfiles = { schemaVersion: 1, revision: null, checkedAt: "2026-11-17T12:00:00Z", profiles: [] };

it("captures the saved template as a named profile and confirms its removal", async () => {
  vi.mocked(getExportProfiles).mockResolvedValue(catalog);
  vi.mocked(changeExportProfiles).mockImplementation(async (_current, input) => ({
    ...catalog, revision: "a".repeat(64),
    profiles: input.action === "capture" ? [{ id: input.id, name: input.name!, cover: input.cover!, contents: input.contents!, style: {} }] : [],
  }));
  const dirty = vi.fn();
  const user = userEvent.setup();
  render(<ProtonExportProfiles active disabled={false} templatePending={false} resetKey={0} onDirtyChange={dirty} onBusyChange={vi.fn()} />);
  await user.type(await screen.findByRole("textbox", { name: "Nombre del perfil" }), "Memoria Neubiki");
  await user.click(screen.getByRole("checkbox", { name: "Incluir portada" }));
  await user.click(screen.getByRole("button", { name: "Guardar perfil" }));
  expect(await screen.findByText("Perfil guardado.")).toBeVisible();
  expect(changeExportProfiles).toHaveBeenCalledWith(catalog, {
    action: "capture", id: expect.stringMatching(/^export-profile-/), name: "Memoria Neubiki", cover: true, contents: false,
  });
  expect(dirty).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole("button", { name: "Eliminar perfil Memoria Neubiki" }));
  expect(changeExportProfiles).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Eliminar perfil" }));
  expect(await screen.findByText("Perfil eliminado.")).toBeVisible();
  expect(changeExportProfiles).toHaveBeenCalledTimes(2);
});

it("queries an uncertain capture before allowing another mutation", async () => {
  vi.mocked(getExportProfiles).mockResolvedValue(catalog);
  vi.mocked(changeExportProfiles).mockRejectedValue(new Error("No se confirmó el cambio"));
  const user = userEvent.setup();
  render(<ProtonExportProfiles active disabled={false} templatePending={false} resetKey={0} onDirtyChange={vi.fn()} onBusyChange={vi.fn()} />);
  await user.type(await screen.findByRole("textbox", { name: "Nombre del perfil" }), "Revisión");
  await user.click(screen.getByRole("button", { name: "Guardar perfil" }));
  const check = await screen.findByRole("button", { name: "Comprobar cambio" });
  expect(screen.getByRole("textbox")).toBeDisabled();
  const input = vi.mocked(changeExportProfiles).mock.calls[0][1];
  vi.mocked(getExportProfiles).mockResolvedValue({ ...catalog, profiles: [{ id: input.id, name: input.name!, cover: false, contents: false, style: {} }] });
  await user.click(check);
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  expect(await screen.findByText("Perfil guardado.")).toBeVisible();
  expect(changeExportProfiles).toHaveBeenCalledTimes(1);
});
