import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyProtonNoteAi, checkProtonNoteAi, generateProtonNoteAi, listProtonNoteAi, type ProtonNoteAiReceipt } from "../../lib/api/protonNoteAi";
import { createDefaultHandwrittenContent } from "../handwritten/handwrittenModel";
import { ProtonPageAiDialog } from "./ProtonPageAiDialog";
import type { OpenedDocument } from "./useProtonDocument";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";

vi.mock("../../lib/api/protonNoteAi", () => ({
  applyProtonNoteAi: vi.fn(), checkProtonNoteAi: vi.fn(), generateProtonNoteAi: vi.fn(), listProtonNoteAi: vi.fn(),
}));
vi.mock("./ProtonHandwrittenPreview", () => ({ ProtonHandwrittenPreview: () => <p>Vista previa de trazos</p> }));
vi.mock("../transcription/ProtonAudioCapture", () => ({ ProtonAudioCapture: ({ onClip }: {onClip:(file:File)=>void}) =>
  <button onClick={() => onClip(new File(["fixture"], "note.wav", {type:"audio/wav"}))}>Terminar captura local</button> }));

const note = createDefaultHandwrittenContent("source-note", "Nota");
const opened: OpenedDocument = {
  address: { accountId: "account", rootId: "root", nodeId: "node" },
  document: { node: { nodeId: "node", name: "Nota.nbnote", type: "file" }, revisionId: "base", markdown: null,
    contentBase64: null, handwritten: note, draft: null },
  markdown: "", handwritten: note, draft: null, uncertain: false, receipt: null, remoteChanged: false,
  editorKey: 3, ancestorIds: ["root"],
};
const ready: ProtonNoteAiReceipt = {
  attemptId: "note-ai-attempt", pageId: "page-1", kind: "ocr", phase: "ready", message: "Propuesta preparada.",
  createdAt: 1, expiresAt: 604801, text: "Texto por corregir", sourceDataUrl: null, strokes: null, generatedElements: null, appliedGeneration: null,
};

beforeEach(() => {
  vi.mocked(listProtonNoteAi).mockResolvedValue({ items: [] });
  vi.mocked(generateProtonNoteAi).mockResolvedValue(ready);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("requires consent and review then applies corrected text to the captured note", async () => {
  const protect = vi.fn().mockResolvedValue(undefined);
  const onApplied = vi.fn().mockReturnValue(true);
  const draft = { baseRevisionId: "base", generation: 1, markdown: "", handwritten: note, state: "draft" as const };
  vi.mocked(applyProtonNoteAi).mockResolvedValue({ draft, previousGeneration: null, receipt: { ...ready, phase: "applied" } });
  render(<ProtonPageAiDialog kind="ocr" pageId="page-1" pageNumber={1}
    controller={{ getCurrent: () => opened, protect, onApplied }} onClose={vi.fn()} />);
  const generate = screen.getByRole("button", { name: "Reconocer página" });
  expect(generate).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Confirmo el envío y su posible coste"));
  fireEvent.click(generate);
  const field = await screen.findByRole("textbox", { name: "Texto reconocido para revisar" });
  expect(protect).toHaveBeenCalledTimes(1);
  expect(generateProtonNoteAi).toHaveBeenCalledWith("ocr", opened.address, expect.objectContaining({
    pageId: "page-1", baseRevisionId: "base", expectedGeneration: null,
  }));
  expect(screen.getByRole("button", { name: "Aplicar texto revisado" })).toBeDisabled();
  fireEvent.change(field, { target: { value: "Texto corregido" } });
  fireEvent.click(screen.getByLabelText("He revisado el texto y confirmo su aplicación al borrador"));
  fireEvent.click(screen.getByRole("button", { name: "Aplicar texto revisado" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith(opened, draft, null));
  expect(applyProtonNoteAi).toHaveBeenCalledWith(opened.address, ready.attemptId, null, "Nota.nbnote", "Texto corregido");
});

it("checks a lost generation acknowledgement without sending the page again", async () => {
  vi.mocked(generateProtonNoteAi).mockRejectedValue(new Error("Respuesta interrumpida"));
  vi.mocked(checkProtonNoteAi).mockResolvedValue({ receipt: ready });
  render(<ProtonPageAiDialog kind="ocr" pageId="page-1" pageNumber={1}
    controller={{ getCurrent: () => opened, protect: vi.fn().mockResolvedValue(undefined), onApplied: vi.fn() }} onClose={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("Confirmo el envío y su posible coste"));
  fireEvent.click(screen.getByRole("button", { name: "Reconocer página" }));
  await screen.findByText("Respuesta interrumpida");
  fireEvent.click(screen.getByRole("button", { name: "Comprobar intento" }));
  expect(await screen.findByRole("textbox", { name: "Texto reconocido para revisar" })).toHaveValue(ready.text);
  expect(checkProtonNoteAi).toHaveBeenCalledTimes(1);
  expect(generateProtonNoteAi).toHaveBeenCalledTimes(1);
});

it("sends page audio only after local capture and consent, then requires reviewed text", async () => {
  vi.mocked(generateProtonNoteAi).mockResolvedValue({ ...ready, kind:"transcription", text:"Texto anterior\n\nDictado nuevo" });
  render(<ProtonPageAiDialog kind="transcription" pageId="page-1" pageNumber={1}
    controller={{ getCurrent:()=>opened, protect:vi.fn().mockResolvedValue(undefined), onApplied:vi.fn() }} onClose={vi.fn()} />);
  const send = screen.getByRole("button", {name:"Enviar audio para transcribir"});
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByRole("button", {name:"Terminar captura local"}));
  expect(generateProtonNoteAi).not.toHaveBeenCalled();
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Confirmo el envío y su posible coste"));
  fireEvent.click(send);
  expect(await screen.findByRole("textbox", {name:"Texto de la página para revisar"})).toHaveValue("Texto anterior\n\nDictado nuevo");
  expect(generateProtonNoteAi).toHaveBeenCalledWith("transcription",opened.address,expect.objectContaining({audio:expect.any(File),pageId:"page-1",baseRevisionId:"base"}));
  expect(screen.getByRole("button", {name:"Aplicar texto revisado"})).toBeDisabled();
  expect(applyProtonNoteAi).not.toHaveBeenCalled();
});

it.each([
  {kind:"ocr",title:"Recognize handwritten text",send:"Recognize page"},
  {kind:"drawing",title:"Draw with AI",send:"Generate drawing"},
  {kind:"transcription",title:"Dictate text to the page",send:"Send audio for transcription"},
] as const)("uses English $kind controls without translating source or proposal content",async({kind,title,send})=>{
  render(<UiLocaleProvider language="en"><ProtonPageAiDialog kind={kind} pageId="page-1" pageNumber={1}
    controller={{getCurrent:()=>opened,protect:vi.fn().mockResolvedValue(undefined),onApplied:vi.fn()}} onClose={vi.fn()}/></UiLocaleProvider>);
  expect(screen.getByRole("dialog",{name:title})).toBeVisible();
  expect(screen.getByText("Nota.nbnote")).toBeVisible();
  const button=screen.getByRole("button",{name:send});
  expect(button).toBeDisabled();
  if(kind==="drawing")fireEvent.change(screen.getByRole("textbox",{name:"Describe the drawing"}),{target:{value:"Árbol de decisiones"}});
  if(kind==="transcription")fireEvent.click(screen.getByRole("button",{name:"Terminar captura local"}));
  fireEvent.click(screen.getByLabelText("I confirm sending and its possible cost"));
  fireEvent.click(button);
  await waitFor(()=>expect(generateProtonNoteAi).toHaveBeenCalledOnce());
  expect(generateProtonNoteAi).toHaveBeenCalledWith(kind,opened.address,expect.objectContaining({pageId:"page-1",baseRevisionId:"base",
    ...(kind==="drawing"?{prompt:"Árbol de decisiones"}:{})}));
  if(kind!=="drawing")expect(await screen.findByRole("textbox",{name:kind==="ocr"?"Recognized text for review":"Page text for review"})).toHaveValue("Texto por corregir");
});
