import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAiConfig, updateAiConfig } from "../../lib/api/config";
import { saveOpenAiKey } from "../../lib/api/ai";
import { requestProtonText } from "../../lib/api/protonText";
import type { AiConfigStatus } from "../../types/domain";
import type { ProtonToolTarget } from "../protonWorkspace/protonToolTypes";
import { ProtonAssistant } from "./ProtonAssistant";

vi.mock("../../lib/api/config", () => ({ getAiConfig: vi.fn(), updateAiConfig: vi.fn() }));
vi.mock("../../lib/api/ai", () => ({ saveOpenAiKey: vi.fn() }));
vi.mock("../../lib/api/protonText", () => ({ requestProtonText: vi.fn() }));

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
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar al editor" }));
    expect(await screen.findByText("Propuesta aplicada al editor.")).toBeVisible();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(target, { kind: "replace_range", markdown: "Nuevo párrafo" });
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
    const permission = await screen.findByRole("checkbox", { name: "Permitir propuestas de edición" });
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
