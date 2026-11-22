import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { floatingViewportPixels } from "../../lib/theme/floatingViewport";

type Rect = { left: number; right: number; top: number; bottom: number };
type Viewport = { left: number; top: number; width: number; height: number };
const LayerDepth = createContext(0);

export function placeFloatingLayer(anchor: Rect, size: { width: number; height: number }, viewport: Viewport, side: boolean, align: "start" | "end") {
  const edge = 8, gap = 6;
  const width = Math.min(size.width, viewport.width - edge * 2);
  const height = Math.min(size.height, viewport.height - edge * 2);
  const leftEdge = viewport.left + edge, rightEdge = viewport.left + viewport.width - edge;
  const topEdge = viewport.top + edge, bottomEdge = viewport.top + viewport.height - edge;
  let left = align === "start" ? anchor.left : anchor.right - width;
  let top = anchor.top - height - gap;
  let overlap = false;
  if (side) {
    if (anchor.right + gap + width <= rightEdge) left = anchor.right + gap;
    else if (anchor.left - gap - width >= leftEdge) left = anchor.left - width - gap;
    else { left = anchor.left; overlap = true; }
    top = anchor.top;
  } else if (top < topEdge && bottomEdge - anchor.bottom > anchor.top - topEdge) top = anchor.bottom + gap;
  return { left: Math.max(leftEdge, Math.min(left, rightEdge - width)), top: Math.max(topEdge, Math.min(top, bottomEdge - height)), overlap };
}

/** Body-level popovers escape panel clipping. Nested layers flip or overlap with a back control. */
export function FloatingLayer({ anchorRef, width, side = false, align = "start", onDismiss, children, label }: {
  anchorRef: RefObject<HTMLElement>; width: number; side?: boolean; align?: "start" | "end";
  onDismiss?: () => void; children: ReactNode; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const depth = useContext(LayerDepth);
  const [position, setPosition] = useState({ left: 8, top: 8, overlap: false });
  const [anchorVisible, setAnchorVisible] = useState(true);
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
  useLayoutEffect(() => {
    let frame = 0;
    function place() {
      const anchor = anchorRef.current, layer = ref.current;
      if (!anchor || !layer) return;
      for (let node: HTMLElement | null = anchor; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden") {
          setAnchorVisible(false);
          return;
        }
      }
      setAnchorVisible(true);
      const visual = window.visualViewport;
      const view = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight };
      const next = placeFloatingLayer(anchor.getBoundingClientRect(), layer.getBoundingClientRect(), view, side, align);
      setViewport(old => Object.keys(view).every(key => view[key as keyof typeof view] === old[key as keyof typeof old]) ? old : view);
      setPosition(old => old.left === next.left && old.top === next.top && old.overlap === next.overlap ? old : next);
    }
    function schedule() { place(); cancelAnimationFrame(frame); frame = requestAnimationFrame(place); }
    schedule();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (ref.current) observer?.observe(ref.current);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    const visibility = new MutationObserver(schedule);
    for (let node: HTMLElement | null = anchorRef.current; node; node = node.parentElement) {
      visibility.observe(node, { attributes: true, attributeFilter: ["hidden", "style", "class", "inert", "aria-hidden"] });
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      observer?.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [anchorRef, side, align]);
  function dismiss() {
    const anchor = anchorRef.current;
    (anchor?.matches("button,textarea,input") ? anchor : anchor?.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
    onDismiss?.();
  }
  return createPortal(<LayerDepth.Provider value={depth + 1}>
    <div ref={ref} data-floating-layer aria-label={label}
      style={{ position: "fixed", left: floatingViewportPixels(position.left), top: floatingViewportPixels(position.top), width,
        maxWidth: floatingViewportPixels(viewport.width - 16), maxHeight: floatingViewportPixels(viewport.height - 16),
        overflowY: "auto", overscrollBehavior: "contain", zIndex: 110 + depth, pointerEvents: anchorVisible ? "auto" : "none", visibility: anchorVisible ? "visible" : "hidden" }}
      className="rounded-2xl bg-white text-ink-primary shadow-menu"
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && onDismiss && (event.key === "Escape" || (side && event.key === "ArrowLeft"))) {
          event.preventDefault(); event.stopPropagation(); dismiss();
        }
      }}>
      {position.overlap && onDismiss && <button type="button" className="w-full border-b border-line px-3 py-2 text-left text-xs text-ink-secondary hover:bg-brand-hover" onClick={dismiss}>← Volver</button>}
      {children}
    </div>
  </LayerDepth.Provider>, document.body);
}
