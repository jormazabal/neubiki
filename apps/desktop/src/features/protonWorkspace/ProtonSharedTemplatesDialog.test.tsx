import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProtonSharedTemplatesDialog } from "./ProtonSharedTemplatesDialog";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { listDocumentTemplates } from "../../lib/api/documentTemplates";
import { checkProtonSharedTemplates, importProtonTemplates, listProtonSharedTemplates, newSharedTemplateOperationId, publishProtonTemplates, reviewProtonTemplateImport, reviewProtonTemplatePublish } from "../../lib/api/protonSharedTemplates";
import type { SharedTemplateImportReview, SharedTemplatePublishReview, SharedTemplateReceipt } from "../../types/protonSharedTemplates";
vi.mock("../../lib/api/documentTemplates", () => ({ listDocumentTemplates: vi.fn() }));
vi.mock("../../lib/api/protonSharedTemplates", () => ({ checkProtonSharedTemplates: vi.fn(), importProtonTemplates: vi.fn(), listProtonSharedTemplates: vi.fn(), newSharedTemplateOperationId: vi.fn(), publishProtonTemplates: vi.fn(), reviewProtonTemplateImport: vi.fn(), reviewProtonTemplatePublish: vi.fn() }));
vi.mock("../editor/ReadonlyMarkdownViewer", () => ({ ReadonlyMarkdownViewer: ({ markdown, ariaLabel }: { markdown: string; ariaLabel: string }) => <article aria-label={ariaLabel}>{markdown}</article> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const root = { nodeId: "v~root", name: "Proyecto", type: "folder" } as const; const scope = { accountId: "account", rootId: root.nodeId }; const digest = "a".repeat(64); const checkedAt = "2026-11-18T00:00:00Z";
const source = { nodeId: "v~catalog", name: "Actas.neubiki-templates.json", type: "file", revisionId: "v~catalog~r1" } as const;
const catalog = [{ index: 0, name: "Acta", description: "Contenido original", markdown: "# Guardado", variables: [], resources: [{ path: "Guía.txt", name: "Guía.txt", mimeType: "text/plain", sha256: digest, bytes: 4 }] }];
const publishReview: SharedTemplatePublishReview = { ...scope, schemaVersion: 1, name: source.name, digest, reviewDigest: "b".repeat(64), checkedAt, byteLength: 250, catalog };
const importReview: SharedTemplateImportReview = { ...publishReview, source, outcomes: [{ index: 0, name: "Mi acta", status: "new", message: "", template: null }] };
const complete: SharedTemplateReceipt = { ...scope, schemaVersion: 1, purpose: "import", operationId: "template-import-qa", digest, name: source.name, source, state: "complete", active: false, checkedAt, outcomes: [{ index: 0, name: "Mi acta", status: "imported", message: "", template: { id: "custom-a", name: "Mi acta", revision: digest } }] };
function setup() {
  vi.mocked(listDocumentTemplates).mockResolvedValue({ templates: [{ id: "custom-a", name: "Acta personal", description: "", variables: [], revision: digest, builtIn: false, createdAt: checkedAt }], complete: true, warnings: [], scannedEntries: 1, scannedBytes: 100 });
  vi.mocked(listProtonSharedTemplates).mockImplementation(async input => ({ ...scope, schemaVersion: 1, items: input.readRemote ? [source] : [], partial: false, attempts: [], offset: input.offset || 0, totalAttempts: 0, checkedAt }));
  vi.mocked(newSharedTemplateOperationId).mockImplementation(purpose => `template-${purpose}-qa`);
  vi.mocked(reviewProtonTemplateImport).mockImplementation(async input => ({ ...importReview, outcomes: input.entries.length ? importReview.outcomes : [] }));
}
function props() { return { workspace: { accountId: scope.accountId, root, canWrite: true }, connected: true, onClose: vi.fn() }; }
async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Leer instantáneas de Proton" }));
  await user.click(await screen.findByRole("button", { name: `Abrir y revisar: ${source.name}` }));
  await user.click(await screen.findByRole("checkbox", { name: "Acta" }));
  await user.clear(screen.getByRole("textbox", { name: "Nombre en este dispositivo: Acta" })); await user.type(screen.getByRole("textbox", { name: "Nombre en este dispositivo: Acta" }), "Mi acta");
  await user.click(screen.getByRole("button", { name: "Revisar selección" }));
  await user.click(await screen.findByRole("checkbox", { name: /He revisado cada plantilla/ }));
}
it("requires explicit root read, per-template names, native review and consent before local import", async () => {
  setup(); vi.mocked(importProtonTemplates).mockResolvedValue(complete); const imported = vi.fn(); const pending = vi.fn(); const user = userEvent.setup();
  render(<ProtonSharedTemplatesDialog {...props()} workspace={{ ...props().workspace, canWrite: false }} onImported={imported} onPendingChange={pending} />);
  await waitFor(() => expect(listProtonSharedTemplates).toHaveBeenCalledWith(scope)); expect(reviewProtonTemplateImport).not.toHaveBeenCalled();
  await openImport(user); expect(await screen.findByLabelText("Vista previa de la plantilla")).toHaveTextContent("# Guardado"); expect(screen.getByText("Guía.txt · 0 KiB")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Guardar selección en este dispositivo" }));
  expect(await screen.findByText("Importación comprobada")).toBeVisible(); expect(importProtonTemplates).toHaveBeenCalledTimes(1);
  expect(importProtonTemplates).toHaveBeenCalledWith({ ...scope, nodeId: source.nodeId, revisionId: source.revisionId, entries: [{ index: 0, name: "Mi acta" }], digest, reviewDigest: importReview.reviewDigest, operationId: "template-import-qa", acknowledge: true, reviewedResources: true });
  expect(imported).toHaveBeenCalledWith(complete.outcomes); expect(publishProtonTemplates).not.toHaveBeenCalled(); expect(pending).toHaveBeenLastCalledWith(false);
});
it("invalidates publication consent on changes and checks a lost reply without replay or closing", async () => {
  setup(); vi.mocked(reviewProtonTemplatePublish).mockImplementation(async input => ({ ...publishReview, name: input.name }));
  vi.mocked(publishProtonTemplates).mockRejectedValue(new Error("Respuesta perdida")); vi.mocked(checkProtonSharedTemplates).mockResolvedValue({ ...complete, purpose: "publish", operationId: "template-publish-qa", state: "observed", outcomes: [], node: source });
  const options = props(); const pending = vi.fn(); const user = userEvent.setup(); render(<ProtonSharedTemplatesDialog {...options} onPendingChange={pending} />);
  await user.click(screen.getByRole("button", { name: "Publicar instantánea" })); await user.click(await screen.findByRole("checkbox", { name: "Acta personal" }));
  await user.clear(screen.getByRole("textbox", { name: "Nombre del archivo nuevo" })); await user.type(screen.getByRole("textbox", { name: "Nombre del archivo nuevo" }), source.name);
  await user.click(screen.getByRole("button", { name: "Revisar publicación" })); const consent = await screen.findByRole("checkbox", { name: /He revisado las plantillas/ });
  expect(screen.getByRole("button", { name: "Publicar copia nueva" })).toBeDisabled(); await user.click(consent);
  await user.type(screen.getByRole("textbox", { name: "Nombre del archivo nuevo" }), "x"); expect(screen.queryByRole("button", { name: "Publicar copia nueva" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Revisar publicación" })); await user.click(await screen.findByRole("checkbox", { name: /He revisado las plantillas/ })); await user.click(screen.getByRole("button", { name: "Publicar copia nueva" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("La respuesta no está confirmada. Consulta este mismo intento"); expect(pending).toHaveBeenLastCalledWith(true); fireEvent.keyDown(document, { key: "Escape" }); expect(options.onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Comprobar resultado" })); expect(await screen.findByText("Contenido verificado")).toBeVisible(); expect(publishProtonTemplates).toHaveBeenCalledTimes(1);
  expect(checkProtonSharedTemplates).toHaveBeenCalledWith({ ...scope, purpose: "publish", operationId: "template-publish-qa" }); expect(pending).toHaveBeenLastCalledWith(false);
});
it("checks an earlier local import receipt offline and preserves English UI and original content", async () => {
  setup(); vi.mocked(listProtonSharedTemplates).mockResolvedValue({ ...scope, schemaVersion: 1, items: [], partial: false, attempts: [{ ...complete, state: "pending" }], offset: 0, totalAttempts: 1, checkedAt });
  vi.mocked(checkProtonSharedTemplates).mockResolvedValue(complete); const user = userEvent.setup(); render(<UiLocaleProvider language="en"><ProtonSharedTemplatesDialog {...props()} connected={false} /></UiLocaleProvider>);
  expect(screen.getByRole("dialog", { name: "Shared templates" })).toBeVisible(); expect(screen.getByRole("button", { name: "Read snapshots from Proton" })).toBeDisabled();
  await user.click(screen.getByText("Receipts on this device")); await user.click(await screen.findByRole("button", { name: "Check result" }));
  expect(await screen.findByText("Import verified")).toBeVisible(); expect(screen.getAllByText("Mi acta").length).toBeGreaterThan(0); expect(importProtonTemplates).not.toHaveBeenCalled();
});
it("ignores a stale snapshot review after the project scope changes", async () => {
  setup(); let resolve!: (value: SharedTemplateImportReview) => void; vi.mocked(reviewProtonTemplateImport).mockReturnValueOnce(new Promise(value => { resolve = value; }));
  const user = userEvent.setup(); const view = render(<ProtonSharedTemplatesDialog {...props()} />); await user.click(screen.getByRole("button", { name: "Leer instantáneas de Proton" })); await user.click(await screen.findByRole("button", { name: `Abrir y revisar: ${source.name}` }));
  view.rerender(<ProtonSharedTemplatesDialog {...props()} workspace={{ ...props().workspace, root: { ...root, nodeId: "v~other" } }} />); resolve(importReview);
  await waitFor(() => expect(screen.getByRole("button", { name: "Leer instantáneas de Proton" })).toBeEnabled()); expect(screen.queryByLabelText("Vista previa de la plantilla")).toBeNull(); expect(importProtonTemplates).not.toHaveBeenCalled();
});
