import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {UiLocaleProvider} from "../../lib/i18n/UiLocale";
import {semanticCopy,semanticProjectCopy} from "../../lib/i18n/semanticCopy";
import {reviewProtonSemantic,runProtonSemantic} from "../../lib/api/protonSemantic";
import {ProtonSemanticSearchDialog} from "./ProtonSemanticSearchDialog";
import type {ProtonToolTarget} from "../protonWorkspace/protonToolTypes";
vi.mock("../../lib/api/protonSemantic",()=>({reviewProtonSemantic:vi.fn(),runProtonSemantic:vi.fn()}));
vi.mock("./ProtonAiSourcesDialog",()=>({ProtonAiSourcesDialog:({textOnly,onConfirm}:{textOnly?:boolean;onConfirm:(value:unknown[])=>void})=><button onClick={()=>onConfirm([{nodeId:"second",revisionId:"second~rev",name:"Segunda fuente.md",kind:"text"}])}>{textOnly?"Elegir texto guardado":"Selector incorrecto"}</button>}));
const target:ProtonToolTarget={address:{accountId:"a",rootId:"root",nodeId:"active"},baseRevisionId:"active~rev",editorKey:3,draftGeneration:null,markdown:"Contenido privado del editor",selection:null};
const root={nodeId:"root",name:"Proyecto",type:"folder"} as const;
const source={nodeId:"source",revisionId:"source~rev",name:"Informe de Joseba.md",kind:"text"} as const;
const quote={quoteId:"quote",issuedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+300,model:"model",estimatedEur:.1,sourceCount:1};
beforeEach(()=>{
  vi.mocked(reviewProtonSemantic).mockResolvedValue(quote);
  vi.mocked(runProtonSemantic).mockResolvedValue({state:"completed",limitedToSelection:true,usageRecorded:true,results:[{nodeId:source.nodeId,revisionId:source.revisionId,name:source.name,relevance:"high",explanation:"Concepto relacionado",evidence:"Texto verificado"}]});
});
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("requires purpose, exact source selection and explicit cost consent before sending",async()=>{
  render(<ProtonSemanticSearchDialog target={target} root={root} availableSources={[source]} onClose={vi.fn()}/>);
  expect(screen.getByRole("button",{name:"Revisar selección y coste"})).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox",{name:"Qué quieres encontrar"}),{target:{value:"Impacto en costes"}});
  fireEvent.click(screen.getByRole("button",{name:"Revisar selección y coste"}));
  const confirm=await screen.findByRole("button",{name:"Confirmar envío y clasificación"});
  expect(confirm).toBeDisabled();expect(runProtonSemantic).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox",{name:"Confirmo el propósito, estas fuentes y el coste estimado"}));
  fireEvent.click(confirm);
  expect(await screen.findByText("1. Informe de Joseba.md")).toBeVisible();
  expect(screen.getByText("Texto verificado")).toBeVisible();
  expect(runProtonSemantic).toHaveBeenCalledWith({...target.address,baseRevisionId:target.baseRevisionId,query:"Impacto en costes",sources:[{nodeId:source.nodeId,revisionId:source.revisionId}]},quote);
  expect(screen.queryByRole("button",{name:/Abrir/})).toBeNull();
});
it("invalidates review when the explicit text-only selection changes",async()=>{
  render(<ProtonSemanticSearchDialog target={target} root={root} availableSources={[source]} onClose={vi.fn()}/>);
  fireEvent.change(screen.getByRole("textbox",{name:"Qué quieres encontrar"}),{target:{value:"Propósito"}});
  fireEvent.click(screen.getByRole("button",{name:"Revisar selección y coste"}));
  await screen.findByRole("button",{name:"Confirmar envío y clasificación"});
  fireEvent.click(screen.getByRole("button",{name:"Elegir fuentes"}));
  fireEvent.click(screen.getByRole("button",{name:"Elegir texto guardado"}));
  expect(screen.queryByRole("button",{name:"Confirmar envío y clasificación"})).toBeNull();
  expect(screen.getByText("Segunda fuente.md")).toBeVisible();
  expect(runProtonSemantic).not.toHaveBeenCalled();
});
it("shows English bounded-coverage failure without replaying uncertain work",async()=>{
  vi.mocked(runProtonSemantic).mockRejectedValue(new Error("Acknowledgement interrupted"));
  render(<UiLocaleProvider language="en"><ProtonSemanticSearchDialog target={target} root={root} availableSources={[source]} onClose={vi.fn()}/></UiLocaleProvider>);
  fireEvent.change(screen.getByRole("textbox",{name:"What you want to find"}),{target:{value:"Meaning"}});
  fireEvent.click(screen.getByRole("button",{name:"Review selection and cost"}));
  const confirm=await screen.findByRole("button",{name:"Confirm send and ranking"});
  fireEvent.click(screen.getByRole("checkbox",{name:"I confirm the purpose, these sources and the estimated cost"}));fireEvent.click(confirm);
  await screen.findByText(/The result was not confirmed/);
  expect(screen.queryByRole("button",{name:"Confirm send and ranking"})).toBeNull();
  expect(screen.getByRole("textbox")).toBeDisabled();
  expect(runProtonSemantic).toHaveBeenCalledTimes(1);
});
it("does not send an expired quote and requires reviewing it again",async()=>{
  vi.mocked(reviewProtonSemantic).mockResolvedValue({...quote,expiresAt:Math.floor(Date.now()/1000)-1});
  render(<ProtonSemanticSearchDialog target={target} root={root} availableSources={[source]} onClose={vi.fn()}/>);
  fireEvent.change(screen.getByRole("textbox",{name:"Qué quieres encontrar"}),{target:{value:"Propósito"}});
  fireEvent.click(screen.getByRole("button",{name:"Revisar selección y coste"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Confirmar envío y clasificación"})).toBeDisabled());
  expect(screen.getByText("La revisión caducó. Revisa de nuevo la selección y el coste.")).toBeVisible();
  expect(runProtonSemantic).not.toHaveBeenCalled();
});
it("previews project coverage and exact revisions before a separate confirmation",async()=>{
  const reviewed={...quote,project:{complete:false,excerptedFiles:1,
    coverage:{scannedFolders:2,eligibleFiles:3,unsupportedFiles:1,unavailableFiles:1,omittedFiles:1,failedFolders:0,limited:true},
    sources:[{nodeId:source.nodeId,revisionId:source.revisionId,name:source.name,excerpted:true}]}};
  vi.mocked(reviewProtonSemantic).mockResolvedValue(reviewed);
  vi.mocked(runProtonSemantic).mockResolvedValue({state:"completed",limitedToSelection:false,usageRecorded:true,results:[]});
  render(<ProtonSemanticSearchDialog target={target} root={root} onClose={vi.fn()}/>);
  fireEvent.click(screen.getByRole("radio",{name:"Proyecto"}));
  fireEvent.change(screen.getByRole("textbox",{name:"Qué quieres encontrar"}),{target:{value:"Costes indirectos"}});
  fireEvent.click(screen.getByRole("button",{name:"Revisar cobertura y coste"}));
  const confirm=await screen.findByRole("button",{name:"Confirmar envío y clasificación"});
  expect(screen.getByText(source.name)).toBeVisible();
  expect(screen.getByText(`Revisión verificada · ${source.revisionId}`)).toBeVisible();
  expect(screen.getByText("Extractos")).toBeVisible();
  expect(screen.getByText(semanticProjectCopy.es.partial)).toBeVisible();
  expect(confirm).toBeDisabled();
  expect(runProtonSemantic).not.toHaveBeenCalled();
  const request={...target.address,baseRevisionId:target.baseRevisionId,query:"Costes indirectos",scope:"project",sources:[]};
  expect(reviewProtonSemantic).toHaveBeenCalledWith(request);
  fireEvent.click(screen.getByRole("checkbox",{name:"Confirmo el propósito, estas fuentes y el coste estimado"}));
  fireEvent.click(confirm);
  expect(await screen.findByText(semanticProjectCopy.es.results)).toBeVisible();
  expect(runProtonSemantic).toHaveBeenCalledTimes(1);
  expect(runProtonSemantic).toHaveBeenCalledWith(request,reviewed);
});
it("keeps dictionaries complete",()=>{
  expect(Object.keys(semanticCopy.en)).toEqual(Object.keys(semanticCopy.es));
  expect(Object.keys(semanticProjectCopy.en)).toEqual(Object.keys(semanticProjectCopy.es));
});
