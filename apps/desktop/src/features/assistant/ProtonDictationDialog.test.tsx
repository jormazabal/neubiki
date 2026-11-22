import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { transcribeProtonDictation } from "../../lib/api/protonDictation";
import { ProtonDictationDialog } from "./ProtonDictationDialog";

vi.mock("../../lib/api/protonDictation", () => ({ transcribeProtonDictation: vi.fn() }));
const audio = new File(["audio"], "dictation.wav", { type: "audio/wav" });
vi.mock("../transcription/ProtonAudioCapture", () => ({
  ProtonAudioCapture: ({ onClip }: { onClip: (file: File) => void }) =>
    <button type="button" onClick={() => onClip(audio)}>Preparar audio local</button>,
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const target = {
  address: { accountId: "account", rootId: "root", nodeId: "document" },
  baseRevisionId: "revision", editorKey: 2, draftGeneration: null,
  markdown: "# Texto", selection: null,
};

it("requires explicit audio submission and lets the user revise the text before adding it", async () => {
  vi.mocked(transcribeProtonDictation).mockResolvedValue({
    transcript: "Texto reconocido", model: "synthetic", durationSeconds: 5, usageRecorded: true,
  });
  const usePrompt = vi.fn();
  render(<ProtonDictationDialog target={target} defaultLanguage="es" canInsert={false}
    onInsert={vi.fn()} onUsePrompt={usePrompt} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Preparar audio local" }));
  expect(transcribeProtonDictation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enviar audio a OpenAI" }));
  const text = await screen.findByRole("textbox", { name: "Texto para revisar" });
  expect(text).toHaveValue("Texto reconocido");
  expect(transcribeProtonDictation).toHaveBeenCalledWith(target.address, "revision", audio, "es");
  expect(usePrompt).not.toHaveBeenCalled();
  fireEvent.change(text, { target: { value: "Texto revisado" } });
  fireEvent.click(screen.getByRole("button", { name: "Añadir a la consulta" }));
  expect(usePrompt).toHaveBeenCalledWith("Texto revisado");
});

it("requires a new recording after a provider result could not be confirmed", async () => {
  vi.mocked(transcribeProtonDictation).mockRejectedValue(new Error("No se confirmó la solicitud."));
  render(<ProtonDictationDialog target={target} defaultLanguage="es" canInsert={false}
    onInsert={vi.fn()} onUsePrompt={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Preparar audio local" }));
  fireEvent.click(screen.getByRole("button", { name: "Enviar audio a OpenAI" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Enviar audio a OpenAI" })).toBeNull();
  expect(transcribeProtonDictation).toHaveBeenCalledOnce();
});
