import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { listDriveFolder } from "../../lib/api/protonWorkspace";
import { DrivePicker } from "./DrivePicker";
import { ProtonTree } from "./ProtonTree";
import type { ProtonNode } from "../../types/protonWorkspace";

vi.mock("../../lib/api/protonWorkspace",()=>({listDriveFolder:vi.fn()}));
const root:ProtonNode={nodeId:"root",name:"Mis documentos",type:"folder"};
const folder:ProtonNode={nodeId:"folder",name:"Notas personales",type:"folder"};
const file:ProtonNode={nodeId:"file",name:"Mi documento.md",type:"file",revisionId:"file~rev"};
beforeEach(()=>vi.mocked(listDriveFolder).mockResolvedValue({items:[folder,file]}));
afterEach(()=>{cleanup();vi.resetAllMocks();});

it("translates tree menus and accessible labels while preserving filenames and action contracts",async()=>{
  const action=vi.fn();
  render(<UiLocaleProvider language="en"><ProtonTree node={root} accountId="account" rootId="root" refresh={0} disabled={false} canWrite
    onOpen={vi.fn()} onExport={vi.fn()} onReachability={vi.fn()} onAction={action} onMove={vi.fn()}/></UiLocaleProvider>);
  expect(screen.getByRole("heading",{name:"Files"})).toBeVisible();
  expect(await screen.findByRole("button",{name:"Mi documento.md"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Options for Mi documento.md"}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Rename"}));
  expect(action).toHaveBeenCalledWith("rename",expect.objectContaining({node:file,parents:[root]}));
  expect(screen.getByRole("button",{name:"Notas personales"})).toBeVisible();
});

it("uses English folder controls and retains Spanish defaults and folder identities",async()=>{
  const select=vi.fn();
  const view=render(<UiLocaleProvider language="en"><DrivePicker accountId="account" path={[root]} busy={false}
    onBack={vi.fn()} onOpen={vi.fn()} onSelect={select}/></UiLocaleProvider>);
  expect(await screen.findByRole("button",{name:"Notas personales"})).toBeVisible();
  expect(screen.getByRole("heading",{name:"Choose a Proton Drive folder"})).toBeVisible();
  expect(screen.getByRole("button",{name:"Back"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Use this folder"}));
  expect(select).toHaveBeenCalledWith(root);
  view.rerender(<UiLocaleProvider language="es"><DrivePicker accountId="account" path={[root]} busy={false}
    onBack={vi.fn()} onOpen={vi.fn()} onSelect={select}/></UiLocaleProvider>);
  expect(screen.getByRole("button",{name:"Usar esta carpeta"})).toBeVisible();
  expect(screen.getByRole("button",{name:"Atrás"})).toBeVisible();
});
