import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { contentIndexCopy } from "../../lib/i18n/contentIndexCopy";
import { readProtonContentIndex,configureProtonContentIndex,clearProtonContentIndex } from "../../lib/api/protonContentIndex";
import { ProtonContentIndexControl } from "./ProtonContentIndexControl";
import type { ProtonContentIndexStatus } from "../../types/protonContentIndex";
import { ApiError } from "../../lib/api/client";

vi.mock("../../lib/api/protonContentIndex",()=>({readProtonContentIndex:vi.fn(),configureProtonContentIndex:vi.fn(),clearProtonContentIndex:vi.fn()}));
const scope={accountId:"account",rootId:"root"};
beforeEach(()=>vi.mocked(readProtonContentIndex).mockResolvedValue({enabled:false,documentCount:0,byteLength:0}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
async function open(english=false){
  fireEvent.click(screen.getByText(english?"Local content index":"Índice local de contenido"));
  const checkbox=screen.getByRole("checkbox",{name:english?"Save a local index for content search":"Guardar un índice local para buscar contenido"});
  await waitFor(()=>expect(checkbox).toBeEnabled());return checkbox;
}
it("keeps dictionaries complete",()=>{
  expect(Object.keys(contentIndexCopy.en)).toEqual(Object.keys(contentIndexCopy.es));
});
it("refreshes the saved count after a completed indexed search without writing",async()=>{
  vi.mocked(readProtonContentIndex).mockResolvedValue({enabled:true,documentCount:0,byteLength:0});
  const view=render(<ProtonContentIndexControl {...scope} connected refreshKey={0}/>);
  await open();
  expect(screen.getByRole("button",{name:"Borrar índice…"})).toBeDisabled();
  const initialReads=vi.mocked(readProtonContentIndex).mock.calls.length;
  vi.mocked(readProtonContentIndex).mockResolvedValue({enabled:true,documentCount:2,byteLength:1024});
  view.rerender(<ProtonContentIndexControl {...scope} connected refreshKey={1}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Borrar índice…"})).toBeEnabled());
  expect(readProtonContentIndex).toHaveBeenCalledTimes(initialReads+1);
  expect(configureProtonContentIndex).not.toHaveBeenCalled();
  expect(clearProtonContentIndex).not.toHaveBeenCalled();
});
it("defaults to unchecked Spanish opt-in and configures only after explicit action while offline",async()=>{
  vi.mocked(configureProtonContentIndex).mockResolvedValue({enabled:true,documentCount:0,byteLength:0});
  render(<ProtonContentIndexControl {...scope} connected={false}/>);
  const checkbox=await open();
  expect(checkbox).not.toBeChecked();expect(configureProtonContentIndex).not.toHaveBeenCalled();
  expect(screen.getByText("Sin confirmar")).toBeVisible();
  fireEvent.click(checkbox);
  await waitFor(()=>expect(checkbox).toBeChecked());
  expect(configureProtonContentIndex).toHaveBeenCalledWith(scope,true);
  expect(clearProtonContentIndex).not.toHaveBeenCalled();
});
it("clears only after English confirmation and keeps the enabled preference",async()=>{
  vi.mocked(readProtonContentIndex).mockResolvedValue({enabled:true,documentCount:2,byteLength:1536});
  vi.mocked(clearProtonContentIndex).mockResolvedValue({enabled:true,documentCount:0,byteLength:0});
  render(<UiLocaleProvider language="en"><ProtonContentIndexControl {...scope} connected/></UiLocaleProvider>);
  const checkbox=await open(true);
  expect(screen.getByText("2 documents · 1.5 KiB")).toBeVisible();
  const clearTrigger=screen.getByRole("button",{name:"Clear index…"});
  clearTrigger.focus();
  fireEvent.click(clearTrigger);
  expect(screen.getByRole("alertdialog",{name:"Clear local index"})).toBeVisible();
  expect(clearProtonContentIndex).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  expect(clearProtonContentIndex).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Clear index…"}));
  fireEvent.click(screen.getByRole("button",{name:"Clear indexed text"}));
  await screen.findByText("The local index was cleared. Its enabled preference is preserved.");
  await waitFor(()=>expect(screen.getByRole("button",{name:"Check status"})).toHaveFocus());
  expect(clearProtonContentIndex).toHaveBeenCalledWith(scope);
  expect(checkbox).toBeChecked();expect(configureProtonContentIndex).not.toHaveBeenCalled();
});

it("allows confirmed clearing only for the native malformed-index code",async()=>{
  vi.mocked(readProtonContentIndex).mockRejectedValueOnce(new ApiError(409,"Index unavailable",undefined,undefined,"proton-content-index-unavailable"));
  vi.mocked(clearProtonContentIndex).mockResolvedValue({enabled:true,documentCount:0,byteLength:0});
  render(<UiLocaleProvider language="en"><ProtonContentIndexControl {...scope} connected={false}/></UiLocaleProvider>);
  fireEvent.click(screen.getByText("Local content index"));
  const clearTrigger=screen.getByRole("button",{name:"Clear index…"});
  await waitFor(()=>expect(clearTrigger).toBeEnabled());
  expect(screen.getByRole("checkbox",{name:"Save a local index for content search"})).toBeDisabled();
  clearTrigger.focus();fireEvent.click(clearTrigger);
  expect(clearProtonContentIndex).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Clear indexed text"}));
  await screen.findByText("The local index was cleared. Its enabled preference is preserved.");
  expect(clearProtonContentIndex).toHaveBeenCalledWith(scope);
  expect(screen.getByRole("checkbox")).toBeChecked();
  await waitFor(()=>expect(screen.getByRole("button",{name:"Check status"})).toHaveFocus());
});

it("keeps clearing blocked for other status failures",async()=>{
  vi.mocked(readProtonContentIndex).mockRejectedValue(new ApiError(409,"Scope changed",undefined,undefined,"proton-workspace-changed"));
  render(<ProtonContentIndexControl {...scope} connected={false}/>);
  fireEvent.click(screen.getByText("Índice local de contenido"));
  await screen.findByRole("alert");
  expect(screen.getByRole("button",{name:"Borrar índice…"})).toBeDisabled();
  expect(clearProtonContentIndex).not.toHaveBeenCalled();
});
it("confirms turning off the index before deleting saved text",async()=>{
  vi.mocked(readProtonContentIndex).mockResolvedValue({enabled:true,documentCount:2,byteLength:1024});
  vi.mocked(configureProtonContentIndex).mockResolvedValue({enabled:false,documentCount:0,byteLength:0});
  render(<ProtonContentIndexControl {...scope} connected={false}/>);
  const checkbox=await open();fireEvent.click(checkbox);
  expect(screen.getByRole("alertdialog",{name:"Desactivar y borrar índice"})).toBeVisible();
  expect(configureProtonContentIndex).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Desactivar y borrar"}));
  await waitFor(()=>expect(checkbox).not.toBeChecked());
  expect(configureProtonContentIndex).toHaveBeenCalledWith(scope,false);
  expect(screen.getByText("Sin texto indexado guardado.")).toBeVisible();
});
it("preserves confirmed counts after an uncertain clear and checks state without replay",async()=>{
  vi.mocked(readProtonContentIndex).mockResolvedValueOnce({enabled:true,documentCount:2,byteLength:1024})
    .mockResolvedValue({enabled:true,documentCount:0,byteLength:0});
  vi.mocked(clearProtonContentIndex).mockRejectedValue(new Error("Acknowledgement interrupted"));
  render(<UiLocaleProvider language="en"><ProtonContentIndexControl {...scope} connected={false}/></UiLocaleProvider>);
  const checkbox=await open(true);
  fireEvent.click(screen.getByRole("button",{name:"Clear index…"}));
  fireEvent.click(screen.getByRole("button",{name:"Clear indexed text"}));
  await screen.findByText("The index change was not confirmed. Check its status before repeating it.");
  expect(checkbox).toBeDisabled();expect(screen.getByText("2 documents · 1 KiB")).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Check status"}));
  await waitFor(()=>expect(checkbox).toBeEnabled());
  expect(clearProtonContentIndex).toHaveBeenCalledTimes(1);
  expect(readProtonContentIndex).toHaveBeenLastCalledWith(scope);
  expect(screen.getByText("No indexed text saved.")).toBeVisible();
});
it("isolates pending reads when changing account and root",async()=>{
  let resolve:(value:ProtonContentIndexStatus)=>void=()=>undefined;
  vi.mocked(readProtonContentIndex).mockReturnValueOnce(new Promise(done=>{resolve=done;}))
    .mockResolvedValue({enabled:false,documentCount:0,byteLength:0});
  const view=render(<ProtonContentIndexControl {...scope} connected/>);
  view.rerender(<ProtonContentIndexControl accountId="other-account" rootId="other-root" connected/>);
  const checkbox=await open();
  await act(async()=>resolve({enabled:true,documentCount:99,byteLength:999}));
  expect(checkbox).not.toBeChecked();expect(screen.queryByText(/99 documentos/)).toBeNull();
  expect(readProtonContentIndex).toHaveBeenLastCalledWith({accountId:"other-account",rootId:"other-root"},expect.any(AbortSignal));
});
