import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {listDriveFolder} from "../../lib/api/protonWorkspace";
import {ProtonAiSourcesDialog} from "./ProtonAiSourcesDialog";
vi.mock("../../lib/api/protonWorkspace",()=>({listDriveFolder:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("reuses the source picker with text-only selection and excludes images",async()=>{
  vi.mocked(listDriveFolder).mockResolvedValue({items:[
    {nodeId:"source",name:"Informe.md",type:"file",revisionId:"source~rev"},
    {nodeId:"image",name:"Foto.png",type:"file",revisionId:"image~rev"},
  ]});
  const confirm=vi.fn();
  render(<ProtonAiSourcesDialog root={{nodeId:"root",name:"Proyecto",type:"folder"}}
    address={{accountId:"a",rootId:"root",nodeId:"active"}} initial={[]} visionEnabled={false} textOnly onConfirm={confirm} onClose={vi.fn()}/>);
  const source=await screen.findByRole("checkbox",{name:"Informe.md"});
  expect(screen.queryByText("Foto.png")).toBeNull();
  fireEvent.click(source);fireEvent.click(screen.getByRole("button",{name:"Usar selección (1)"}));
  expect(confirm).toHaveBeenCalledWith([{nodeId:"source",revisionId:"source~rev",name:"Informe.md",kind:"text"}]);
});
