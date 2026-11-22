import { useEffect, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { ProtonAccountStatus } from "../../types/protonDirect";
import type { ProtonDocument, ProtonNode, ProtonWorkspace as Selection } from "../../types/protonWorkspace";
import * as account from "../../lib/api/protonDirect";
import * as api from "../../lib/api/protonWorkspace";
import * as config from "../../lib/api/config";
import * as exports from "../../lib/api/protonExport";
import { searchProtonWorkspace } from "../../lib/api/protonSearch";
import { getDocumentTemplate, listDocumentTemplates } from "../../lib/api/documentTemplates";
import { createProtonTemplateDocument, previewProtonTemplate } from "../../lib/api/protonTemplates";
import { prepareProtonTemplateCapture } from "../../lib/api/protonTemplateCapture";
import * as exportDialogs from "../../lib/runtime/exportDialogs";
import * as appearanceApi from "../../lib/api/workspaceAppearance";
import { defaultWorkspaceAppearance } from "../../types/workspaceAppearance";
import { isTauriMobileRuntime } from "../../lib/runtime/platform";
import { ProtonWorkspace } from "./ProtonWorkspace";
import { protonContinuityStorageKey } from "./useProtonWorkspaceContinuity";
import type { MarkdownEditorController } from "../editor/editorTypes";
import type { ProtonDocumentToolProps, ProtonToolTarget } from "./protonToolTypes";

vi.mock("../../lib/runtime/platform", () => ({ isTauriRuntime: () => true, isMobileDeviceRuntime: () => false, isTauriMobileRuntime: vi.fn() }));
vi.mock("../../app/useWorkspaceExit", () => ({ useWorkspaceExit: () => undefined }));
vi.mock("../../lib/api/protonSearch", () => ({ searchProtonWorkspace: vi.fn() }));
vi.mock("../../lib/api/documentTemplates", () => ({ listDocumentTemplates: vi.fn(), getDocumentTemplate: vi.fn() }));
vi.mock("../../lib/api/protonTemplates", () => ({ previewProtonTemplate: vi.fn(), createProtonTemplateDocument: vi.fn() }));
vi.mock("../../lib/api/protonTemplateCapture", () => ({
  prepareProtonTemplateCapture: vi.fn(), saveProtonTemplateCapture: vi.fn(), checkProtonTemplateCapture: vi.fn(),
  newProtonTemplateCaptureOperationId: vi.fn(),
}));
vi.mock("../../lib/api/protonDirect", () => ({
  getProtonAccount: vi.fn(), startProtonConnection: vi.fn(), pollProtonConnection: vi.fn(),
  cancelProtonConnection: vi.fn(), disconnectProtonAccount: vi.fn(),
}));
vi.mock("../../lib/api/protonWorkspace", () => ({
  currentWorkspace: vi.fn(), readDriveRoot: vi.fn(), listDriveFolder: vi.fn(), selectDriveFolder: vi.fn(),
  readDocument: vi.fn(), readAsset: vi.fn(), getWorkspaceEvents: vi.fn(), writeDraft: vi.fn(),
  saveDocument: vi.fn(), reconcileDocument: vi.fn(), discardDraft: vi.fn(),
  editTree: vi.fn(), importProtonFile: vi.fn(), maxProtonImportFileBytes: 8 * 1024 * 1024,
}));
vi.mock("../editor/MarkdownEditor", () => ({
  MarkdownEditor: ({ markdown, readOnly, onChange, onControllerChange }: {
    markdown: string; readOnly: boolean; onChange: (value: string) => void;
    onControllerChange: (controller: MarkdownEditorController | null, released?: MarkdownEditorController) => void;
  }) => {
    const current = useRef({ markdown, onChange });
    current.current = { markdown, onChange };
    useEffect(() => {
      const controller = {
        matchesMarkdown: (source: string) => current.current.markdown === source,
        getMarkdownSelection: () => ({ focusType: "cursor", from: 2, to: 2, position: 2, text: "", markdown: "" }),
        replaceMarkdown: (value: string) => { current.current.onChange(value); return true; },
      } as MarkdownEditorController;
      onControllerChange(controller);
      return () => onControllerChange(null, controller);
    }, [onControllerChange]);
    return <textarea aria-label="Documento de prueba" value={markdown} readOnly={readOnly} onChange={event => onChange(event.target.value)} />;
  },
}));

vi.mock("./protonTools", () => ({
  protonTools: [{ id: "assistant", label: "IA", panel: ({ available, capture, apply }: ProtonDocumentToolProps) => {
    const [target, setTarget] = useState<ProtonToolTarget | null>(null);
    const [result, setResult] = useState("");
    return <>
      <button type="button" disabled={!available} onClick={() => setTarget(capture())}>Capturar</button>
      {target && <p>Captura de {target.address.nodeId}</p>}
      <button type="button" disabled={!target} onClick={() => setResult(target && apply(target, { kind: "replace_document", markdown: "Propuesta aplicada." }) ? "Aplicada" : "Obsoleta")}>Aplicar propuesta</button>
      <p>{result}</p>
    </>;
  } }],
}));

const node = (nodeId: string, name: string, type: ProtonNode["type"]): ProtonNode => ({ nodeId, name, type });
const drive = node("drive", "Mis archivos", "folder");
const root = node("project", "Proyecto", "folder");
const folder = node("folder", "Anexos", "folder");
const file = node("file", "Resumen.md", "file");
const otherFile = node("other", "Notas.md", "file");
const status: ProtonAccountStatus = { available: true, account: { id: "acct", label: "Cuenta de prueba", state: "connected" }, attempt: null };
const selection: Selection = { accountId: "acct", root, canWrite: false };
const address = { accountId: "acct", rootId: "project", nodeId: "file" };
const stored = { baseRevisionId: "rev-1", generation: 3, markdown: "Borrador recuperado.", state: "draft" as const };
const document = (draft: ProtonDocument["draft"] = null): ProtonDocument => ({ node: file, revisionId: "rev-1", markdown: "# En Proton", contentBase64: null, draft });

beforeAll(async () => {
  await Promise.all([
    import("./ProtonDocumentPane"), import("./ProtonSettingsView"), import("./ProtonSearchDialog"),
    import("./ProtonTemplateDialog"), import("./ProtonTemplateCaptureDialog"), import("./ProtonExportActions"),
  ]);
}, 60_000);

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.removeItem(protonContinuityStorageKey);
  vi.mocked(account.getProtonAccount).mockResolvedValue(status);
  vi.mocked(api.readDriveRoot).mockResolvedValue({ root: drive });
  vi.mocked(api.currentWorkspace).mockResolvedValue(null);
  vi.mocked(api.selectDriveFolder).mockResolvedValue(selection);
  vi.mocked(api.getWorkspaceEvents).mockResolvedValue({ cursor: "session", changed: false, requiresRefresh: false });
  vi.mocked(api.listDriveFolder).mockImplementation(async (_account, parent) => ({ items: ({
    drive: [root], project: [folder, file, otherFile], folder: [],
  } as Record<string, ProtonNode[]>)[parent] ?? [] }));
  vi.mocked(api.readDocument).mockResolvedValue(document());
  vi.mocked(api.writeDraft).mockImplementation(async (_address, draft) => ({
    baseRevisionId: draft.baseRevisionId, generation: (draft.expectedGeneration ?? 0) + 1,
    markdown: draft.markdown ?? "", handwritten: draft.handwritten, state: "draft",
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("opens a project search result and tells the user when its coverage is partial", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue(selection);
  const imported = { ...file, name: "Resumen.mdown", revisionId: "rev-1" };
  vi.mocked(searchProtonWorkspace).mockResolvedValue({
    results: [{ node: imported, parents: [root], line: null, excerpt: null }],
    partial: true, limited: false, failedReads: 1, scannedFolders: 1, scannedDocuments: 0,
  });
  vi.mocked(api.readDocument).mockResolvedValue({ ...document(), node: imported });
  render(<ProtonWorkspace />);

  const trigger = await screen.findByRole("button", { name: "Buscar en el proyecto" });
  await waitFor(() => expect(trigger).toBeEnabled());
  await userEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Buscar en el proyecto" }, { timeout: 10_000 });
  await userEvent.type(within(dialog).getByRole("searchbox"), "Resumen{Enter}");
  await waitFor(() => expect(within(dialog).getByText(/Resultados parciales/)).toBeVisible());
  expect(searchProtonWorkspace).toHaveBeenCalledWith(selection, "Resumen", "files", expect.any(AbortSignal), undefined, "all");
  await userEvent.click(within(dialog).getByRole("button", { name: /Resumen\.mdown/ }));
  expect(await screen.findByRole("textbox", { name: "Documento de prueba" }, { timeout: 10_000 })).toHaveValue("# En Proton");
  expect(api.readDocument).toHaveBeenCalledWith(address);
});

it("opens mobile tools separately and returns to the same draft and tool", async () => {
  const width = window.innerWidth;
  window.innerWidth = 393;
  try {
    vi.mocked(api.currentWorkspace).mockResolvedValue(selection);
    vi.mocked(api.readDocument).mockResolvedValue(document(stored));
    render(<ProtonWorkspace />);
    await userEvent.click(await screen.findByRole("button", { name: "Resumen.md" }));
    const editor = await screen.findByRole("textbox", { name: "Documento de prueba" }, { timeout: 10_000 });
    const tools = screen.getByRole("button", { name: "Herramientas" });
    expect(tools).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "Herramientas de Proton" })).toBeNull();
    await userEvent.click(tools);
    expect(screen.getByRole("button", { name: "Volver al documento" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "IA" }));
    await userEvent.click(screen.getByRole("button", { name: "Capturar" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(tools).toHaveFocus());
    expect(editor).toHaveValue(stored.markdown);
    await userEvent.click(tools);
    expect(screen.getByText("Captura de file")).toBeVisible();
  } finally {
    window.innerWidth = width;
  }
});

it("opens account actions by keyboard and protects the draft before signing out of Proton", async () => {
  const signedOut: ProtonAccountStatus = { available: true, account: null, accounts: [], attempt: null };
  vi.mocked(api.currentWorkspace).mockResolvedValue(selection);
  vi.mocked(account.disconnectProtonAccount).mockResolvedValue(signedOut);
  vi.mocked(account.startProtonConnection).mockResolvedValue({
    ...signedOut, attempt: { connectionId: "attempt", state: "pending" },
  });
  render(<ProtonWorkspace />);
  await userEvent.click(await screen.findByRole("button", { name: "Resumen.md" }));
  const editor = await screen.findByRole("textbox", { name: "Documento de prueba" });
  fireEvent.change(editor, { target: { value: "Borrador antes de cerrar sesión." } });

  const menu = screen.getByRole("button", { name: "Menú de cuenta" });
  menu.focus();
  await userEvent.keyboard("{Enter}{Tab}");
  expect(screen.getByRole("button", { name: "Estadísticas de IA" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(menu).toHaveFocus();
  expect(screen.queryByRole("group", { name: "Opciones de cuenta" })).not.toBeInTheDocument();

  await userEvent.click(menu);
  await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión de Proton…" }));
  expect(account.disconnectProtonAccount).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: /^Cerrar sesión$/ }));
  await waitFor(() => expect(account.disconnectProtonAccount).toHaveBeenCalledWith("acct"));
  expect(api.writeDraft).toHaveBeenCalledWith(address, {
    documentName: "Resumen.md", baseRevisionId: "rev-1", expectedGeneration: null, markdown: "Borrador antes de cerrar sesión.",
  });
  expect(vi.mocked(api.writeDraft).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(account.disconnectProtonAccount).mock.invocationCallOrder[0]);
  expect(api.saveDocument).not.toHaveBeenCalled();

  await userEvent.click(menu);
  await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión en Proton" }));
  expect(await screen.findByText("Esperando autorización en Proton.")).toBeVisible();
  expect(account.startProtonConnection).toHaveBeenCalledOnce();
});

it("selects a remote root, loads folders only on expansion and protects a draft while offline", async () => {
  vi.mocked(api.readDocument).mockResolvedValue(document(stored));
  render(<ProtonWorkspace />);
  await userEvent.click(await screen.findByRole("button", { name: "Elegir carpeta" }));
  await userEvent.click(await screen.findByRole("button", { name: "Proyecto" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Usar esta carpeta" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Usar esta carpeta" }));
  const expandable = await screen.findByRole("button", { name: "Anexos" });
  expect(api.listDriveFolder).not.toHaveBeenCalledWith("acct", "folder", "project", expect.anything());
  await userEvent.click(expandable);
  await screen.findByText("Carpeta vacía.");
  expect(api.listDriveFolder).toHaveBeenCalledWith("acct", "folder", "project", expect.anything());
  await userEvent.click(screen.getByRole("button", { name: "Resumen.md" }));
  const editor = await screen.findByRole("textbox", { name: "Documento de prueba" });
  expect(editor).toHaveValue(stored.markdown);
  expect(screen.queryByRole("button", { name: "Guardar en Proton" })).toBeNull();

  fireEvent.change(editor, { target: { value: "Trabajo por recuperar." } });
  fireEvent(window, new Event("offline"));
  expect(editor).toHaveAttribute("readonly");
  await waitFor(() => expect(api.writeDraft).toHaveBeenCalledWith(address, {
    documentName: "Resumen.md", baseRevisionId: "rev-1", expectedGeneration: 3, markdown: "Trabajo por recuperar.",
  }));
  expect(api.saveDocument).not.toHaveBeenCalled();
  expect((await screen.findByText("Borrador local")).closest(".ui-status-tag")).toHaveAttribute("data-ui-tone", "neutral");
});

it("does not repeat a remote save with an unknown result; displays confirmation after observation", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  vi.mocked(api.readDocument).mockResolvedValue(document(stored));
  vi.mocked(api.saveDocument).mockResolvedValue({ state: "unknown", revisionId: null, draft: { ...stored, state: "unknown" } });
  vi.mocked(api.reconcileDocument).mockResolvedValue({ state: "observed", revisionId: "rev-2", draft: null });
  render(<ProtonWorkspace />);
  await userEvent.click(await screen.findByRole("button", { name: "Resumen.md" }));
  await userEvent.click(await screen.findByRole("button", { name: "Guardar en Proton" }));
  expect(await screen.findByText("Guardado pendiente de comprobación.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Guardar en Proton" })).toBeNull();
  expect(screen.queryByText("Guardado en Proton.")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Comprobar revisión" }));
  expect(await screen.findByText("Guardado en Proton.")).toBeVisible();
  expect(api.saveDocument).toHaveBeenCalledOnce();
  expect(api.reconcileDocument).toHaveBeenCalledWith(address);
});

it("keeps a tool proposal reviewable across documents and rejects the stale edit", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue(selection);
  vi.mocked(api.readDocument).mockImplementation(async target => target.nodeId === "other"
    ? { ...document(), node: otherFile, markdown: "Otras notas." }
    : document());
  render(<ProtonWorkspace />);
  await userEvent.click(await screen.findByRole("button", { name: "Resumen.md" }));
  await userEvent.click(await screen.findByRole("button", { name: "IA" }));
  await userEvent.click(await screen.findByRole("button", { name: "Capturar" }));
  expect(screen.getByText("Captura de file")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Cerrar panel" }));
  await userEvent.click(screen.getByRole("button", { name: "IA" }));
  expect(screen.getByText("Captura de file")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Notas.md" }));
  const editor = await screen.findByRole("textbox", { name: "Documento de prueba" });
  expect(editor).toHaveValue("Otras notas.");
  expect(screen.getByText("Captura de file")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Aplicar propuesta" }));
  expect(screen.getByText("Obsoleta")).toBeVisible();
  expect(editor).toHaveValue("Otras notas.");

  await userEvent.click(screen.getByRole("button", { name: "Capturar" }));
  fireEvent.change(editor, { target: { value: "Otras notas. Borrador." } });
  await userEvent.click(screen.getByRole("button", { name: "Aplicar propuesta" }));
  expect(editor).toHaveValue("Otras notas. Borrador.");

  await userEvent.click(screen.getByRole("button", { name: "Capturar" }));
  await screen.findByText("Borrador local");
  await userEvent.click(screen.getByRole("button", { name: "Aplicar propuesta" }));
  expect(screen.getByText("Aplicada")).toBeVisible();
  expect(editor).toHaveValue("Propuesta aplicada.");
  expect(api.saveDocument).not.toHaveBeenCalled();
});

it("switches between tabs while keeping independent drafts and saves only the active one from the footer", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  vi.mocked(api.readDocument).mockImplementation(async target => target.nodeId === "other"
    ? { ...document(), node: otherFile, markdown: "Otras notas." }
    : document());
  vi.mocked(api.saveDocument).mockResolvedValue({ state: "saved", revisionId: "rev-2", draft: null });
  render(<ProtonWorkspace />);

  const tree = await screen.findByRole("navigation", { name: "Árbol de Proton Drive" });
  fireEvent.click(await within(tree).findByRole("button", { name: "Resumen.md" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Documento de prueba" }), { target: { value: "Borrador del resumen" } });
  fireEvent.click(within(tree).getByRole("button", { name: "Notas.md" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Documento de prueba" })).toHaveValue("Otras notas."));
  fireEvent.change(screen.getByRole("textbox", { name: "Documento de prueba" }), { target: { value: "Borrador de las notas" } });

  const tabs = within(screen.getByRole("navigation", { name: "Pestañas de documentos" }));
  const summary = tabs.getByRole("button", { name: "Resumen.md" });
  expect(within(summary).getByLabelText("Cerrar Resumen.md, con cambios sin guardar")).toBeVisible();
  fireEvent.click(summary);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Documento de prueba" })).toHaveValue("Borrador del resumen"));
  expect(api.readDocument).toHaveBeenCalledTimes(2);
  const footer = within(screen.getByLabelText("Guardado del documento"));
  fireEvent.click(footer.getByRole("button", { name: "Guardar en Proton" }));
  await footer.findByText("Guardado en Proton.");
  expect(api.saveDocument).toHaveBeenCalledOnce();
  expect(api.saveDocument).toHaveBeenCalledWith(address, 1, expect.any(String));
  expect(within(summary).getByLabelText("Cerrar Resumen.md")).toBeVisible();
  const notes = tabs.getByRole("button", { name: "Notas.md" });
  fireEvent.click(within(notes).getByLabelText("Cerrar Notas.md, con cambios sin guardar"));
  await waitFor(() => expect(tabs.queryByRole("button", { name: "Notas.md" })).not.toBeInTheDocument());
  expect(api.writeDraft).toHaveBeenCalledWith({ ...address, nodeId: "other" }, expect.objectContaining({ markdown: "Borrador de las notas" }));
  expect(api.discardDraft).not.toHaveBeenCalled();
});

it("shows settings in the workspace and returns to the same editor, draft, and tools", async () => {
  const ai = { ...config.defaultAiConfig, openaiKeyConfigured: false };
  vi.spyOn(config, "getAiConfig").mockResolvedValue(ai);
  const updateAi = vi.spyOn(config, "updateAiConfig").mockResolvedValue({ ...ai, model: "gpt-5.5" });
  vi.spyOn(config, "getExportTemplate").mockResolvedValue(config.defaultExportTemplateConfig);
  vi.spyOn(config, "getExportTemplatePath").mockResolvedValue("");
  const updateTemplate = vi.spyOn(config, "updateExportTemplate").mockResolvedValue({
    ...config.defaultExportTemplateConfig, normal: { ...config.defaultExportTemplateConfig.normal, fontFamily: "Calibri" },
  });
  vi.mocked(api.currentWorkspace).mockResolvedValue(selection);
  render(<ProtonWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Resumen.md" }));
  const editor = await screen.findByRole("textbox", { name: "Documento de prueba" });
  fireEvent.change(editor, { target: { value: "Borrador antes de los ajustes" } });
  fireEvent.click(screen.getByRole("button", { name: "IA" }));
  const accountMenu = screen.getByRole("button", { name: "Menú de cuenta" });
  fireEvent.click(accountMenu);
  fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

  const sections = await screen.findByRole("navigation", { name: "Apartados de configuración" }, { timeout: 10_000 });
  expect(screen.queryByRole("dialog", { name: "Configuración" })).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Árbol de Proton Drive" })).not.toBeInTheDocument();
  expect(screen.queryByRole("complementary", { name: "Herramientas de Proton" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("main", { name: "Proton Drive" })).getByRole("button", { name: "Elegir carpeta de trabajo" })).toBeVisible();
  fireEvent.click(within(sections).getByRole("button", { name: "Inteligencia artificial" }));
  const aiSection = within(screen.getByRole("main", { name: "Inteligencia artificial" }));
  expect(await aiSection.findByLabelText(/Clave API de OpenAI/)).toBeVisible();
  fireEvent.click(aiSection.getByRole("button", { name: new RegExp(ai.model, "i") }));
  const option = screen.getAllByRole("option", { name: /gpt-5.5/i }).find(item => item.tagName === "BUTTON")!;
  fireEvent.click(option);
  fireEvent.click(aiSection.getByRole("button", { name: "Guardar cambios" }));
  expect(await aiSection.findByText("Ajustes de IA guardados.")).toBeVisible();
  expect(updateAi).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.5" }));

  fireEvent.click(within(sections).getByRole("button", { name: "Exportación" }));
  const exportSection = within(screen.getByRole("main", { name: "Exportación" }));
  fireEvent.change(await exportSection.findByLabelText("Tipografia"), { target: { value: "Calibri" } });
  fireEvent.click(exportSection.getByRole("button", { name: "Guardar plantilla" }));
  expect(await exportSection.findByText("Plantilla guardada.")).toBeVisible();
  expect(updateTemplate).toHaveBeenCalledWith(expect.objectContaining({ normal: expect.objectContaining({ fontFamily: "Calibri" }) }));
  fireEvent.click(within(sections).getByRole("button", { name: "Actualizaciones" }));
  expect(within(screen.getByRole("main", { name: "Actualizaciones" })).getByRole("button", { name: "Buscar actualizaciones" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Volver" }));
  expect(screen.getByRole("textbox", { name: "Documento de prueba" })).toBe(editor);
  expect(editor).toHaveValue("Borrador antes de los ajustes");
  expect(screen.getByRole("button", { name: "IA" })).toHaveAttribute("aria-expanded", "true");
  expect(accountMenu).toHaveFocus();
  expect(api.readDocument).toHaveBeenCalledOnce();
  expect(api.saveDocument).not.toHaveBeenCalled();
});

it.each([false, true])("exports the unsaved draft from the footer with mobile=%s", async (mobile) => {
  vi.mocked(isTauriMobileRuntime).mockReturnValue(mobile);
  const choose = vi.spyOn(exportDialogs, "selectExportFilePath").mockResolvedValue("C:/Export/Resumen.md");
  const desktop = vi.spyOn(exports, "exportProtonDocument").mockResolvedValue({ outputPath: "C:/Export/Resumen.md" });
  const android = vi.spyOn(exports, "exportProtonDocumentToMobile").mockResolvedValue({
    status: "saved", exportId: "export-test", fileName: "Resumen.md", byteLength: 22,
    requestId: "request-test", completedAt: "2026-11-15T00:00:00Z",
  });
  vi.mocked(api.currentWorkspace).mockResolvedValue(selection);
  render(<ProtonWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Resumen.md" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Documento de prueba" }), { target: { value: "Borrador para exportar" } });
  if (mobile) {
    fireEvent.click(within(screen.getByRole("contentinfo", { name: "Guardado del documento" })).getByRole("button", { name: "Exportar" }));
  } else {
    const tree = within(screen.getByRole("navigation", { name: "Árbol de Proton Drive" }));
    fireEvent.click(tree.getByRole("button", { name: "Opciones de Resumen.md" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Exportar…" }));
  }
  const dialog = await screen.findByRole("dialog", { name: "Exportar documento" });
  expect(within(dialog).getByRole("button", { name: "PDF (.pdf)" })).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Word (.docx)" })).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Markdown (.md)" }));
  const payload = expect.objectContaining({ ...address, name: file.name, format: "md", markdown: "Borrador para exportar" });
  if (mobile) {
    await waitFor(() => expect(android).toHaveBeenCalledWith(payload));
    expect(choose).not.toHaveBeenCalled();
    expect(desktop).not.toHaveBeenCalled();
  } else {
    expect(await screen.findByText("Exportado Resumen.md.")).toBeVisible();
    expect(choose).toHaveBeenCalledWith(file.name, "md", "es");
    expect(desktop).toHaveBeenCalledWith(payload, "C:/Export/Resumen.md");
    expect(android).not.toHaveBeenCalled();
  }
  expect(api.saveDocument).not.toHaveBeenCalled();
});

it("selects a scoped destination for a move and creates a document at the workspace root", async () => {
  const newDocument = node("new", "Agenda.md", "file");
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  vi.mocked(api.editTree).mockImplementation(async (_account, _root, edit) => ({ node: edit.action === "move" ? file : newDocument }));
  render(<ProtonWorkspace />);
  const tree = within(await screen.findByRole("navigation", { name: "Árbol de Proton Drive" }));
  const row = await tree.findByRole("button", { name: file.name });
  fireEvent.keyDown(row, { key: "F10", shiftKey: true });
  fireEvent.click(screen.getByRole("menuitem", { name: "Mover…" }));
  const move = within(screen.getByRole("dialog", { name: "Mover" }));
  expect(move.getByRole("button", { name: "Mover aquí" })).toBeDisabled();
  fireEvent.click(await move.findByRole("button", { name: folder.name }));
  const confirm = move.getByRole("button", { name: "Mover aquí" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await tree.findByText("«Resumen.md» se ha movido.");
  expect(api.editTree).toHaveBeenNthCalledWith(1, "acct", "project", {
    action: "move", nodeId: file.nodeId, parentId: root.nodeId, expectedName: file.name, targetParentId: folder.nodeId,
  });
  fireEvent.click(tree.getByRole("button", { name: `Opciones de ${root.name}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Nuevo documento" }));
  const create = within(screen.getByRole("dialog", { name: "Nuevo documento" }));
  fireEvent.change(create.getByLabelText("Nombre"), { target: { value: "Agenda" } });
  fireEvent.click(create.getByRole("button", { name: "Crear" }));
  await tree.findByText("Se creó «Agenda.md».");
  expect(api.editTree).toHaveBeenNthCalledWith(2, "acct", "project", {
    action: "create-document", name: "Agenda.md", parentId: root.nodeId,
  });
});

it("creates a reviewed template at the folder selected from the tree", async () => {
  const template = { id: "builtin-agenda", name: "Agenda", description: "", variables: [], revision: "template-revision",
    builtIn: true, createdAt: null, markdown: "# Agenda" };
  const proposed = { templateId: template.id, revision: template.revision, name: "Sesión.md", markdown: "# Sesión" };
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  vi.mocked(listDocumentTemplates).mockResolvedValue({
    templates: [template], complete: true, warnings: [], scannedBytes: 0, scannedEntries: 1,
  });
  vi.mocked(getDocumentTemplate).mockResolvedValue(template);
  vi.mocked(previewProtonTemplate).mockResolvedValue(proposed);
  vi.mocked(createProtonTemplateDocument).mockResolvedValue(node("new", proposed.name, "file"));
  render(<ProtonWorkspace />);
  const row = await screen.findByRole("button", { name: folder.name });
  fireEvent.keyDown(row, { key: "F10", shiftKey: true });
  fireEvent.click(screen.getByRole("menuitem", { name: "Crear desde plantilla…" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Nuevo documento desde plantilla" }));
  expect(dialog.getByText("Proyecto / Anexos")).toBeVisible();
  fireEvent.change(await dialog.findByRole("combobox", { name: "Plantilla" }), { target: { value: template.id } });
  await waitFor(() => expect(dialog.getByRole("textbox", { name: "Nombre del documento" })).toBeEnabled());
  fireEvent.change(dialog.getByRole("textbox", { name: "Nombre del documento" }), { target: { value: "Sesión" } });
  fireEvent.click(dialog.getByRole("button", { name: "Revisar documento" }));
  fireEvent.click(await dialog.findByRole("button", { name: "Crear en Proton" }));
  expect(await dialog.findByText("«Sesión.md» se ha creado en Proton.")).toBeVisible();
  expect(createProtonTemplateDocument).toHaveBeenCalledWith("acct", root.nodeId, folder.nodeId, proposed);
});

it("creates a Neubiki note when the user enters an inherited extension", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  vi.mocked(api.editTree).mockResolvedValue({ node: node("ink", "Ideas.nbnote", "file") });
  render(<ProtonWorkspace />);
  const options = await screen.findByRole("button", { name: "Opciones de Proyecto" });
  await waitFor(() => expect(options).toBeEnabled());
  fireEvent.click(options);
  fireEvent.click(screen.getByRole("menuitem", { name: "Nueva nota manuscrita" }));
  const create = within(screen.getByRole("dialog", { name: "Nueva nota manuscrita" }));
  fireEvent.change(create.getByLabelText("Nombre"), { target: { value: "Ideas.knote" } });
  expect(create.getByText("Ideas.nbnote")).toBeVisible();
  fireEvent.click(create.getByRole("button", { name: "Crear" }));
  await waitFor(() => expect(api.editTree).toHaveBeenCalledWith("acct", root.nodeId, {
    action: "create-note", name: "Ideas.nbnote", parentId: root.nodeId,
  }));
});

it("opens with the stored interface language and preserves Proton file names", async () => {
  vi.spyOn(appearanceApi, "loadWorkspaceAppearance").mockResolvedValue({
    value: { ...defaultWorkspaceAppearance, language: "en" }, migrate: false,
  });
  vi.mocked(api.currentWorkspace).mockResolvedValue(selection);
  render(<ProtonWorkspace />);
  expect(await screen.findByRole("button", { name: "Search project" })).toBeVisible();
  const tree = within(await screen.findByRole("navigation", { name: "Proton Drive file tree" }));
  expect(await tree.findByRole("button", { name: file.name })).toBeVisible();
  expect(window.document.documentElement.lang).toBe("en");
});

it("opens template capture for the saved tree revision without opening or editing the file", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue(selection);
  vi.mocked(api.listDriveFolder).mockResolvedValue({ items: [{ ...file, revisionId: "file~saved" }] });
  vi.mocked(prepareProtonTemplateCapture).mockRejectedValue(new Error("Fixture stops after review request"));
  render(<ProtonWorkspace />);
  const options = await screen.findByRole("button", { name: "Opciones de Resumen.md" });
  await waitFor(() => expect(options).toBeEnabled());
  fireEvent.click(options);
  fireEvent.click(screen.getByRole("menuitem", { name: "Guardar como plantilla…" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Guardar como plantilla" }));
  expect(dialog.getByText("Resumen.md")).toBeVisible();
  expect(prepareProtonTemplateCapture).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "Revisar versión guardada" }));
  await waitFor(() => expect(prepareProtonTemplateCapture).toHaveBeenCalledWith({ ...address, revisionId: "file~saved" }));
  expect(api.readDocument).not.toHaveBeenCalled();
  expect(api.editTree).not.toHaveBeenCalled();
});

function dragData() {
  return {
    types: [] as string[], setData(_type: string) { this.types.push(_type); }, effectAllowed: "", dropEffect: "",
  };
}

it("confirms an internal drop and preserves the open draft when moving into Proton", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  vi.mocked(api.editTree).mockResolvedValue({ node: file });
  render(<ProtonWorkspace />);
  const source = await screen.findByRole("button", { name: file.name });
  fireEvent.click(source);
  fireEvent.change(await screen.findByRole("textbox", { name: "Documento de prueba" }), { target: { value: "Edición durante el traslado" } });
  const destination = screen.getByRole("button", { name: folder.name });
  const data = dragData();
  fireEvent.dragStart(source, { dataTransfer: data });
  fireEvent.dragOver(destination, { dataTransfer: data });
  expect(destination.closest(".proton-tree-row")).toHaveAttribute("data-drop-target", "true");
  fireEvent.drop(destination, { dataTransfer: data });
  const dialog = within(await screen.findByRole("dialog", { name: "Mover" }));
  expect(dialog.getByText(`${root.name} / ${folder.name}`)).toBeVisible();
  expect(api.editTree).not.toHaveBeenCalled();
  const confirm = dialog.getByRole("button", { name: "Mover aquí" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await screen.findByText(`«${file.name}» se ha movido.`);
  expect(api.editTree).toHaveBeenCalledWith("acct", root.nodeId, {
    action: "move", nodeId: file.nodeId, parentId: root.nodeId, expectedName: file.name, targetParentId: folder.nodeId,
  });
  expect(api.writeDraft).toHaveBeenCalledWith(address, expect.objectContaining({ markdown: "Edición durante el traslado" }));
});

it("rejects a folder dropped on its descendant and accepts a file dropped on the root heading", async () => {
  const nested = node("nested", "Detalle", "folder");
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  vi.mocked(api.listDriveFolder).mockImplementation(async (_account, parent) => ({ items: parent === root.nodeId ? [folder] : parent === folder.nodeId ? [nested, file] : [] }));
  render(<ProtonWorkspace />);
  const source = await screen.findByRole("button", { name: folder.name });
  fireEvent.click(source);
  const nestedTarget = await screen.findByRole("button", { name: nested.name });
  const invalid = dragData();
  fireEvent.dragStart(source, { dataTransfer: invalid });
  fireEvent.dragOver(nestedTarget, { dataTransfer: invalid });
  expect(invalid.dropEffect).toBe("none");
  fireEvent.drop(nestedTarget, { dataTransfer: invalid });
  expect(screen.queryByRole("dialog", { name: "Mover" })).not.toBeInTheDocument();
  const valid = dragData();
  fireEvent.dragStart(screen.getByRole("button", { name: file.name }), { dataTransfer: valid });
  fireEvent.drop(screen.getByRole("heading", { name: "Archivos" }), { dataTransfer: valid });
  expect(await screen.findByRole("dialog", { name: "Mover" })).toBeInTheDocument();
  expect(api.editTree).not.toHaveBeenCalled();
});

it("copies a dropped folder with its original files only after confirmation", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  const local = new File(["original"], "Informe.txt", { type: "text/plain" });
  const uploaded = node("uploaded", local.name, "file");
  const created = node("created", "Documentos locales", "folder");
  vi.mocked(api.editTree).mockResolvedValue({ node: created });
  vi.mocked(api.importProtonFile).mockResolvedValue({ node: uploaded });
  const empty = { name: "Vacía", isDirectory: true, createReader: () => ({ readEntries: (done: (items: unknown[]) => void) => done([]) }) };
  const entries = [[empty], [{ name: local.name, isFile: true, file: (done: (file: File) => void) => done(local) }], []];
  vi.mocked(api.editTree).mockResolvedValueOnce({ node: created }).mockResolvedValueOnce({ node: node("empty", empty.name, "folder") });
  const directory = { name: created.name, isDirectory: true, createReader: () => ({
    readEntries: (done: (items: unknown[]) => void) => done(entries.shift() ?? []),
  }) };
  render(<ProtonWorkspace />);
  const target = await screen.findByRole("button", { name: folder.name });
  const dataTransfer = { types: ["Files"], items: [{ kind: "file", webkitGetAsEntry: () => directory }] };
  fireEvent.dragOver(target, { dataTransfer });
  expect(target.closest(".proton-tree-row")).toHaveAttribute("data-drop-target", "true");
  fireEvent.drop(target, { dataTransfer });
  const dialog = within(await screen.findByRole("dialog", { name: "Importar en Proton Drive" }));
  expect(await dialog.findByText("3 elementos para copiar")).toBeVisible();
  expect(api.editTree).not.toHaveBeenCalled();
  expect(api.importProtonFile).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "Importar" }));
  expect(await dialog.findByText("3 elementos copiados en Proton Drive.")).toBeInTheDocument();
  expect(api.editTree).toHaveBeenCalledWith("acct", root.nodeId, { action: "create-folder", parentId: folder.nodeId, name: created.name });
  expect(api.importProtonFile).toHaveBeenCalledWith("acct", root.nodeId, created.nodeId, local);
});

it("stops a drop import after a conflict and displays the already confirmed files", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  const first = new File(["copied"], "Primero.txt");
  const second = new File(["conflict"], "Segundo.txt");
  const third = new File(["waiting"], "Tercero.txt");
  vi.mocked(api.importProtonFile).mockResolvedValueOnce({ node: node("uploaded", first.name, "file") })
    .mockRejectedValueOnce(new Error("El nombre ya existe."));
  render(<ProtonWorkspace />);
  await screen.findByRole("button", { name: file.name });
  fireEvent.drop(screen.getByRole("heading", { name: "Archivos" }), { dataTransfer: { types: ["Files"], files: [first, second, third] } });
  const dialog = within(await screen.findByRole("dialog", { name: "Importar en Proton Drive" }));
  await dialog.findByText("3 elementos para copiar");
  fireEvent.click(dialog.getByRole("button", { name: "Importar" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("1 de 3 confirmados. Se detuvo en «Segundo.txt».");
  expect(api.importProtonFile).toHaveBeenCalledTimes(2);
  expect(dialog.queryByRole("button", { name: "Importar" })).not.toBeInTheDocument();
});

it("renames an open document from its context menu and preserves the active draft and tab", async () => {
  const renamed = { ...file, name: "Resumen de equipo.md" };
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  vi.mocked(api.editTree).mockImplementation(async () => {
    expect(api.writeDraft).toHaveBeenCalledWith(address, expect.objectContaining({ markdown: "Pendiente de guardar" }));
    vi.mocked(api.listDriveFolder).mockResolvedValue({ items: [folder, renamed] });
    return { node: renamed };
  });
  render(<ProtonWorkspace />);
  const tree = within(await screen.findByRole("navigation", { name: "Árbol de Proton Drive" }));
  const row = await tree.findByRole("button", { name: file.name });
  fireEvent.click(row);
  const editor = await screen.findByRole("textbox", { name: "Documento de prueba" });
  fireEvent.change(editor, { target: { value: "Pendiente de guardar" } });
  fireEvent.contextMenu(row, { clientX: 28, clientY: 120 });
  const menu = within(screen.getByRole("menu", { name: `Opciones de ${file.name}` }));
  expect(menu.getByRole("menuitem", { name: "Duplicar" })).toBeVisible();
  fireEvent.click(menu.getByRole("menuitem", { name: "Renombrar" }));
  const dialog = within(screen.getByRole("dialog", { name: "Renombrar" }));
  expect(dialog.getByLabelText("Nombre")).toHaveValue("Resumen");
  fireEvent.change(dialog.getByLabelText("Nombre"), { target: { value: "Resumen de equipo" } });
  fireEvent.click(dialog.getByRole("button", { name: "Renombrar" }));
  await tree.findByRole("button", { name: renamed.name });
  expect(api.editTree).toHaveBeenCalledTimes(1);
  expect(api.editTree).toHaveBeenCalledWith("acct", "project", {
    action: "rename", nodeId: file.nodeId, parentId: root.nodeId, expectedName: file.name, name: renamed.name,
  });
  expect(screen.getByRole("textbox", { name: "Documento de prueba" })).toBe(editor);
  expect(editor).toHaveValue("Pendiente de guardar");
  expect(api.saveDocument).not.toHaveBeenCalled();
});

it("uses the options button, confirms folder trash and closes its tabs while preserving their drafts", async () => {
  vi.mocked(api.currentWorkspace).mockResolvedValue({ ...selection, canWrite: true });
  vi.mocked(api.listDriveFolder).mockImplementation(async (_account, id) => ({ items: id === root.nodeId ? [folder] : [file] }));
  vi.mocked(api.editTree).mockImplementation(async () => {
    expect(api.writeDraft).toHaveBeenCalledWith(address, expect.objectContaining({ markdown: "Borrador dentro de anexos" }));
    vi.mocked(api.listDriveFolder).mockResolvedValue({ items: [] });
    return { trashedId: folder.nodeId };
  });
  render(<ProtonWorkspace />);
  const tree = within(await screen.findByRole("navigation", { name: "Árbol de Proton Drive" }));
  fireEvent.click(await tree.findByRole("button", { name: folder.name }));
  fireEvent.click(await tree.findByRole("button", { name: file.name }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Documento de prueba" }), { target: { value: "Borrador dentro de anexos" } });
  const options = tree.getByRole("button", { name: `Opciones de ${folder.name}` });
  fireEvent.click(options);
  const menu = within(screen.getByRole("menu", { name: `Opciones de ${folder.name}` }));
  expect(menu.getByRole("menuitem", { name: "Nueva carpeta" })).toBeVisible();
  expect(menu.getByRole("menuitem", { name: "Nuevo documento" })).toBeVisible();
  fireEvent.click(menu.getByRole("menuitem", { name: "Enviar a la papelera…" }));
  const dialog = within(screen.getByRole("dialog", { name: "Enviar a la papelera" }));
  expect(api.editTree).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "Enviar a la papelera" }));
  await waitFor(() => expect(tree.queryByRole("button", { name: folder.name })).not.toBeInTheDocument());
  expect(api.editTree).toHaveBeenCalledTimes(1);
  expect(api.editTree).toHaveBeenCalledWith("acct", "project", {
    action: "trash", nodeId: folder.nodeId, parentId: root.nodeId, expectedName: folder.name,
  });
  expect(screen.queryByRole("textbox", { name: "Documento de prueba" })).not.toBeInTheDocument();
  expect(api.discardDraft).not.toHaveBeenCalled();
});
