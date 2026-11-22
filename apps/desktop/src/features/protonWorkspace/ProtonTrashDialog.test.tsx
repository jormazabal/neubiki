import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "../../lib/api/protonTrash";
import { ProtonTrashDialog } from "./ProtonTrashDialog";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";

vi.mock("../../lib/api/protonTrash", () => ({
  listProtonTrash: vi.fn(), restoreProtonTrashItem: vi.fn(), checkProtonTrashRestore: vi.fn(),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("reviews the original destination and checks a pending restore without submitting it twice", async () => {
  const scope = { accountId: "account", rootId: "root" };
  const node = { nodeId: "note", type: "file", name: "Informe.md" } as const;
  const item = { node, parentId: "folder", destination: ["Proyecto", "Informes"], trashedAt: "2026-11-17T12:00:00Z" };
  vi.mocked(api.listProtonTrash).mockResolvedValue({ items: [item], pending: [], complete: true });
  vi.mocked(api.restoreProtonTrashItem).mockResolvedValue({ state: "pending", nodeId: node.nodeId });
  vi.mocked(api.checkProtonTrashRestore).mockResolvedValue({ state: "restored", node });
  const onRestored = vi.fn();
  const user = userEvent.setup();
  render(<ProtonTrashDialog {...scope} canRestore onClose={vi.fn()} onRestored={onRestored} />);

  await user.click(await screen.findByRole("button", { name: "Restaurar Informe.md" }));
  expect(screen.getByRole("heading", { name: "Restaurar «Informe.md»" })).toBeVisible();
  expect(screen.getByText("Proyecto / Informes")).toBeVisible();
  expect(api.restoreProtonTrashItem).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Restaurar en Proton" }));
  expect(screen.getByText("Confirmación pendiente")).toBeVisible();
  expect(onRestored).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Comprobar" }));
  expect(await screen.findByText("«Informe.md» está en su carpeta original.")).toBeVisible();
  expect(api.restoreProtonTrashItem).toHaveBeenCalledTimes(1);
  expect(api.restoreProtonTrashItem).toHaveBeenCalledWith(scope, item);
  expect(api.checkProtonTrashRestore).toHaveBeenCalledTimes(1);
  expect(api.checkProtonTrashRestore).toHaveBeenCalledWith(scope, node.nodeId);
  expect(onRestored).toHaveBeenCalledOnce();
});

it("reviews English restore controls and checks a lost acknowledgement without repeating a restore",async()=>{
  const scope={accountId:"account",rootId:"root"};
  const node={nodeId:"note",type:"file",name:"Informe.md"} as const;
  const item={node,parentId:"folder",destination:["Proyecto","Informes"],trashedAt:"2026-11-18T12:00:00Z"};
  vi.mocked(api.listProtonTrash).mockResolvedValue({items:[item],pending:[],complete:true});
  vi.mocked(api.restoreProtonTrashItem).mockRejectedValueOnce(new Error("No acknowledgement"));
  vi.mocked(api.checkProtonTrashRestore).mockResolvedValue({state:"restored",node});
  const user=userEvent.setup(),onRestored=vi.fn();
  render(<UiLocaleProvider language="en"><ProtonTrashDialog {...scope} canRestore onClose={vi.fn()} onRestored={onRestored}/></UiLocaleProvider>);
  const restore=await screen.findByRole("button",{name:"Restore Informe.md"});
  expect(screen.getByText(new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short"}).format(new Date(item.trashedAt))))
    .toHaveAttribute("dateTime",item.trashedAt);
  await user.click(restore);
  expect(screen.getByRole("heading",{name:"Restore «Informe.md»"})).toBeVisible();
  expect(screen.getByText("Proyecto / Informes")).toBeVisible();
  expect(api.restoreProtonTrashItem).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Restore in Proton"}));
  expect(screen.getByText("Confirmation pending")).toBeVisible();
  expect(screen.getByText("The restore could not be confirmed. Check its status.")).toBeVisible();
  await user.click(screen.getByRole("button",{name:"Check"}));
  expect(await screen.findByText("«Informe.md» is in its original folder.")).toBeVisible();
  expect(api.restoreProtonTrashItem).toHaveBeenCalledTimes(1);
  expect(api.restoreProtonTrashItem).toHaveBeenCalledWith(scope,item);
  expect(api.checkProtonTrashRestore).toHaveBeenCalledWith(scope,node.nodeId);
  expect(onRestored).toHaveBeenCalledOnce();
});

it("keeps restore unavailable and partial-empty results distinct in English",async()=>{
  vi.mocked(api.listProtonTrash).mockResolvedValue({items:[],pending:[],complete:false});
  render(<UiLocaleProvider language="en"><ProtonTrashDialog accountId="a" rootId="root" canRestore={false} onClose={vi.fn()} onRestored={vi.fn()}/></UiLocaleProvider>);
  expect(await screen.findByText("The list is partial.")).toBeVisible();
  expect(screen.getByText("Restoring is unavailable for this folder.")).toBeVisible();
  expect(screen.getByText("No items from this folder were found in the inspected portion.")).toBeVisible();
  expect(screen.queryByRole("button",{name:"Restore…"})).toBeNull();
  expect(api.restoreProtonTrashItem).not.toHaveBeenCalled();
});
