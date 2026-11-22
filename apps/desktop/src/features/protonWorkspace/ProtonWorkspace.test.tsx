import { useEffect, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProtonAccountStatus } from "../../types/protonDirect";
import type { ProtonDocument, ProtonNode, ProtonWorkspace as Selection } from "../../types/protonWorkspace";
import * as account from "../../lib/api/protonDirect";
import * as api from "../../lib/api/protonWorkspace";
import { ProtonWorkspace } from "./ProtonWorkspace";
import type { MarkdownEditorController } from "../editor/editorTypes";
import type { ProtonDocumentToolProps, ProtonToolTarget } from "./protonToolTypes";

vi.mock("../../lib/runtime/platform", () => ({ isTauriRuntime: () => true, isMobileDeviceRuntime: () => false }));
vi.mock("../../app/useWorkspaceExit", () => ({ useWorkspaceExit: () => undefined }));
vi.mock("../../lib/api/protonDirect", () => ({
  getProtonAccount: vi.fn(), startProtonConnection: vi.fn(), pollProtonConnection: vi.fn(),
  cancelProtonConnection: vi.fn(), disconnectProtonAccount: vi.fn(),
}));
vi.mock("../../lib/api/protonWorkspace", () => ({
  currentWorkspace: vi.fn(), readDriveRoot: vi.fn(), listDriveFolder: vi.fn(), selectDriveFolder: vi.fn(),
  readDocument: vi.fn(), readAsset: vi.fn(), getWorkspaceEvents: vi.fn(), writeDraft: vi.fn(),
  saveDocument: vi.fn(), reconcileDocument: vi.fn(), discardDraft: vi.fn(),
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
  protonTools: [{ id: "assistant", label: "Asistente de prueba", panel: ({ available, capture, apply }: ProtonDocumentToolProps) => {
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

beforeEach(() => {
  vi.resetAllMocks();
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
    baseRevisionId: draft.baseRevisionId, generation: (draft.expectedGeneration ?? 0) + 1, markdown: draft.markdown, state: "draft",
  }));
});
afterEach(cleanup);

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
    baseRevisionId: "rev-1", expectedGeneration: 3, markdown: "Trabajo por recuperar.",
  }));
  expect(api.saveDocument).not.toHaveBeenCalled();
  expect(await screen.findByText("Borrador privado recuperable en este dispositivo.")).toBeVisible();
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
  await userEvent.click(await screen.findByRole("button", { name: "Asistente de prueba" }));
  await userEvent.click(await screen.findByRole("button", { name: "Capturar" }));
  expect(screen.getByText("Captura de file")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Cerrar panel" }));
  await userEvent.click(screen.getByRole("button", { name: "Asistente de prueba" }));
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
  await screen.findByText("Borrador privado recuperable en este dispositivo.");
  await userEvent.click(screen.getByRole("button", { name: "Aplicar propuesta" }));
  expect(screen.getByText("Aplicada")).toBeVisible();
  expect(editor).toHaveValue("Propuesta aplicada.");
  expect(api.saveDocument).not.toHaveBeenCalled();
});
