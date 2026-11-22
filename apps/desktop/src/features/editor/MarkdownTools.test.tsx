import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownTools, MarkdownToolsPin } from "./MarkdownTools";

const run = vi.fn();
function Harness({ ready = true, scope = "document", initialPinned = true }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(initialPinned);
  return <>
    <MarkdownToolsPin pinned={pinned} onChange={setPinned}/>
    <MarkdownTools surfaceRef={surfaceRef} scope={scope} pinned={pinned} onPinnedChange={setPinned}
      editorReady={ready} historyOpen={false} historyEnabled historyDisabledReason="" markdownZoomPercent={100}
      activeActions={{}} editorHistoryState={{ canUndo: true, canRedo: false, undoDepth: 1, redoDepth: 0 }}
      onRunEditorAction={run} onExportDocument={vi.fn()} onMarkdownZoomChange={vi.fn()} onToggleHistory={vi.fn()}/>
    <div ref={surfaceRef}>
      <div data-markdown-canvas="true" data-testid="canvas">
      <div hidden data-markdown-active-editor={false}><div className="ProseMirror" contentEditable suppressContentEditableWarning>Documento inactivo</div></div>
      <div data-markdown-active-editor="true">
      <div role="textbox" className="ProseMirror" contentEditable suppressContentEditableWarning>Texto seleccionado</div>
      </div>
      <div data-testid="blank"> </div>
      <button>Control del documento</button>
      <div data-testid="preview" className="ProseMirror" contentEditable={false}>Versión anterior</div>
      </div>
    </div>
    <button>Fuera</button>
  </>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("MarkdownTools", () => {
  it.each(["canvas", "blank"])("opens on %s space, preserving selection and targeting the active document", async area => {
    render(<Harness initialPinned={false}/>);
    const editor = screen.getByRole("textbox");
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    expect(fireEvent.contextMenu(screen.getByTestId(area), { clientX: 400, clientY: 600 })).toBe(false);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Negrita" }));
    expect(run).toHaveBeenCalledWith("bold", undefined);
    expect(window.getSelection()!.toString()).toBe("Texto seleccionado");
    fireEvent.contextMenu(screen.getByTestId(area));
    await userEvent.keyboard("{Escape}");
    expect(editor).toHaveFocus();
  });

  it("leaves controls and read-only content with their own context behavior", () => {
    render(<Harness/>);
    expect(fireEvent.contextMenu(screen.getByRole("button", { name: "Control del documento" }))).toBe(true);
    expect(fireEvent.contextMenu(screen.getByTestId("preview"))).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows the pinned toolbar, hides it and restores it without requiring a context menu", async () => {
    render(<Harness/>);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ocultar barra de formato" }));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Fijar barra de formato" }));
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it.each([true, false])("right click works with pinned=%s and preserves selected text when applying formatting", async initialPinned => {
    render(<Harness initialPinned={initialPinned}/>);
    const editor = screen.getByRole("textbox");
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.firstChild!, 0); range.setEnd(editor.firstChild!, 5);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.contextMenu(editor, { clientX: 200, clientY: 250 });
    const menu = screen.getByRole("dialog", { name: "Formato del texto" });
    expect(window.getSelection()!.toString()).toBe("Texto");
    await userEvent.click(within(menu).getByRole("button", { name: "Negrita" }));
    expect(run).toHaveBeenCalledWith("bold", undefined);
    expect(window.getSelection()!.toString()).toBe("Texto");
    expect(editor).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores read-only previews and disabled editor states, and closes when switching documents", () => {
    const { rerender } = render(<Harness/>);
    fireEvent.contextMenu(screen.getByTestId("preview"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("textbox"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(<Harness scope="another-document"/>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<Harness ready={false}/>);
    fireEvent.contextMenu(screen.getByRole("textbox"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("supports keyboard context entry, nested menus and Escape back to the editor", async () => {
    render(<Harness initialPinned={false}/>);
    const editor = screen.getByRole("textbox");
    editor.focus();
    window.getSelection()?.removeAllRanges();
    fireEvent.keyDown(editor, { key: "F10", shiftKey: true });
    const trigger = screen.getByRole("button", { name: "Formato de bloque" });
    expect(trigger).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(editor).toHaveFocus();
  });

  it("closes on outside interaction and can pin tools from the floating panel", async () => {
    render(<Harness initialPinned={false}/>);
    fireEvent.contextMenu(screen.getByRole("textbox"));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Fijar barra de formato" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveFocus();
    fireEvent.contextMenu(screen.getByRole("textbox"));
    await userEvent.click(screen.getByRole("button", { name: "Fuera" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
