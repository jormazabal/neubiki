import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProtonSettingsView } from "./ProtonSettingsView";
import type { WorkspaceAppearanceController } from "./useWorkspaceAppearance";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";

vi.mock("../assistant/ProtonAiSettings", () => ({
  useProtonAiSettings: () => ({ busy: false, config: null, error: "" }),
  aiConfigValues: (value: unknown) => value,
}));
vi.mock("../settings/AppSettingsDialog", () => ({
  AiDocumentalSettings: () => null, CapabilitiesSettings: () => null,
  ExportSettings: () => null, SettingsFormDepth: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../settings/AiSkillsSettings", () => ({ AiSkillsSettings: () => null }));
vi.mock("./WorkspaceAppearanceForm", () => ({ WorkspaceAppearanceForm: () => null }));
vi.mock("./ProtonDeviceSettings", () => ({ ProtonDeviceSettings: () => null }));
vi.mock("./useProtonUpdater", () => ({ useProtonUpdater: () => ({ busy: false }) }));
vi.mock("./ProtonUpdatesSection", () => ({ ProtonUpdatesSection: () => null }));
vi.mock("../../lib/api/config", () => ({
  getExportTemplate: vi.fn(async () => ({ headings: {} })),
  getExportTemplatePath: vi.fn(async () => ""),
  resetExportTemplate: vi.fn(), updateExportTemplate: vi.fn(),
}));
vi.mock("./ProtonExportProfiles", () => ({
  ProtonExportProfiles: ({ onDirtyChange, onBusyChange }: {
    onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void;
  }) => <>
    <button onClick={() => onDirtyChange(true)}>Editar perfil de prueba</button>
    <button onClick={() => onBusyChange(true)}>Guardar perfil de prueba</button>
  </>,
}));

afterEach(cleanup);

function settings(onPendingChange: (value: boolean) => void, onBack = vi.fn()) {
  return render(<ProtonSettingsView
    appearance={{ hasPending: () => false } as WorkspaceAppearanceController}
    accounts={[]} native workspaceBusy={false} folderPickerOpen={false} onChooseAccount={vi.fn()}
    onChooseFolder={vi.fn()} onAiSaved={vi.fn()} onBack={onBack} freezeForUpdate={vi.fn()}
    unfreezeAfterUpdate={vi.fn()} protectForUpdate={async () => true} onPendingChange={onPendingChange} />);
}

it("reports a pending profile to the shell and retains settings until the user decides", async () => {
  const onPendingChange = vi.fn();
  const onBack = vi.fn();
  const view = settings(onPendingChange, onBack);
  expect(onPendingChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: "Exportación" }));
  fireEvent.click(await screen.findByRole("button", { name: "Editar perfil de prueba" }));
  expect(onPendingChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Volver" }));
  expect(await screen.findByRole("dialog", { name: "Cambios de configuración pendientes" })).toBeVisible();
  expect(onBack).not.toHaveBeenCalled();
  view.unmount();
  expect(onPendingChange).toHaveBeenLastCalledWith(false);
});

it("reports an in-flight profile operation to the shell", async () => {
  const onPendingChange = vi.fn();
  settings(onPendingChange);
  fireEvent.click(screen.getByRole("button", { name: "Exportación" }));
  fireEvent.click(await screen.findByRole("button", { name: "Guardar perfil de prueba" }));
  expect(onPendingChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("button", { name: "Volver" })).toBeDisabled();
});

it("provides English primary settings navigation and topic search without changing account labels", () => {
  render(<UiLocaleProvider language="en"><ProtonSettingsView appearance={{hasPending:()=>false} as WorkspaceAppearanceController}
    accounts={[{id:"account",label:"Mi cuenta personal"} as never]} native workspaceBusy={false} folderPickerOpen={false}
    onChooseAccount={vi.fn()} onChooseFolder={vi.fn()} onAiSaved={vi.fn()} onBack={vi.fn()}
    freezeForUpdate={vi.fn()} unfreezeAfterUpdate={vi.fn()} protectForUpdate={async()=>true}/></UiLocaleProvider>);
  expect(screen.getByRole("button",{name:"Choose workspace folder"})).toBeVisible();
  const search=screen.getByRole("searchbox",{name:"Search settings"});
  fireEvent.change(search,{target:{value:"privacy retention"}});
  expect(screen.getByRole("button",{name:"Artificial intelligence"})).toBeVisible();
  expect(screen.queryByRole("button",{name:"Appearance"})).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("1 section found");
});
