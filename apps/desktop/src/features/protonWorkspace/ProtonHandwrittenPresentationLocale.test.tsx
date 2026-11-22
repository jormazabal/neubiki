import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { handwrittenCopy } from "../../lib/i18n/handwrittenCopy";
import { createDefaultHandwrittenContent } from "../handwritten/handwrittenModel";
import { ProtonHandwrittenPreview } from "./ProtonHandwrittenPreview";
import { ProtonHandwrittenExportActions } from "./ProtonHandwrittenExportActions";
import { ProtonAudioCapture } from "../transcription/ProtonAudioCapture";
import { startPcmAudioCapture } from "../transcription/audioCapture";
import { selectHandwrittenExportFilePath } from "../../lib/runtime/exportDialogs";
import type { OpenedDocument } from "./useProtonDocument";

vi.mock("../transcription/audioCapture",()=>({startPcmAudioCapture:vi.fn()}));
vi.mock("../../lib/runtime/exportDialogs",()=>({selectHandwrittenExportFilePath:vi.fn().mockResolvedValue(null)}));
vi.mock("../../lib/api/protonExport",()=>({exportProtonDocument:vi.fn(),exportProtonDocumentToMobile:vi.fn()}));
vi.mock("../../lib/runtime/platform",()=>({isTauriMobileRuntime:()=>false}));
vi.mock("../handwritten/handwrittenModel",async importOriginal=>({...await importOriginal<object>(),drawPageBackground:vi.fn(),drawStroke:vi.fn()}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});

it("keeps the handwritten dictionaries complete",()=>{
  const keys=(value:object,prefix=""):string[]=>Object.entries(value).flatMap(([key,item])=>typeof item==="string"?[`${prefix}${key}`]:keys(item,`${prefix}${key}.`));
  expect(keys(handwrittenCopy.en)).toEqual(keys(handwrittenCopy.es));
});

it("uses English preview and export controls without renaming note contents or exports",async()=>{
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({setTransform:vi.fn()} as unknown as CanvasRenderingContext2D);
  const note=createDefaultHandwrittenContent("note","Nota");
  note.pages[0].title="Página de Joseba";note.ocr.textByPage["page-1"]="Contenido guardado";
  const opened:OpenedDocument={address:{accountId:"a",rootId:"root",nodeId:"note"},document:{node:{nodeId:"note",name:"Mi nota.knote",type:"file"},revisionId:"rev",markdown:null,contentBase64:null,draft:null,handwritten:note},markdown:"",handwritten:note,draft:null,uncertain:false,receipt:null,remoteChanged:false,editorKey:1,ancestorIds:["root"]};
  const view=render(<UiLocaleProvider language="en"><ProtonHandwrittenPreview note={note} busy={false} onReload={vi.fn()}/>
    <ProtonHandwrittenExportActions disabled={false} snapshot={()=>opened}/></UiLocaleProvider>);
  expect(screen.getByRole("button",{name:"Previous page"})).toBeDisabled();
  expect(screen.getByText("Page 1 of 1")).toBeVisible();
  expect(view.container.querySelector("canvas")).toHaveAttribute("aria-label","Página de Joseba");
  expect(screen.getByText("Contenido guardado")).toHaveTextContent("Contenido guardado");
  fireEvent.click(screen.getByRole("button",{name:"Export"}));
  expect(screen.getByRole("dialog",{name:"Export handwritten note"})).toBeVisible();
  expect(screen.getByRole("button",{name:"PNG image of the first page"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Handwritten note (.nbnote)"}));
  await waitFor(()=>expect(selectHandwrittenExportFilePath).toHaveBeenCalledWith("Mi nota.knote","nbnote","en"));
  expect(note.pages[0].title).toBe("Página de Joseba");
});

it("uses English local capture controls and emits the same WAV only after stopping",async()=>{
  let chunk:(value:ArrayBuffer)=>void=()=>undefined;
  const stop=vi.fn().mockResolvedValue(undefined),onClip=vi.fn();
  vi.mocked(startPcmAudioCapture).mockImplementation(async callback=>{chunk=callback;return{stop};});
  render(<UiLocaleProvider language="en"><ProtonAudioCapture onClip={onClip}/></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("button",{name:"Record audio"}));
  const finish=await screen.findByRole("button",{name:"Stop recording"});
  expect(onClip).toHaveBeenCalledWith(null);
  act(()=>chunk(new ArrayBuffer(48_000)));
  expect(onClip).toHaveBeenCalledTimes(1);
  fireEvent.click(finish);
  await waitFor(()=>expect(onClip).toHaveBeenCalledWith(expect.any(File)));
  expect(screen.getByRole("button",{name:"Record again"})).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Audio ready · 1 s");
  expect(stop).toHaveBeenCalledOnce();
});
