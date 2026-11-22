import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MarkdownToolbar, type MarkdownToolbarProps } from "./MarkdownToolbar";
import { MarkdownToolsPanel } from "./MarkdownToolsPanel";

export { MarkdownToolsPin } from "./MarkdownToolsPanel";

type Props = Omit<MarkdownToolbarProps, "contextual" | "pinControl"> & {
  surfaceRef: RefObject<HTMLElement>;
  scope: string;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
};
type ContextPosition = { x: number; y: number; keyboard: boolean; editor: HTMLElement };

/** Both surfaces dispatch the same editor commands and retain Milkdown's selection. */
export function MarkdownTools({ surfaceRef, scope, pinned, onPinnedChange, ...toolbar }: Props) {
  const [context, setContext] = useState<ContextPosition | null>(null);
  const popup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setContext(null);
    const surface = surfaceRef.current;
    if (!surface || !toolbar.editorReady) return;
    function editorAt(target: EventTarget | null, includeCanvas = false) {
      if (!(target instanceof Element)) return null;
      const editor = target.closest<HTMLElement>('.ProseMirror[contenteditable="true"]');
      if (editor || !includeCanvas) return editor;
      // Blank document space belongs to the active editor, but controls and previews do not.
      if (target.closest('.ProseMirror, [contenteditable], button, a, input, textarea, select, [role="button"], [role="dialog"], [role="alert"], [role="toolbar"]')) return null;
      return target.closest('[data-markdown-canvas="true"]')?.querySelector<HTMLElement>('[data-markdown-active-editor="true"] .ProseMirror[contenteditable="true"]') ?? null;
    }
    function preserveSelection(event: PointerEvent) {
      if (event.button === 2 && !editorAt(event.target) && editorAt(event.target, true)) event.preventDefault();
    }
    function open(event: MouseEvent) {
      const editor = editorAt(event.target, true);
      if (!editor) return;
      event.preventDefault();
      setContext({ x: event.clientX, y: event.clientY, keyboard: false, editor });
    }
    function keyboard(event: KeyboardEvent) {
      if (event.isComposing || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
      const editor = editorAt(event.target);
      if (!editor) return;
      event.preventDefault();
      const selection = window.getSelection();
      const bounds = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : editor.getBoundingClientRect();
      setContext({ x: bounds.left, y: bounds.bottom, keyboard: true, editor });
    }
    surface.addEventListener("contextmenu", open);
    surface.addEventListener("pointerdown", preserveSelection);
    surface.addEventListener("keydown", keyboard);
    return () => {
      surface.removeEventListener("contextmenu", open);
      surface.removeEventListener("pointerdown", preserveSelection);
      surface.removeEventListener("keydown", keyboard);
    };
  }, [scope, toolbar.editorReady, surfaceRef]);

  useLayoutEffect(() => {
    if (context?.keyboard) popup.current?.querySelector<HTMLButtonElement>('[role="toolbar"] button:not(:disabled)')?.focus({ preventScroll: true });
  }, [context]);

  useEffect(() => {
    if (!context) return;
    const close = () => setContext(null);
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      close();
      context.editor.focus({ preventScroll: true });
    };
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) close(); };
    const focus = (event: FocusEvent) => {
      if (!popup.current?.contains(event.target as Node) && !context.editor.contains(event.target as Node)) close();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("focusin", focus);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("focusin", focus);
    };
  }, [context]);

  function run(action: () => void) { setContext(null); action(); }
  return <>
    {pinned && <MarkdownToolbar {...toolbar} pinControl={{ pinned, onChange: onPinnedChange }} />}
    {context && createPortal(<MarkdownToolsPanel panelRef={popup} position={context}
      pin={{ pinned, onChange: value => run(() => { onPinnedChange(value); context.editor.focus({ preventScroll: true }); }) }}
      onClose={() => run(() => context.editor.focus({ preventScroll: true }))}>
      <MarkdownToolbar {...toolbar} contextual
        onRunEditorAction={(action, options) => run(() => toolbar.onRunEditorAction(action, options))}
        onExportDocument={format => run(() => toolbar.onExportDocument(format))}
        onSaveTemplate={toolbar.onSaveTemplate ? () => run(toolbar.onSaveTemplate!) : undefined}
        onMarkdownZoomChange={zoom => run(() => toolbar.onMarkdownZoomChange(zoom))}
        onToggleMarkdownSource={() => run(() => toolbar.onToggleMarkdownSource?.())}
        onToggleHistory={() => run(toolbar.onToggleHistory)}/>
    </MarkdownToolsPanel>, document.body)}
  </>;
}
