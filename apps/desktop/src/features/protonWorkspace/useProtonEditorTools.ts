import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { MarkdownEditorController } from "../editor/editorTypes";
import type { ProtonToolEdit, ProtonToolTarget } from "./protonToolTypes";
import type { OpenedDocument } from "./useProtonDocument";

export function useProtonEditorTools(
  editorKey: number,
  editable: boolean,
  getCurrent: () => OpenedDocument | null,
  isBusy: () => boolean,
) {
  const active = useRef<{ key: number; controller: MarkdownEditorController } | null>(null);
  const [readyEditorKey, setReadyEditorKey] = useState<number | null>(null);
  const availability = useRef({ editorKey, editable });
  useLayoutEffect(() => { availability.current = { editorKey, editable }; }, [editorKey, editable]);

  const connectController = useCallback((controller: MarkdownEditorController | null, released?: MarkdownEditorController | null) => {
    if (controller) {
      active.current = { key: editorKey, controller };
      setReadyEditorKey(editorKey);
    } else if (active.current?.controller === released) {
      active.current = null;
      setReadyEditorKey(null);
    }
  }, [editorKey]);

  const getEditableEditor = useCallback(() => {
    const current = getCurrent();
    const editor = active.current;
    const view = availability.current;
    if (!current || !editor || !view.editable || isBusy() || current.editorKey !== view.editorKey
      || current.editorKey !== editor.key || current.document.markdown === null || current.uncertain
      || (current.draft && current.draft.state !== "draft")) return null;
    return { current, controller: editor.controller };
  }, [getCurrent, isBusy]);

  const capture = useCallback((): ProtonToolTarget | null => {
    const editor = getEditableEditor();
    if (!editor) return null;
    const { controller } = editor;
    try {
      controller.flushMarkdown?.();
      const current = getCurrent();
      if (!current || current.editorKey !== editor.current.editorKey || !controller.matchesMarkdown(current.markdown)) return null;
      return {
        address: { ...current.address },
        baseRevisionId: current.draft?.baseRevisionId ?? current.document.revisionId,
        documentName: current.document.node.name,
        editorKey: current.editorKey,
        draftGeneration: current.draft?.generation ?? null,
        markdown: current.markdown,
        selection: controller.getMarkdownSelection?.() ?? null,
      };
    } catch {
      return null;
    }
  }, [getCurrent, getEditableEditor]);

  const validateTarget = useCallback((target: ProtonToolTarget) => {
    const editor = getEditableEditor();
    if (!editor) return null;
    const { current, controller } = editor;
    const { address, draft } = current;
    if (current.editorKey !== target.editorKey || address.accountId !== target.address.accountId
      || address.rootId !== target.address.rootId || address.nodeId !== target.address.nodeId
      || (draft?.baseRevisionId ?? current.document.revisionId) !== target.baseRevisionId
      || current.markdown !== target.markdown || !controller.matchesMarkdown(target.markdown)) return null;

    // A private draft write can advance the generation for the same buffer.
    if ((draft?.generation ?? null) !== target.draftGeneration && draft?.markdown !== target.markdown) return null;
    return controller;
  }, [getEditableEditor]);

  const apply = useCallback((target: ProtonToolTarget, edit: ProtonToolEdit): boolean => {
    const controller = validateTarget(target);
    if (!controller) return false;
    if (edit.kind === "replace_document") return controller.replaceMarkdown(edit.markdown, { separateHistory: true });
    const selection = target.selection;
    if (!selection) return false;
    if (edit.kind === "replace_range") {
      if (selection.from >= selection.to) return false;
      return controller.applyMarkdownAtRange?.(selection.from, selection.to, edit.markdown) ?? false;
    }
    const at = selection.position ?? selection.to;
    return controller.applyMarkdownAtRange?.(at, at, edit.markdown) ?? false;
  }, [validateTarget]);

  const controller = readyEditorKey === editorKey ? active.current?.controller ?? null : null;
  return { controller, connectController, getEditableEditor, capture, validateTarget, apply };
}
