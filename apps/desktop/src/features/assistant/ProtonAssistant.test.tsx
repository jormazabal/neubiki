import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAiConfig, updateAiConfig } from "../../lib/api/config";
import { ApiError } from "../../lib/api/errors";
import { saveOpenAiKey } from "../../lib/api/ai";
import { requestProtonText } from "../../lib/api/protonText";
import { checkProtonResearch, reviewProtonResearch } from "../../lib/api/protonResearch";
import { listDriveFolder } from "../../lib/api/protonWorkspace";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import type { AiConfigStatus } from "../../types/domain";
import type { ProtonToolTarget } from "../protonWorkspace/protonToolTypes";
import { ProtonAssistant } from "./ProtonAssistant";

vi.mock("../../lib/api/config", () => ({ getAiConfig: vi.fn(), updateAiConfig: vi.fn() }));
vi.mock("../../lib/api/ai", () => ({ saveOpenAiKey: vi.fn() }));
vi.mock("../../lib/api/protonText", () => ({ requestProtonText: vi.fn() }));
vi.mock("../../lib/api/protonResearch", () => ({ checkProtonResearch: vi.fn(), reviewProtonResearch: vi.fn(), runProtonResearch: vi.fn() }));
vi.mock("../../lib/api/protonWorkspace", () => ({ listDriveFolder: vi.fn() }));
vi.mock("../editor/ReadonlyMarkdownViewer", () => ({
  ReadonlyMarkdownViewer: ({ markdown, ariaLabel }: { markdown: string; ariaLabel: string }) => <article aria-label={ariaLabel}>{markdown}</article>,
}));

const target: ProtonToolTarget = {
  address: { accountId: "account", rootId: "root", nodeId: "node" },
  baseRevisionId: "opened-revision",
  editorKey: 5,
  draftGeneration: 3,
  markdown: "# Heading\n\nOld paragraph.",
  selection: { from: 12, to: 25, text: "Old paragraph", markdown: "Old paragraph" },
};

const configured = {
  provider: "openai",
  model: "gpt-5.4-mini",
  openaiKeyConfigured: true,
  openaiKeyPreview: "masked-preview",
  permissions: { editDocuments: true, createDocuments: false },
} as AiConfigStatus;

function mount(documentTarget = target, applyResult = true) {
  const capture = vi.fn().mockReturnValue(documentTarget);
  const apply = vi.fn().mockReturnValue(applyResult);
  render(<ProtonAssistant available capture={capture} apply={apply} />);
  return { capture, apply };
}

async function submit() {
  fireEvent.change(screen.getByRole("textbox", { name: "Pide ayuda con el documento" }), {
    target: { value: "  Revisa mi texto  " },
  });
  const send = screen.getByRole("button", { name: "Enviar" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAiConfig).mockResolvedValue(configured);
});
afterEach(cleanup);

describe("Proton assistant", () => {
  it("keeps the prompt and opens usage without repeating an unconfirmed request", async () => {
    vi.mocked(requestProtonText).mockRejectedValue(new ApiError(409, "AI", "Private upstream detail",
      "unknown", "proton-ai-provider-unconfirmed", "attempt-id"));
    const checkUsage = vi.fn();
    const props = { available: true, capture: () => target, apply: vi.fn(), onCheckAiUsage: checkUsage };
    const { rerender } = render(<UiLocaleProvider language="es"><ProtonAssistant {...props} /></UiLocaleProvider>);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se confirmó el resultado");
    rerender(<UiLocaleProvider language="en"><ProtonAssistant {...props} /></UiLocaleProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("The result is unconfirmed");
    expect(screen.queryByText("Private upstream detail")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Ask for help with the document" })).toHaveValue("  Revisa mi texto  ");
    fireEvent.click(screen.getByRole("button", { name: "Check AI usage" }));
    expect(checkUsage).toHaveBeenCalledOnce();
    expect(requestProtonText).toHaveBeenCalledOnce();
  });

  it("allows receipt recovery for the opened document without an AI key or editable context", async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ ...configured, openaiKeyConfigured: false });
    vi.mocked(checkProtonResearch).mockResolvedValue({ attempts: [] });
    const capture = vi.fn();
    render(<ProtonAssistant available={false} editorKey={target.editorKey} capture={capture} apply={vi.fn()}
      sourceScope={{ root: { nodeId: "root", name: "Proyecto", type: "folder" }, address: target.address, revisionId: target.baseRevisionId }} />);

    fireEvent.click(screen.getByRole("button", { name: "Intentos de investigación" }));
    expect(screen.getByRole("dialog", { name: "Intentos de investigación" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Revisar coste" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Consultar intentos recientes" }));
    expect(await screen.findByText("Todavía no hay intentos recientes en este documento.")).toBeVisible();
    expect(checkProtonResearch).toHaveBeenCalledWith(target.address, undefined);
    expect(capture).not.toHaveBeenCalled();
    expect(reviewProtonResearch).not.toHaveBeenCalled();
  });

  it("uses the interface language without rewriting the document or request", async () => {
    vi.mocked(requestProtonText).mockResolvedValue({ kind: "answer", text: "Respuesta del documento" });
    render(<UiLocaleProvider language="en"><ProtonAssistant available capture={() => target} apply={vi.fn()} /></UiLocaleProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Ask for help with the document" }), {
      target: { value: "Revisa mi texto" },
    });
    const send = screen.getByRole("button", { name: "Send" });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    expect(await screen.findByText("Respuesta del documento")).toBeVisible();
    expect(requestProtonText).toHaveBeenCalledWith(expect.objectContaining({
      markdown: target.markdown, prompt: "Revisa mi texto",
    }), expect.any(AbortSignal));
  });

  it("uses the captured draft context and presents an answer without an apply action", async () => {
    vi.mocked(requestProtonText).mockResolvedValue({ kind: "answer", text: "Resumen del documento" });
    const { capture, apply } = mount();
    await submit();

    expect(await screen.findByText("Resumen del documento")).toBeVisible();
    expect(capture).toHaveBeenCalledOnce();
    expect(requestProtonText).toHaveBeenCalledOnce();
    expect(requestProtonText).toHaveBeenCalledWith({
      ...target.address,
      baseRevisionId: target.baseRevisionId,
      kind: "assistant",
      markdown: target.markdown,
      selectedMarkdown: target.selection?.markdown,
      prompt: "Revisa mi texto",
    }, expect.any(AbortSignal));
    expect(screen.queryByRole("button", { name: "Aplicar al editor" })).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("waits for explicit review and applies to the captured target", async () => {
    vi.mocked(requestProtonText).mockResolvedValue({ kind: "replace_range", text: "Nuevo párrafo" });
    const { apply } = mount();
    await submit();

    expect(await screen.findByText("Nuevo párrafo")).toBeVisible();
    expect(screen.getByText(target.selection!.markdown)).toBeVisible();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar al editor" }));
    expect(await screen.findByText("Propuesta aplicada al editor.")).toBeVisible();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(target, { kind: "replace_range", markdown: "Nuevo párrafo" });
  });

  it("uses reasoning and includes the previous exchange only when selected", async () => {
    vi.mocked(requestProtonText)
      .mockResolvedValueOnce({ kind: "answer", text: "Primer resultado" })
      .mockResolvedValueOnce({ kind: "answer", text: "Segundo resultado" });
    mount();
    await submit();

    const include = await screen.findByRole("checkbox", { name: /Incluir la consulta y la respuesta anteriores/ });
    expect(include).not.toBeChecked();
    fireEvent.click(include);
    fireEvent.click(screen.getByRole("radio", { name: "Razonar" }));
    await submit();

    expect(await screen.findByText("Segundo resultado")).toBeVisible();
    expect(requestProtonText).toHaveBeenNthCalledWith(2, expect.objectContaining({
      executionMode: "reasoning",
      previousExchange: { prompt: "Revisa mi texto", answer: "Primer resultado" },
    }), expect.any(AbortSignal));
    expect(screen.getByRole("checkbox", { name: /Incluir los 2 intercambios anteriores/ })).not.toBeChecked();
  });

  it("offers multiple previous exchanges in chronological order after explicit continuation", async () => {
    vi.mocked(requestProtonText)
      .mockResolvedValueOnce({ kind: "answer", text: "Primera respuesta" })
      .mockResolvedValueOnce({ kind: "answer", text: "Segunda respuesta" })
      .mockResolvedValueOnce({ kind: "answer", text: "Tercera respuesta" });
    mount();
    await submit();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Incluir la consulta y la respuesta anteriores/ }));
    await submit();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Incluir los 2 intercambios anteriores/ }));
    await submit();
    expect(await screen.findByText("Tercera respuesta")).toBeVisible();
    expect(requestProtonText).toHaveBeenNthCalledWith(3, expect.objectContaining({
      previousExchanges: [
        { prompt: "Revisa mi texto", answer: "Primera respuesta" },
        { prompt: "Revisa mi texto", answer: "Segunda respuesta" },
      ],
    }), expect.any(AbortSignal));
  });

  it("attaches only the selected saved node and revision inside the workspace", async () => {
    vi.mocked(listDriveFolder).mockResolvedValue({ items: [
      { nodeId: target.address.nodeId, name: "Documento activo.md", type: "file", revisionId: target.baseRevisionId },
      { nodeId: "source", name: "Resumen.pdf", type: "file", revisionId: "saved-source" },
      { nodeId: "audio", name: "Audio.wav", type: "file", revisionId: "saved-audio" },
    ] });
    vi.mocked(requestProtonText).mockResolvedValue({ kind: "answer", text: "Consulta con fuente" });
    render(<ProtonAssistant available editorKey={target.editorKey} capture={() => target} apply={vi.fn()}
      sourceScope={{ root: { nodeId: "root", name: "Proyecto", type: "folder" },
        address: target.address, revisionId: target.baseRevisionId }} />);
    fireEvent.click(screen.getByRole("button", { name: "Adjuntar fuentes" }));
    const source = await screen.findByRole("checkbox", { name: "Resumen.pdf" });
    expect(screen.queryByRole("checkbox", { name: "Documento activo.md" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Audio.wav" })).toBeNull();
    fireEvent.click(source);
    fireEvent.click(screen.getByRole("button", { name: "Usar selección (1)" }));
    await submit();
    expect(await screen.findByText("Consulta con fuente")).toBeVisible();
    expect(requestProtonText).toHaveBeenCalledWith(expect.objectContaining({
      sources: [{ nodeId: "source", revisionId: "saved-source" }],
    }), expect.any(AbortSignal));
  });

  it("opens bounded semantic ranking only for the captured active scope and closes it on scope change",async()=>{
    const capture=vi.fn().mockReturnValue(target);
    const props={available:true,editorKey:target.editorKey,capture,apply:vi.fn(),sourceScope:{root:{nodeId:"root",name:"Proyecto",type:"folder" as const},address:target.address,revisionId:target.baseRevisionId}};
    const view=render(<ProtonAssistant {...props}/>);
    const trigger=screen.getByRole("button",{name:"Buscar por significado"});
    await waitFor(()=>expect(trigger).toBeEnabled());fireEvent.click(trigger);
    expect(screen.getByRole("dialog",{name:"Buscar por significado en fuentes elegidas"})).toBeVisible();
    expect(capture).toHaveBeenCalled();
    view.rerender(<ProtonAssistant {...props} editorKey={target.editorKey+1}/>);
    expect(screen.queryByRole("dialog",{name:"Buscar por significado en fuentes elegidas"})).toBeNull();
  });

  it("does not send a previous exchange after the captured revision changes", async () => {
    vi.mocked(requestProtonText).mockResolvedValue({ kind: "answer", text: "Primer resultado" });
    const { capture } = mount();
    await submit();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Incluir la consulta y la respuesta anteriores/ }));
    capture.mockReturnValue({ ...target, baseRevisionId: "a newer revision" });
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Cambió el documento o la revisión");
    expect(requestProtonText).toHaveBeenCalledOnce();
    expect(screen.queryByText("Primer resultado")).toBeNull();
  });

  it("requests private retention only for the selected submission and keeps the answer on storage failure", async () => {
    vi.mocked(requestProtonText).mockResolvedValue({ kind: "answer", text: "Resumen disponible", historySaved: false });
    mount();
    const option = screen.getByRole("checkbox", { name: /Guardar la consulta y el resultado en el historial privado/ });
    expect(option).not.toBeChecked();
    fireEvent.click(option);
    await submit();

    expect(await screen.findByText("Resumen disponible")).toBeVisible();
    expect(screen.getByText("No se confirmó la copia en el historial privado.")).toBeVisible();
    expect(option).not.toBeChecked();
    expect(requestProtonText).toHaveBeenCalledWith(expect.objectContaining({ retainHistory: true }), expect.any(AbortSignal));
  });

  it("keeps a stale proposal visible after the editor rejects its originating target", async () => {
    vi.mocked(requestProtonText).mockResolvedValue({ kind: "replace_document", text: "# Nuevo" });
    const { apply } = mount(target, false);
    await submit();

    fireEvent.click(await screen.findByRole("button", { name: "Aplicar al editor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("la revisión o la selección cambió");
    expect(screen.getByText("# Nuevo")).toBeVisible();
    expect(apply).toHaveBeenCalledOnce();
  });

  it("does not offer a range replacement for a captured caret", async () => {
    vi.mocked(requestProtonText).mockResolvedValue({ kind: "replace_range", text: "Nuevo párrafo" });
    const { apply } = mount({
      ...target,
      selection: { from: 12, to: 12, position: 12, text: "", markdown: "", focusType: "cursor" },
    });
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("no corresponde a la selección o al cursor");
    expect(screen.queryByRole("button", { name: "Aplicar al editor" })).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("checks the current edit permission before passing a reviewed proposal to the editor", async () => {
    vi.mocked(requestProtonText).mockResolvedValue({ kind: "replace_range", text: "Nuevo párrafo" });
    const { apply } = mount();
    await submit();

    vi.mocked(getAiConfig).mockResolvedValue({ ...configured, permissions: { ...configured.permissions, editDocuments: false } });
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar al editor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Activa el permiso de edición");
    expect(apply).not.toHaveBeenCalled();
  });

  it("stores a new key through existing protected settings and clears the password field", async () => {
    vi.mocked(getAiConfig).mockResolvedValueOnce({ ...configured, openaiKeyConfigured: false });
    vi.mocked(saveOpenAiKey).mockResolvedValue({ configured: true, preview: "masked-preview" });
    mount();

    const input = await screen.findByLabelText(/^Clave de OpenAI/);
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "  private-test-credential  " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar clave" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(saveOpenAiKey).toHaveBeenCalledOnce();
    expect(saveOpenAiKey).toHaveBeenCalledWith("private-test-credential");
    expect(screen.queryByText("masked-preview")).toBeNull();
  });

  it("updates edit permission without replacing the configured model or other permissions", async () => {
    vi.mocked(updateAiConfig).mockResolvedValue({ ...configured, permissions: { ...configured.permissions, editDocuments: false } });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Ajustes de IA" }));
    const permission = await screen.findByRole("switch", { name: "Permitir propuestas de edición" });
    fireEvent.click(permission);
    await waitFor(() => expect(permission).not.toBeChecked());
    expect(updateAiConfig).toHaveBeenCalledOnce();
    expect(updateAiConfig).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-5.4-mini",
      permissions: { editDocuments: false, createDocuments: false },
    });
  });
});
