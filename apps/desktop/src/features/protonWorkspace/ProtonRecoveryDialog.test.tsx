import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { exportProtonRecovery, listProtonRecovery, readProtonRecovery, removeProtonRecoveryCopies, type ProtonRecoveryEntry } from "../../lib/api/protonRecovery";
import { selectExportFilePath } from "../../lib/runtime/exportDialogs";
import { ProtonRecoveryDialog } from "./ProtonRecoveryDialog";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { recoveryCopy } from "../../lib/i18n/recoveryCopy";

vi.mock("../../lib/api/protonRecovery", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/api/protonRecovery")>(),
  exportProtonRecovery: vi.fn(), listProtonRecovery: vi.fn(), readProtonRecovery: vi.fn(), removeProtonRecoveryCopies:vi.fn(),
}));
vi.mock("../../lib/runtime/exportDialogs", () => ({ selectExportFilePath: vi.fn() }));
vi.mock("../editor/ReadonlyMarkdownViewer", () => ({ ReadonlyMarkdownViewer: ({ markdown }: { markdown: string }) => <p>{markdown}</p> }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("consults and exports an orphaned draft without an active workspace", async () => {
  const entry: ProtonRecoveryEntry = { key: { accountId: "account", rootId: "root", nodeId: "missing" },
    rootName: "Proyecto", documentName: "Acta.md", generation: 3, kind: "draft", state: "conflict" };
  vi.mocked(listProtonRecovery).mockResolvedValue({ entries: [entry], nextCursor: null, partial: false });
  vi.mocked(readProtonRecovery).mockResolvedValue({ markdown: "Tu texto conservado", fileName: "Acta-borrador.md" });
  vi.mocked(selectExportFilePath).mockResolvedValue("C:\\Exportaciones\\Acta-borrador.md");
  vi.mocked(exportProtonRecovery).mockResolvedValue({ outputPath: "C:\\Exportaciones\\Acta-borrador.md" });

  render(<ProtonRecoveryDialog workspace={null} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Acta.md/ }));
  expect(await screen.findByText("Tu texto conservado")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Exportar Markdown" }));
  expect(await screen.findByText("Se exportó Acta-borrador.md.")).toBeVisible();
  expect(selectExportFilePath).toHaveBeenCalledWith("Acta-borrador.md", "md", "es");
  expect(exportProtonRecovery).toHaveBeenCalledWith(entry, "C:\\Exportaciones\\Acta-borrador.md");
});

it("keeps recovery and trash dictionary keys complete",()=>{
  const keys=(value:object,prefix=""):string[]=>Object.entries(value).flatMap(([key,item])=>typeof item==="string"?[`${prefix}${key}`]:keys(item,`${prefix}${key}.`));
  expect(keys(recoveryCopy.en)).toEqual(keys(recoveryCopy.es));
});

it("reads and exports in English without changing the draft, source identity or export filename",async()=>{
  const entry:ProtonRecoveryEntry={key:{accountId:"account",rootId:"root",nodeId:"missing"},rootName:"Proyecto de Joseba",documentName:"Acta.md",generation:3,kind:"draft",state:"unknown"};
  vi.mocked(listProtonRecovery).mockResolvedValue({entries:[entry],nextCursor:null,partial:true});
  vi.mocked(readProtonRecovery).mockResolvedValue({markdown:"Tu texto conservado",fileName:"Acta-borrador.md"});
  vi.mocked(selectExportFilePath).mockResolvedValue("C:\\Exportaciones\\Acta-borrador.md");
  vi.mocked(exportProtonRecovery).mockResolvedValue({outputPath:"C:\\Exportaciones\\Acta-borrador.md"});
  render(<UiLocaleProvider language="en"><ProtonRecoveryDialog workspace={null} onClose={vi.fn()}/></UiLocaleProvider>);
  const button=await screen.findByRole("button",{name:/Acta.md Confirmation pending/});
  expect(screen.getByText("Some copies could not be identified or read. They were preserved unchanged.")).toBeVisible();
  expect(screen.getByText("Proyecto de Joseba")).toBeVisible();
  fireEvent.click(button);
  expect(await screen.findByText("Tu texto conservado")).toBeVisible();
  expect(screen.queryByRole("button",{name:"Remove copies…"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Export Markdown"}));
  expect(await screen.findByText("Exported Acta-borrador.md.")).toBeVisible();
  expect(selectExportFilePath).toHaveBeenCalledWith("Acta-borrador.md", "md", "en");
  expect(exportProtonRecovery).toHaveBeenCalledWith(entry,"C:\\Exportaciones\\Acta-borrador.md");
  expect(removeProtonRecoveryCopies).not.toHaveBeenCalled();
});

it("keeps the explicit confirmation before removing both original copies in English",async()=>{
  const entry:ProtonRecoveryEntry={key:{accountId:"account",rootId:"root",nodeId:"note"},rootName:"Proyecto",documentName:"Nota.md",generation:2,kind:"local-original",state:"copy"};
  vi.mocked(listProtonRecovery).mockResolvedValueOnce({entries:[entry],nextCursor:null,partial:false}).mockResolvedValue({entries:[],nextCursor:null,partial:false});
  vi.mocked(readProtonRecovery).mockResolvedValue({markdown:"Original conservado",fileName:"Nota.md"});
  vi.mocked(removeProtonRecoveryCopies).mockResolvedValue({removed:true});
  render(<UiLocaleProvider language="en"><ProtonRecoveryDialog workspace={null} onClose={vi.fn()}/></UiLocaleProvider>);
  fireEvent.click(await screen.findByRole("button",{name:/Nota.md Previous draft/}));
  fireEvent.click(await screen.findByRole("button",{name:"Remove copies…"}));
  expect(removeProtonRecoveryCopies).not.toHaveBeenCalled();
  expect(screen.getByText("Both copies of this resolution will be removed. The active draft and Proton file are preserved.")).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  expect(removeProtonRecoveryCopies).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Remove copies…"}));
  fireEvent.click(screen.getByRole("button",{name:"Remove both copies"}));
  await waitFor(()=>expect(removeProtonRecoveryCopies).toHaveBeenCalledWith(entry));
  expect(await screen.findByText("Both copies of that resolution were removed from this device.")).toBeVisible();
});
