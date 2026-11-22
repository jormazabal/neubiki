import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { resolveProtonConflict, reviewProtonConflict } from "../../lib/api/protonRecovery";
import { ProtonConflictDialog } from "./ProtonConflictDialog";
import { createDefaultHandwrittenContent } from "../handwritten/handwrittenModel";
import type { HandwrittenNoteContent } from "../../types/domain";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";

vi.mock("../../lib/api/protonRecovery", () => ({ reviewProtonConflict: vi.fn(), resolveProtonConflict: vi.fn() }));
vi.mock("../editor/ReadonlyMarkdownViewer", () => ({ ReadonlyMarkdownViewer: () => null }));
vi.mock("./ProtonHandwrittenPreview", () => ({ ProtonHandwrittenPreview: ({note}:{note:HandwrittenNoteContent}) =>
  <p>{note.pages.map(page=>page.id).join(", ")}</p> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
vi.mock("../editor/MarkdownEditor", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    MarkdownEditor: ({ markdown, onControllerChange }: {
      markdown: string;
      onControllerChange: (handle: { getMarkdownSnapshot: () => string }) => void;
    }) => {
      const live = useRef(markdown);
      useEffect(() => { onControllerChange({ getMarkdownSnapshot: () => live.current }); }, []);
      return <textarea aria-label="Editor de la resolución" defaultValue={markdown}
        onChange={event => { live.current = event.target.value; }} />;
    },
  };
});

it("requires every page choice and sends the reviewed plan with collision-free copies", async () => {
  const local = createDefaultHandwrittenContent("source-note", "Nota");
  local.ocr.textByPage["page-1"] = "Texto local";
  const remote = structuredClone(local);
  remote.pages[0].title = "Página remota";
  remote.ocr.textByPage["page-1"] = "Texto remoto";
  const review = { handwritten:true,name:"Nota.nbnote", remoteRevisionId:"note~new",remoteMarkdown:JSON.stringify(remote),
    draftGeneration:2,draftMarkdown:JSON.stringify(local) };
  vi.mocked(reviewProtonConflict).mockResolvedValue(review);
  vi.mocked(resolveProtonConflict).mockResolvedValue({node:{nodeId:"note",name:"Nota.nbnote",type:"file"},revisionId:"note~new",markdown:null,contentBase64:null,handwritten:remote,draft:null});
  const resolved = vi.fn();
  const address = {accountId:"a",rootId:"r",nodeId:"note"};
  render(<ProtonConflictDialog address={address} name="Nota.nbnote" onClose={vi.fn()} onResolved={resolved} />);
  fireEvent.click(await screen.findByRole("button",{name:"Combinar páginas"}));
  const apply = screen.getByRole("button",{name:"Aplicar resolución al borrador"});
  expect(apply).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox",{name:"Datos generales y orden de páginas"}),{target:{value:"local"}});
  expect(apply).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox",{name:"Conservar de la página 1"}),{target:{value:"both"}});
  expect(screen.getByRole("region",{name:"Vista previa de las páginas combinadas"})).toHaveTextContent("page-1, merge-page-1");
  fireEvent.click(apply);
  await waitFor(()=>expect(resolved).toHaveBeenCalledOnce());
  expect(resolveProtonConflict).toHaveBeenCalledWith(address,review,expect.any(String),{general:"local",choices:[{pageId:"page-1",choice:"both"}]});
  const submitted = JSON.parse(vi.mocked(resolveProtonConflict).mock.calls[0][2]) as HandwrittenNoteContent;
  expect(submitted.ocr.textByPage["page-1"]).toBe("Texto local");
  expect(submitted.ocr.textByPage["merge-page-1"]).toBe("Texto remoto");
  expect(local.pages).toHaveLength(1);
  expect(remote.pages).toHaveLength(1);
});

it("reviews note page choices in English while preserving page titles and OCR text",async()=>{
  const local=createDefaultHandwrittenContent("source-note","Nota");
  local.pages[0].title="Página de Joseba";local.ocr.textByPage["page-1"]="Contenido local";
  const remote=structuredClone(local);remote.ocr.textByPage["page-1"]="Contenido remoto";
  vi.mocked(reviewProtonConflict).mockResolvedValue({handwritten:true,name:"Nota.nbnote",remoteRevisionId:"note~new",draftGeneration:2,draftMarkdown:JSON.stringify(local),remoteMarkdown:JSON.stringify(remote)});
  render(<UiLocaleProvider language="en"><ProtonConflictDialog address={{accountId:"a",rootId:"r",nodeId:"note"}} name="Nota.nbnote" onClose={vi.fn()} onResolved={vi.fn()}/></UiLocaleProvider>);
  fireEvent.click(await screen.findByRole("button",{name:"Combine pages"}));
  expect(screen.getByText("1. Página de Joseba")).toBeVisible();
  expect(screen.getByRole("button",{name:"Apply resolution to draft"})).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox",{name:"General settings and page order"}),{target:{value:"local"}});
  fireEvent.change(screen.getByRole("combobox",{name:"Keep from page 1"}),{target:{value:"both"}});
  expect(screen.getByRole("button",{name:"Apply resolution to draft"})).toBeEnabled();
  expect(local.ocr.textByPage["page-1"]).toBe("Contenido local");
  expect(remote.ocr.textByPage["page-1"]).toBe("Contenido remoto");
});

it("protege cambios escritos desde la última publicación de Milkdown cuando se cierra la revisión", async () => {
  vi.mocked(reviewProtonConflict).mockResolvedValue({
    name: "Nota.md", remoteRevisionId: "note~new", remoteMarkdown: "Versión nueva", draftGeneration: 2, draftMarkdown: "Borrador original",
  });
  const onClose = vi.fn();
  render(<ProtonConflictDialog address={{ accountId: "a", rootId: "r", nodeId: "note" }} name="Nota.md"
    onClose={onClose} onResolved={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Editar antes de aplicar" }));
  const editor = screen.getByRole("textbox", { name: "Editor de la resolución" });
  fireEvent.change(editor, { target: { value: "Combinación manual" } });
  fireEvent.keyDown(editor, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeVisible();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
  expect(editor).toHaveValue("Combinación manual");
  fireEvent.keyDown(editor, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
  expect(onClose).toHaveBeenCalledOnce();
});
