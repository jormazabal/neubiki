import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api/errors";
import { getAiConfig } from "../../lib/api/config";
import { requestProtonText } from "../../lib/api/protonText";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import type { AiConfigStatus } from "../../types/domain";
import type { ProtonToolTarget } from "../protonWorkspace/protonToolTypes";
import { ProtonTranslation } from "./ProtonTranslation";

vi.mock("../../lib/api/protonText", () => ({ requestProtonText: vi.fn() }));
vi.mock("../../lib/api/config", () => ({ getAiConfig: vi.fn() }));
vi.mock("../../lib/api/client", () => ({
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));
vi.mock("../editor/ReadonlyMarkdownViewer", () => ({
  ReadonlyMarkdownViewer: ({ markdown, ariaLabel }: { markdown: string; ariaLabel: string }) =>
    <article aria-label={ariaLabel}>{markdown}</article>,
}));

const target: ProtonToolTarget = {
  address: { accountId: "account", rootId: "root", nodeId: "note" },
  baseRevisionId: "r1",
  editorKey: 7,
  draftGeneration: 2,
  markdown: "# Guide\n\nRun **the command** in `bash`.\n",
  selection: { from: 11, to: 22, text: "the command", markdown: "**the command**" },
};
const request = vi.mocked(requestProtonText);
const config = vi.mocked(getAiConfig);

function choose(scope: "selection" | "document", language: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Alcance" }), { target: { value: scope } });
  fireEvent.change(screen.getByRole("combobox", { name: "Idioma de destino" }), { target: { value: language } });
  fireEvent.click(screen.getByRole("button", { name: "Traducir" }));
}

beforeEach(() => {
  request.mockReset();
  config.mockReset();
  config.mockResolvedValue({ permissions: { editDocuments: true } } as AiConfigStatus);
});
afterEach(cleanup);

describe("ProtonTranslation", () => {
  it("presents language choices and the review in English without changing the request or output", async () => {
    const apply = vi.fn();
    request.mockResolvedValue({ kind: "replace_range", text: "**komandoa**" });
    render(<UiLocaleProvider language="en"><ProtonTranslation available capture={() => target} apply={apply} /></UiLocaleProvider>);
    fireEvent.change(screen.getByRole("combobox", { name: "Scope" }), { target: { value: "selection" } });
    const language = screen.getByRole("combobox", { name: "Target language" });
    expect(screen.getByRole("option", { name: "Basque" })).toHaveValue("Euskera");
    fireEvent.change(language, { target: { value: "Euskera" } });
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(await screen.findByRole("article", { name: "Proposed translation" })).toHaveTextContent("**komandoa**");
    expect(request.mock.calls[0]?.[0]).toMatchObject({ language: "Euskera", markdown: "**the command**" });
    expect(screen.getByRole("button", { name: "Apply to selection" })).toBeEnabled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("sends only the selected Markdown and waits for confirmation before replacing it", async () => {
    const apply = vi.fn(() => true);
    request.mockResolvedValue({ kind: "replace_range", text: "**la orden**" });
    render(<ProtonTranslation available capture={() => target} apply={apply} />);

    expect(screen.getByRole("button", { name: "Traducir" })).toBeDisabled();
    choose("selection", "Español");

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toEqual({
      ...target.address,
      baseRevisionId: target.baseRevisionId,
      kind: "translate",
      language: "Español",
      scope: "selection",
      markdown: "**the command**",
    });
    expect(await screen.findByRole("article", { name: "Traducción propuesta" })).toHaveTextContent("**la orden**");
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar a la selección" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Traducción aplicada al editor.");
    expect(apply).toHaveBeenCalledWith(target, { kind: "replace_range", markdown: "**la orden**" });
  });

  it("keeps the original target through review and disables application after a stale rejection", async () => {
    const output = "# Guide\n\nExécutez **la commande** dans `bash`.\n";
    const capture = vi.fn(() => target);
    const apply = vi.fn(() => false);
    request.mockResolvedValue({ kind: "replace_document", text: output });
    render(<ProtonTranslation available capture={capture} apply={apply} />);

    choose("document", "Francés");
    expect(request.mock.calls[0]?.[0]).toMatchObject({ scope: "document", markdown: target.markdown });
    capture.mockReturnValue({ ...target, draftGeneration: 3, markdown: "Nueva edición" });
    const confirmation = await screen.findByRole("button", { name: "Aplicar al documento" });
    fireEvent.click(confirmation);

    expect(await screen.findByRole("alert")).toHaveTextContent("La propuesta ya no se puede aplicar");
    expect(apply).toHaveBeenCalledWith(target, { kind: "replace_document", markdown: output });
    expect(confirmation).toBeDisabled();
    expect(screen.getByRole("article", { name: "Traducción propuesta" })).toBeInTheDocument();
  });

  it("keeps the translation ready for review if the edit permission was revoked", async () => {
    const apply = vi.fn();
    request.mockResolvedValue({ kind: "replace_range", text: "**la orden**" });
    render(<ProtonTranslation available capture={() => target} apply={apply} />);

    choose("selection", "Español");
    const confirmation = await screen.findByRole("button", { name: "Aplicar a la selección" });
    config.mockResolvedValue({ permissions: { editDocuments: false } } as AiConfigStatus);
    fireEvent.click(confirmation);

    expect(await screen.findByRole("alert")).toHaveTextContent("Activa el permiso de edición de documentos");
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("article", { name: "Traducción propuesta" })).toBeInTheDocument();
  });

  it("does not substitute the entire document when no text is selected", () => {
    render(<ProtonTranslation available capture={() => ({ ...target, selection: null })} apply={vi.fn()} />);

    choose("selection", "Euskera");

    expect(screen.getByRole("alert")).toHaveTextContent("Selecciona texto en el editor");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a mismatched edit type and allows retry after a provider failure", async () => {
    const apply = vi.fn();
    request.mockRejectedValueOnce(new ApiError(400, "AI", "Provider message", "not-started", "proton-ai-key-required"))
      .mockResolvedValueOnce({ kind: "replace_document", text: "Un resultado inválido" });
    render(<ProtonTranslation available capture={() => target} apply={apply} />);

    choose("selection", "Euskera");
    expect(await screen.findByRole("alert")).toHaveTextContent("Configura la clave de OpenAI en los ajustes de IA.");

    fireEvent.click(screen.getByRole("button", { name: "Traducir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no devolvió una traducción válida");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });

  it("blocks a second request while translating and cancels the wait when the panel closes", () => {
    request.mockImplementation((_input, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const { unmount } = render(<ProtonTranslation available capture={() => target} apply={vi.fn()} />);

    choose("selection", "Portugués");

    expect(screen.getByRole("status")).toHaveTextContent("Traduciendo…");
    expect(screen.getByRole("button", { name: "Traducir" })).toBeDisabled();
    expect(request).toHaveBeenCalledOnce();
    const signal = request.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
