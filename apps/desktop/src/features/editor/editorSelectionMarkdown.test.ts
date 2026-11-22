import { editorViewCtx, parserCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import { Schema, type Node } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import { history, undo } from "@milkdown/kit/prose/history";
import { expect, it } from "vitest";
import { createMarkdownEditorController } from "./editorCommands";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    image: { group: "block", attrs: { src: {} }, atom: true },
    text: { group: "inline" },
  },
  marks: { strong: {} },
});

function makeEditor() {
  const strong = schema.mark("strong");
  const paragraph = schema.node("paragraph", null, [schema.text("Un "), schema.text("plan", [strong]), schema.text(" nuevo.")]);
  const doc = schema.node("doc", null, [paragraph]);
  const view = {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 4, 8), plugins: [history()] }),
    editable: true,
    composing: false,
    dispatch(transaction: Transaction) { view.state = view.state.apply(transaction); },
  };
  const serialize = (doc: Node) => {
    const text = doc.firstChild?.firstChild;
    return text?.marks.some(mark => mark.type === strong.type) ? "**" + text.text + "**\n" : text?.text ?? "";
  };
  const parse = (source: string) => {
    const node = source.startsWith("![")
      ? schema.node("image", { src: "assets/image.png" })
      : schema.node("paragraph", null, schema.text(source.replace(/\*\*/g, ""), [strong]));
    return schema.node("doc", null, [node]);
  };
  const editor = { action: (callback: (context: { get: (key: unknown) => unknown }) => unknown) =>
    callback({ get: key => key === editorViewCtx ? view : key === serializerCtx ? serialize : parse }) } as unknown as Editor;
  return { view, controller: createMarkdownEditorController(editor) };
}

it("captures formatted Markdown and replaces the captured text in one undoable transaction", () => {
  const { view, controller } = makeEditor();
  const captured = controller.getMarkdownSelection?.();
  expect(captured).toEqual({
    focusType: "selection", from: 4, to: 8, position: null, text: "plan", markdown: "**plan**\n",
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  expect(controller.applyMarkdownAtRange?.(captured!.from, captured!.to, "**diseño**")).toBe(true);
  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.textContent).toBe("Un diseño nuevo.");
  expect(view.state.doc.firstChild?.child(1).marks[0].type.name).toBe("strong");
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.state.doc.textContent).toBe("Un plan nuevo.");
});

it("inserts a block image at the captured caret, without interpreting Markdown string offsets", () => {
  const { view, controller } = makeEditor();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)));
  const captured = controller.getMarkdownSelection?.();
  expect(captured).toEqual({ focusType: "cursor", from: 8, to: 8, position: 8, text: "", markdown: "" });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  expect(controller.applyMarkdownAtRange?.(captured!.from, captured!.to, "![Imagen](assets/image.png)")).toBe(true);
  expect(view.state.doc.childCount).toBe(3);
  expect(view.state.doc.child(0).textContent).toBe("Un plan");
  expect(view.state.doc.child(1).attrs.src).toBe("assets/image.png");
  expect(view.state.doc.child(2).textContent).toBe(" nuevo.");
});

it("rejects changes outside the current model or during composition", () => {
  const { view, controller } = makeEditor();
  const before = view.state.doc;
  expect(controller.applyMarkdownAtRange?.(4, 100, "**diseño**")).toBe(false);
  view.composing = true;
  expect(controller.getMarkdownSelection?.()).toBeNull();
  expect(controller.applyMarkdownAtRange?.(4, 8, "**diseño**")).toBe(false);
  expect(view.state.doc).toBe(before);
});
