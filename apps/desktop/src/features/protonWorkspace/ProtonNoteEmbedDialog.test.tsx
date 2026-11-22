import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readProtonResourceCatalog } from "../../lib/api/protonResources";
import { readDocument } from "../../lib/api/protonWorkspace";
import { renderProtonNotePage } from "../../lib/api/protonNoteEmbed";
import { uploadProtonImageContent } from "../../lib/api/protonImageAssets";
import { createDefaultHandwrittenContent } from "../handwritten/handwrittenModel";
import { ProtonNoteEmbedDialog } from "./ProtonNoteEmbedDialog";
import type { ProtonToolTarget } from "./protonToolTypes";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";

vi.mock("../../lib/api/protonResources",()=>({readProtonResourceCatalog:vi.fn()}));
vi.mock("../../lib/api/protonWorkspace",()=>({readDocument:vi.fn()}));
vi.mock("../../lib/api/protonNoteEmbed",()=>({renderProtonNotePage:vi.fn()}));
vi.mock("../../lib/api/protonImageAssets",()=>({uploadProtonImageContent:vi.fn()}));
const target:ProtonToolTarget={address:{accountId:"a",rootId:"root",nodeId:"target"},baseRevisionId:"target~rev",editorKey:4,
  draftGeneration:null,markdown:"# Target",documentName:"Destination.md",selection:{from:1,to:1,position:1,markdown:"",text:""}};
beforeEach(()=>{
  const note=createDefaultHandwrittenContent("source","Source");
  vi.mocked(readProtonResourceCatalog).mockResolvedValue({resources:[{kind:"handwritten",node:{nodeId:"source",name:"Source.nbnote",type:"file",revisionId:"source~rev"},parents:[]}],partial:false,scannedFolders:1});
  vi.mocked(readDocument).mockResolvedValue({node:{nodeId:"source",name:"Source.nbnote",type:"file"},revisionId:"source~rev",markdown:null,contentBase64:null,handwritten:note,draft:null});
  vi.mocked(renderProtonNotePage).mockResolvedValue({sourceName:"Source.nbnote",sourceNodeId:"source",sourceRevisionId:"source~rev",pageId:"page-1",pageNumber:1,sourceRelativePath:"../Notes/Source.nbnote",contentBase64:"cG5n"});
  vi.mocked(uploadProtonImageContent).mockResolvedValue("assets/neubiki-image.png");
});
afterEach(()=>{cleanup();vi.resetAllMocks();});
async function prepare() {
  fireEvent.change(await screen.findByRole("combobox",{name:"Nota de origen"}),{target:{value:"source"}});
  fireEvent.click(await screen.findByRole("button",{name:"Preparar vista previa"}));
  await screen.findByRole("img",{name:"Página manuscrita que se insertará"});
}
it("renders a saved source then inserts a confirmed image and the original link only after review",async()=>{
  const insert=vi.fn().mockReturnValue(true),close=vi.fn();
  render(<ProtonNoteEmbedDialog target={target} validate={()=>true} onInsert={insert} onClose={close}/>);
  await prepare();
  expect(screen.getByText("Destination.md")).toBeVisible();
  expect(uploadProtonImageContent).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"Subir e insertar página"})).toBeDisabled();
  fireEvent.click(screen.getByLabelText("He revisado la página y el destino de inserción"));
  fireEvent.click(screen.getByRole("button",{name:"Subir e insertar página"}));
  await waitFor(()=>expect(close).toHaveBeenCalledOnce());
  expect(renderProtonNotePage).toHaveBeenCalledWith(target.address,target.baseRevisionId,expect.objectContaining({nodeId:"source",revisionId:"source~rev",pageId:"page-1"}));
  expect(insert).toHaveBeenCalledWith(expect.stringContaining("[Source.nbnote](../Notes/Source.nbnote)"));
  expect(insert).toHaveBeenCalledWith(expect.stringContaining("assets/neubiki-image.png"));
});
it("preserves an uncertain upload without inserting or automatically repeating it",async()=>{
  vi.mocked(uploadProtonImageContent).mockRejectedValue(new Error("Respuesta interrumpida"));
  const insert=vi.fn();
  render(<ProtonNoteEmbedDialog target={target} validate={()=>true} onInsert={insert} onClose={vi.fn()}/>);
  await prepare();
  fireEvent.click(screen.getByLabelText("He revisado la página y el destino de inserción"));
  fireEvent.click(screen.getByRole("button",{name:"Subir e insertar página"}));
  await screen.findByText("No se confirmó la operación.");
  expect(screen.getByRole("button",{name:"Subir e insertar página"})).toBeDisabled();
  expect(insert).not.toHaveBeenCalled();
  expect(uploadProtonImageContent).toHaveBeenCalledOnce();
});

it("localizes insertion controls without changing the generated Markdown or original source link",async()=>{
  const insert=vi.fn().mockReturnValue(true);
  render(<UiLocaleProvider language="en"><ProtonNoteEmbedDialog target={target} validate={()=>true} onInsert={insert} onClose={vi.fn()}/></UiLocaleProvider>);
  fireEvent.change(await screen.findByRole("combobox",{name:"Source note"}),{target:{value:"source"}});
  fireEvent.click(await screen.findByRole("button",{name:"Prepare preview"}));
  expect(await screen.findByRole("img",{name:"Handwritten page to be inserted"})).toBeVisible();
  expect(screen.getByText("Destination.md")).toBeVisible();
  expect(screen.getByRole("button",{name:"Upload and insert page"})).toBeDisabled();
  fireEvent.click(screen.getByLabelText("I reviewed the page and insertion destination"));
  fireEvent.click(screen.getByRole("button",{name:"Upload and insert page"}));
  await waitFor(()=>expect(insert).toHaveBeenCalledOnce());
  expect(insert).toHaveBeenCalledWith("![Source.nbnote · página 1](assets/neubiki-image.png)\n\nPágina 1 de [Source.nbnote](../Notes/Source.nbnote)\n");
});
