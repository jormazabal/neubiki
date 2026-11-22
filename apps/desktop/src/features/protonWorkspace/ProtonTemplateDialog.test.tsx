import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { getDocumentTemplate, listDocumentTemplates } from "../../lib/api/documentTemplates";
import { createProtonTemplateDocument, previewProtonTemplate, prepareProtonTemplatePackage } from "../../lib/api/protonTemplates";
import { ProtonTemplateDialog } from "./ProtonTemplateDialog";

vi.mock("../../lib/api/documentTemplates", () => ({ getDocumentTemplate: vi.fn(), listDocumentTemplates: vi.fn() }));
vi.mock("../../lib/api/protonTemplates", () => ({ createProtonTemplateDocument: vi.fn(), previewProtonTemplate: vi.fn(), prepareProtonTemplatePackage: vi.fn() }));
vi.mock("./ProtonRestoreReview", () => ({
  ProtonRestoreReview: ({ destination }: { destination?: Array<{ name: string }> }) => <section aria-label="Restaurar recursos">Destino revisable: {destination?.map(node => node.name).join(" / ")}</section>,
}));
vi.mock("../editor/ReadonlyMarkdownViewer", () => ({
  ReadonlyMarkdownViewer: ({ markdown }: { markdown: string }) => <article aria-label="Vista previa del documento">{markdown}</article>,
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const root = { nodeId: "root", name: "Proyecto", type: "folder" } as const;
const template = { id: "meeting", name: "Acta Neubiki", description: "", markdown: "# {{titulo}}", variables: ["titulo"], revision: "hash", builtIn: true, createdAt: null };

function prepareCatalog() {
  vi.mocked(listDocumentTemplates).mockResolvedValue({ templates: [template], complete: true, warnings: [], scannedBytes: 0, scannedEntries: 0 });
  vi.mocked(getDocumentTemplate).mockResolvedValue(template);
  render(<ProtonTemplateDialog accountId="acct" root={root} destination={[root]}
    beforeCreate={async () => {}} onCreated={vi.fn()} onClose={vi.fn()} />);
}

it("reviews a template and prevents another creation after an uncertain result", async () => {
  vi.mocked(listDocumentTemplates).mockResolvedValue({ templates: [template], complete: true, warnings: [], scannedBytes: 0, scannedEntries: 0 });
  vi.mocked(getDocumentTemplate).mockResolvedValue(template);
  vi.mocked(previewProtonTemplate).mockResolvedValue({ name: "Acta.md", markdown: "# Acta", templateId: "meeting", revision: "hash" });
  vi.mocked(createProtonTemplateDocument).mockRejectedValue(new Error("Respuesta perdida"));
  const beforeCreate = vi.fn(async () => {});
  const onCreatePending = vi.fn();
  const user = userEvent.setup();
  render(<ProtonTemplateDialog accountId="acct" root={root} destination={[root]}
    beforeCreate={beforeCreate} onCreatePending={onCreatePending} onCreated={vi.fn()} onClose={vi.fn()} />);
  await user.selectOptions(await screen.findByRole("combobox", { name: "Plantilla" }), "meeting");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Nombre del documento" })).toBeEnabled());
  await user.type(screen.getByRole("textbox", { name: "Nombre del documento" }), "Acta");
  await user.click(screen.getByRole("button", { name: "Revisar documento" }));
  expect(await screen.findByLabelText("Vista previa del documento")).toHaveTextContent("# Acta");
  expect(createProtonTemplateDocument).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Crear en Proton" }));
  expect(await screen.findByText(/Proton no confirmó el resultado/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Crear en Proton" })).toBeNull();
  expect(beforeCreate).toHaveBeenCalledOnce();
  expect(createProtonTemplateDocument).toHaveBeenCalledOnce();
  expect(onCreatePending.mock.calls).toEqual([[true], [false]]);
});

it("clears a reviewed document when the template selection is removed", async () => {
  vi.mocked(previewProtonTemplate).mockResolvedValue({ name: "Acta.md", markdown: "# Acta", templateId: "meeting", revision: "hash" });
  prepareCatalog();
  const user = userEvent.setup();
  const selector = await screen.findByRole("combobox", { name: "Plantilla" });
  await user.selectOptions(selector, "meeting");
  await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
  await user.type(screen.getByRole("textbox"), "Acta");
  await user.click(screen.getByRole("button", { name: "Revisar documento" }));
  expect(await screen.findByRole("button", { name: "Crear en Proton" })).toBeEnabled();
  await user.selectOptions(selector, "");
  expect(screen.queryByRole("button", { name: "Crear en Proton" })).toBeNull();
  expect(screen.queryByLabelText("Vista previa del documento")).toBeNull();
  expect(createProtonTemplateDocument).not.toHaveBeenCalled();
});

it("retries a failed template load and rejects a preview for another template", async () => {
  prepareCatalog();
  vi.mocked(getDocumentTemplate).mockRejectedValueOnce(new Error("Error de lectura"));
  vi.mocked(previewProtonTemplate).mockResolvedValue({ name: "Acta.md", markdown: "# Acta", templateId: "other", revision: "hash" });
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole("combobox", { name: "Plantilla" }), "meeting");
  await user.click(await screen.findByRole("button", { name: "Reintentar plantilla" }));
  await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
  await user.type(screen.getByRole("textbox"), "Acta");
  await user.click(screen.getByRole("button", { name: "Revisar documento" }));
  expect(await screen.findByText("La vista previa no corresponde al documento y la plantilla seleccionados.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Crear en Proton" })).toBeNull();
});

it("ignores a late preview after the document input changed", async () => {
  let finish: (value: { name: string; markdown: string; templateId: string; revision: string }) => void = () => {};
  vi.mocked(previewProtonTemplate).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  prepareCatalog();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole("combobox", { name: "Plantilla" }), "meeting");
  await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
  await user.type(screen.getByRole("textbox"), "Acta");
  await user.click(screen.getByRole("button", { name: "Revisar documento" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nueva" } });
  finish({ name: "Acta.md", markdown: "# Acta", templateId: "meeting", revision: "hash" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Revisar documento" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Crear en Proton" })).toBeNull();
});


it("stages an attachment template as one reviewed package and preserves the selected destination", async () => {
  const resource = { path: "neubiki-template-resource:hash/Anexo.txt", name: "Anexo.txt", mimeType: "text/plain", sha256: "a".repeat(64), byteLength: 4, dataBase64: "dGVzdA==" };
  const detailed = { ...template, resourceCount: 1, resources: [resource] };
  vi.mocked(listDocumentTemplates).mockResolvedValue({ templates: [detailed], complete: true, warnings: [], scannedBytes: 0, scannedEntries: 0 });
  vi.mocked(getDocumentTemplate).mockResolvedValue(detailed);
  vi.mocked(previewProtonTemplate).mockResolvedValue({ name: "Acta.md", markdown: "# Acta\n[Anexo](_template-resources/hash/Anexo.txt)", templateId: "meeting", revision: "hash", previewDigest: "b".repeat(64), resources: [{ ...resource, bytes: 4 }] });
  vi.mocked(prepareProtonTemplatePackage).mockResolvedValue({ id: "transfer-resources", kind: "import", phase: "ready" } as Awaited<ReturnType<typeof prepareProtonTemplatePackage>>);
  const beforeCreate = vi.fn(async () => {}); const user = userEvent.setup();
  render(<ProtonTemplateDialog accountId="acct" root={root} destination={[root, { nodeId: "sub", name: "Informes", type: "folder" }]} beforeCreate={beforeCreate} onCreated={vi.fn()} onClose={vi.fn()} />);
  await user.selectOptions(await screen.findByRole("combobox", { name: "Plantilla" }), "meeting");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Nombre del documento" })).toBeEnabled());
  await user.type(screen.getByRole("textbox", { name: "Nombre del documento" }), "Acta");
  await user.click(screen.getByRole("button", { name: "Revisar documento" }));
  expect(await screen.findByLabelText("Adjuntos de la plantilla")).toHaveTextContent("Anexo.txt");
  await user.click(screen.getByRole("button", { name: "Preparar carpeta con adjuntos" }));
  expect(await screen.findByLabelText("Restaurar recursos")).toHaveTextContent("Proyecto / Informes");
  expect(prepareProtonTemplatePackage).toHaveBeenCalledTimes(1); expect(beforeCreate).toHaveBeenCalledTimes(1);
  expect(createProtonTemplateDocument).not.toHaveBeenCalled();
});
