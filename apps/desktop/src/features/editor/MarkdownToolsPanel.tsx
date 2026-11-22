import { Pin, PinOff, X } from "lucide-react";
import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import "./MarkdownTools.css";

export type MarkdownToolsPinControl = { pinned: boolean; onChange: (pinned: boolean) => void };

export function MarkdownToolsPin({ pinned, onChange }: MarkdownToolsPinControl) {
  const label = pinned ? "Ocultar barra de formato" : "Fijar barra de formato";
  const Icon = pinned ? PinOff : Pin;
  return (
    <button type="button" className="workspace-control" aria-label={label} title={label} aria-pressed={pinned}
      onMouseDown={event => event.preventDefault()} onClick={() => onChange(!pinned)}>
      <Icon size={16} />
    </button>
  );
}

const viewportMargin = 8;

export function editorToolsViewport() {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

export function observeEditorToolsViewport(update: () => void) {
  const viewport = window.visualViewport;
  window.addEventListener("resize", update);
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  return () => {
    window.removeEventListener("resize", update);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
  };
}

export function MarkdownToolsPanel({ panelRef, position, pin, onClose, children }: {
  panelRef: RefObject<HTMLDivElement>;
  position?: { x: number; y: number };
  pin?: MarkdownToolsPinControl;
  onClose: () => void;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    function place() {
      if (!panel) return;
      const view = editorToolsViewport();
      panel.style.maxWidth = `${Math.max(0, view.width - 2 * viewportMargin)}px`;
      panel.style.maxHeight = `${Math.max(0, view.height - 2 * viewportMargin)}px`;
      const { width, height } = panel.getBoundingClientRect();
      const x = position?.x ?? view.left + (view.width - width) / 2;
      const y = position?.y ?? view.top + (view.height - height) / 2;
      panel.style.left = `${view.left + Math.max(viewportMargin, Math.min(x - view.left, view.width - width - viewportMargin))}px`;
      panel.style.top = `${view.top + Math.max(viewportMargin, Math.min(y - view.top, view.height - height - viewportMargin))}px`;
    }
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(panel);
    const stop = observeEditorToolsViewport(place);
    return () => { observer?.disconnect(); stop(); };
  }, [panelRef, position]);

  return (
    <div ref={panelRef} className="neubiki-editor-palette" role={position ? "dialog" : undefined}
      aria-label={position ? "Formato del texto" : undefined} onContextMenu={event => event.preventDefault()}>
      <header className="neubiki-editor-palette-header">
        <h2>Formato del texto</h2>
        <div>
          {pin && <MarkdownToolsPin {...pin} />}
          <button type="button" className="workspace-control" aria-label="Cerrar formato del texto"
            onMouseDown={event => event.preventDefault()} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="neubiki-editor-palette-scroll">
        {children}
      </div>
    </div>
  );
}
