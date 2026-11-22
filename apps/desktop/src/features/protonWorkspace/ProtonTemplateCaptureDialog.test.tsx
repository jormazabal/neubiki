import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProtonTemplateCaptureDialog } from "./ProtonTemplateCaptureDialog";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { checkProtonTemplateCapture, newProtonTemplateCaptureOperationId, prepareProtonTemplateCapture, saveProtonTemplateCapture } from "../../lib/api/protonTemplateCapture";
import type { ProtonTemplateCapturePreview, ProtonTemplateCaptureReceipt } from "../../types/protonTemplateCapture";
vi.mock("../../lib/api/protonTemplateCapture", () => ({ checkProtonTemplateCapture: vi.fn(), newProtonTemplateCaptureOperationId: vi.fn(), prepareProtonTemplateCapture: vi.fn(), saveProtonTemplateCapture: vi.fn() }));
vi.mock("../editor/ReadonlyMarkdownViewer", () => ({ ReadonlyMarkdownViewer: ({ markdown, ariaLabel }: { markdown: string; ariaLabel: string }) => <article aria-label={ariaLabel}>{markdown}</article> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const root = { nodeId: "v~root", name: "Proyecto", type: "folder" } as const;
const address = { accountId: "acct", rootId: root.nodeId, nodeId: "v~doc" };
const source = { ...address, revisionId: "v~doc~r1", name: "Acta.md" };
const prepared: ProtonTemplateCapturePreview = { schemaVersion: 1, source, digest: "a".repeat(64), markdown: "# Guardado\n[Anexo](neubiki-template-resource:hash/Anexo.txt)",
  resources: [{ kind: "attachment", name: "Anexo común.txt", path: "Anexo común.txt", bytes: 4, sha256: "b".repeat(64), mimeType: "text/plain", embedded: false }],
  privateDraftsIncluded: false, complete: true, checkedAt: "2026-11-18T00:00:00Z" };
const receipt: ProtonTemplateCaptureReceipt = { schemaVersion: 1, operationId: "template-capture-qa", digest: prepared.digest, state: "saved",
  template: { id: "custom-template-capture-qa", name: "Acta", description: "", variables: [], revision: "c".repeat(64), builtIn: false, createdAt: prepared.checkedAt, captureDigest: prepared.digest }, checkedAt: prepared.checkedAt };
function setup() { vi.mocked(newProtonTemplateCaptureOperationId).mockReturnValue("template-capture-qa"); vi.mocked(prepareProtonTemplateCapture).mockResolvedValue(prepared); }
function props() { return { workspace: { accountId: "acct", root, canWrite: false }, documentKey: address, revisionId: source.revisionId, documentName: source.name, connected: true, onClose: vi.fn() }; }
it("reviews only the saved source and requires explicit consent before a device-only save", async () => {
  setup(); vi.mocked(saveProtonTemplateCapture).mockResolvedValue(receipt); const pending = vi.fn(); const saved = vi.fn(); const user = userEvent.setup();
  render(<ProtonTemplateCaptureDialog {...props()} onPendingChange={pending} onSaved={saved} />);
  expect(prepareProtonTemplateCapture).not.toHaveBeenCalled(); expect(screen.getByRole("textbox", { name: "Nombre de la plantilla" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Revisar versión guardada" }));
  expect(await screen.findByLabelText("Vista previa de la plantilla")).toHaveTextContent("# Guardado"); expect(screen.getAllByText("Anexo común.txt").length).toBeGreaterThan(0);
  const save = screen.getByRole("button", { name: "Guardar en este dispositivo" }); expect(save).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /He revisado el contenido/ })); await user.click(save);
  expect(await screen.findByText(/está guardada como plantilla/)).toBeVisible(); expect(prepareProtonTemplateCapture).toHaveBeenCalledWith({ ...address, revisionId: source.revisionId });
  expect(saveProtonTemplateCapture).toHaveBeenCalledWith({ ...address, revisionId: source.revisionId, operationId: "template-capture-qa", digest: prepared.digest, name: "Acta", description: "", acknowledge: true });
  expect(saved).toHaveBeenCalledTimes(1); expect(pending).toHaveBeenLastCalledWith(false);
});
it("checks a lost save response without replaying and holds the close guard until resolved", async () => {
  setup(); vi.mocked(saveProtonTemplateCapture).mockRejectedValue(new Error("Respuesta perdida")); vi.mocked(checkProtonTemplateCapture).mockResolvedValue(receipt);
  const pending = vi.fn(); const options = props(); const user = userEvent.setup();
  render(<ProtonTemplateCaptureDialog {...options} onPendingChange={pending} />);
  await user.click(screen.getByRole("button", { name: "Revisar versión guardada" })); await user.click(await screen.findByRole("checkbox", { name: /He revisado el contenido/ }));
  await user.click(screen.getByRole("button", { name: "Guardar en este dispositivo" })); expect(await screen.findByText("La captura no está confirmada. Consulta su resultado antes de repetir.")).toBeVisible();
  expect(pending).toHaveBeenLastCalledWith(true); fireEvent.keyDown(document, { key: "Escape" }); expect(options.onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Guardar en este dispositivo" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Comprobar captura" })); expect(await screen.findByText(/está guardada como plantilla/)).toBeVisible();
  expect(saveProtonTemplateCapture).toHaveBeenCalledTimes(1); expect(checkProtonTemplateCapture).toHaveBeenCalledWith(vi.mocked(saveProtonTemplateCapture).mock.calls[0][0]);
  expect(pending).toHaveBeenLastCalledWith(false);
});
it("ignores a review that arrives after the active source revision changes", async () => {
  setup(); let resolve!: (value: ProtonTemplateCapturePreview) => void;
  vi.mocked(prepareProtonTemplateCapture).mockReturnValueOnce(new Promise(value => { resolve = value; })); const user = userEvent.setup();
  const view = render(<ProtonTemplateCaptureDialog {...props()} />); await user.click(screen.getByRole("button", { name: "Revisar versión guardada" }));
  view.rerender(<ProtonTemplateCaptureDialog {...props()} revisionId="v~doc~r2" />); resolve(prepared);
  await waitFor(() => expect(screen.getByRole("button", { name: "Revisar versión guardada" })).toBeEnabled());
  expect(screen.queryByLabelText("Vista previa de la plantilla")).toBeNull(); expect(saveProtonTemplateCapture).not.toHaveBeenCalled();
});
it("uses English capture captions while preserving saved document and attachment content", async () => {
  setup(); const user = userEvent.setup(); render(<UiLocaleProvider language="en"><ProtonTemplateCaptureDialog {...props()} /></UiLocaleProvider>);
  expect(screen.getByRole("dialog", { name: "Save as template" })).toBeVisible(); expect(screen.getByRole("textbox", { name: "Template name" })).toHaveValue("Acta");
  await user.click(screen.getByRole("button", { name: "Review saved version" })); expect(await screen.findByLabelText("Template preview")).toHaveTextContent("# Guardado");
  expect(screen.getAllByText("Anexo común.txt").length).toBeGreaterThan(0); expect(screen.getByRole("button", { name: "Save on this device" })).toBeDisabled();
});
