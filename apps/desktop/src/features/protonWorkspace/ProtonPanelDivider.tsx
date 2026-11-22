import { useRef } from "react";

export function ProtonPanelDivider({ side, controls, width, min, max, onWidthChange, onDragChange }: {
  side: "left" | "right";
  controls: string;
  width: number;
  min: number;
  max: number;
  onWidthChange: (width: number) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const direction = side === "left" ? 1 : -1;
  const moveTo = (value: number) => onWidthChange(Math.min(max, Math.max(min, Math.round(value))));
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    onDragChange(false);
  };

  return <div className="proton-panel-divider" data-side={side} role="separator" tabIndex={0}
    aria-label={side === "left" ? "Cambiar ancho de Archivos" : "Cambiar ancho de Herramientas"}
    aria-orientation="vertical" aria-controls={controls} aria-valuemin={min} aria-valuemax={max}
    aria-valuenow={width} aria-valuetext={`${width} píxeles`}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, width };
      onDragChange(true);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start?.id === event.pointerId) moveTo(start.width + (event.clientX - start.x) * direction);
    }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onKeyDown={event => {
      const step = event.shiftKey ? 32 : 16;
      const next = event.key === "ArrowLeft" ? width - step * direction
        : event.key === "ArrowRight" ? width + step * direction
        : event.key === "Home" ? min : event.key === "End" ? max : null;
      if (next === null) return;
      event.preventDefault();
      moveTo(next);
    }} />;
}
