import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { ProtonDocumentPane } from "./ProtonDocumentPane";
import type { OpenedDocument } from "./useProtonDocument";
vi.mock("../editor/MarkdownEditor", () => ({ MarkdownEditor: ({ markdown }: { markdown: string }) => <article aria-label="Contenido original">{markdown}</article> }));
vi.mock("../editor/MarkdownTools", () => ({ MarkdownTools: () => null }));
vi.mock("../editor/MarkdownSourceViewer", () => ({ MarkdownSourceViewer: () => null }));
vi.mock("./ProtonInsertContentDialog", () => ({ ProtonInsertContentDialog: () => null }));
vi.mock("./ProtonExportActions", () => ({ ProtonExportActions: () => null }));
vi.mock("./ProtonHandwrittenExportActions", () => ({ ProtonHandwrittenExportActions: () => null }));
vi.mock("./protonImages", () => ({ imageObjectUrl: () => null, protonImageCache: () => ({ dispose: vi.fn(), resolve: vi.fn() }) }));
vi.mock("./protonTools", () => ({ protonTools: [
  { id: "assistant", label: "IA", panel: () => null }, { id: "translation", label: "Traducir", panel: () => null }, { id: "images", label: "Imágenes", panel: () => null },
] }));
vi.mock("./useProtonEditorTools", () => {
  const controller = { flushMarkdown: vi.fn() };
  return { useProtonEditorTools: () => ({ controller, connectController: vi.fn(), capture: vi.fn(), apply: vi.fn(), validateTarget: vi.fn(), getEditableEditor: vi.fn() }) };
});
afterEach(cleanup);
function document(overrides: Partial<OpenedDocument> = {}): OpenedDocument {
  return { address: { accountId: "acct", rootId: "v~root", nodeId: "v~doc" }, document: {
    node: { nodeId: "v~doc", name: "Acta del equipo.md", type: "file", revisionId: "v~doc~r1" }, revisionId: "v~doc~r1", markdown: "# Decisión en español", contentBase64: null, draft: null,
  }, markdown: "# Decisión en español", draft: null, uncertain: false, receipt: null, remoteChanged: false, editorKey: 1, ancestorIds: ["v~root"], ...overrides };
}
function props(opened = document()): ComponentProps<typeof ProtonDocumentPane> {
  return { document: opened, getCurrent: () => opened, isBusy: () => false, editorCheckpoint: { current: null }, edited: false, connected: true, busy: false, canWrite: true,
    tabs: null, toolsId: "tools", toolsHidden: false, compact: false, onShowTools: vi.fn(), aiSettingsRevision: 0, onEdit: vi.fn(), onEditHandwritten: vi.fn(), onProtectNote: vi.fn(async () => {}), onNoteAiApplied: vi.fn(),
    onProtect: vi.fn(), onSave: vi.fn(), onReconcile: vi.fn(), onReviewConflict: vi.fn(), onOpenReference: vi.fn(), onDiscard: vi.fn(), onReload: vi.fn(), exportRequested: false, onExportRequestHandled: vi.fn() };
}
it("switches document framework captions without changing names or Markdown and preserves reviewed discard", () => {
  const opened = document({ draft: { baseRevisionId: "v~doc~r1", markdown: "# Decisión en español", generation: 1, state: "draft" } }); const options = props(opened);
  const view = render(<UiLocaleProvider language="es"><ProtonDocumentPane {...options} /></UiLocaleProvider>);
  expect(screen.getByRole("button", { name: "Guardar en Proton" })).toBeVisible(); expect(screen.getByRole("button", { name: "Traducir" })).toBeVisible();
  view.rerender(<UiLocaleProvider language="en"><ProtonDocumentPane {...options} /></UiLocaleProvider>);
  expect(screen.getByRole("button", { name: "Find" })).toBeVisible(); expect(screen.getByRole("button", { name: "Translate" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Images" })).toBeVisible(); expect(screen.getByRole("status")).toHaveTextContent("Local draft");
  expect(screen.getByRole("heading", { name: "Acta del equipo.md" })).toBeVisible(); expect(screen.getByLabelText("Contenido original")).toHaveTextContent("# Decisión en español");
  fireEvent.click(screen.getByRole("button", { name: "Save to Proton" })); expect(options.onSave).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Discard draft…" })); expect(options.onDiscard).not.toHaveBeenCalled();
  expect(screen.getByText("The draft on this device will be deleted. The file in Proton will not change.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" })); expect(options.onDiscard).toHaveBeenCalledTimes(1);
});
it("keeps uncertain saves protected and localizes narrow-layout tools", () => {
  const options = { ...props(document({ uncertain: true })), compact: true, connected: false };
  const view = render(<UiLocaleProvider language="en"><ProtonDocumentPane {...options} /></UiLocaleProvider>);
  expect(screen.getByRole("status")).toHaveTextContent("Save awaiting verification."); expect(screen.getByRole("button", { name: "Check revision" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save to Proton" })).toBeNull();
  expect(screen.getByText("Connection unconfirmed. Reconnect to continue editing.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Tools" })); expect(screen.getByRole("button", { name: "Back to document" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to document" }));
  view.rerender(<UiLocaleProvider language="en"><ProtonDocumentPane {...options} connected /></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Check revision" })); expect(options.onReconcile).toHaveBeenCalledTimes(1); expect(options.onSave).not.toHaveBeenCalled();
});
it("localizes an unavailable preview while retaining its original filename", () => {
  const opened = document(); opened.document = { ...opened.document, node: { ...opened.document.node, name: "Foto privada.png" }, markdown: null };
  render(<UiLocaleProvider language="en"><ProtonDocumentPane {...props(opened)} /></UiLocaleProvider>);
  expect(screen.getByText("A preview of this file could not be displayed.")).toBeVisible(); expect(screen.getByRole("status")).toHaveTextContent("Preview.");
  expect(screen.getByRole("heading", { name: "Foto privada.png" })).toBeVisible(); expect(screen.queryByRole("button", { name: "Save to Proton" })).toBeNull();
});
