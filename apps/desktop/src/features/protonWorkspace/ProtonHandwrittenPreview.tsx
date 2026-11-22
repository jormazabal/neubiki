import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import type { HandwrittenNoteContent } from "../../types/domain";
import { drawPageBackground, drawStroke } from "../handwritten/handwrittenModel";
import { useHandwrittenCopy } from "../../lib/i18n/handwrittenCopy";

export function ProtonHandwrittenPreview({ note, onReload, busy }: {
  note: HandwrittenNoteContent;
  onReload: () => void;
  busy: boolean;
}) {
  const c = useHandwrittenCopy().preview;
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "limited" | "error">("loading");
  const canvas = useRef<HTMLCanvasElement>(null);
  const page = note.pages[index];
  const transcription = page && note.ocr.textByPage[page.id];

  useEffect(() => {
    const target = canvas.current;
    if (!target || !page) return;
    const spacing = Math.max(12, Number(page.background.spacing) || 32);
    const { width, height } = page.size;
    if (page.strokes.length > 20_000 || page.strokes.some(stroke => stroke.points.length > 8000)
      || (page.background.type === "dots" && width * height / (spacing * spacing) > 60_000)) {
      setStatus("limited");
      return;
    }
    const context = target.getContext("2d");
    if (!context) { setStatus("error"); return; }
    setStatus("loading");
    const scale = Math.min(2, 2048 / Math.max(width, height));
    target.width = Math.max(1, Math.round(width * scale));
    target.height = Math.max(1, Math.round(height * scale));
    context.setTransform(scale, 0, 0, scale, 0, 0);
    let frame = 0;
    let offset = 0;
    function draw() {
      if (!context) return;
      try {
        if (offset === 0) drawPageBackground(context, page);
        const start = performance.now();
        while (offset < page.strokes.length && performance.now() - start < 8) drawStroke(context, page.strokes[offset++]);
        if (offset < page.strokes.length) frame = requestAnimationFrame(draw);
        else setStatus("ready");
      } catch {
        setStatus("error");
      }
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [page]);

  return <section aria-label={c.label} className="flex h-full min-h-0 min-w-0 flex-col">
    <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
      <Button type="button" size="icon" variant="quiet" aria-label={c.previous} disabled={index === 0}
        onClick={() => setIndex(value => value - 1)}><ChevronLeft size={18} aria-hidden="true" /></Button>
      <span role="status" className="whitespace-nowrap text-sm">{c.position.replace("{current}",String(index+1)).replace("{total}",String(note.pages.length))}</span>
      <Button type="button" size="icon" variant="quiet" aria-label={c.next} disabled={index >= note.pages.length - 1}
        onClick={() => setIndex(value => value + 1)}><ChevronRight size={18} aria-hidden="true" /></Button>
      <Button type="button" size="icon" variant="quiet" aria-label={c.reload} disabled={busy} onClick={onReload}>
        <RefreshCw size={16} aria-hidden="true" />
      </Button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-4">
      {status === "loading" && <p role="status" className="text-sm">{c.loading}</p>}
      {status === "limited" && <InlineNotice tone="warning">{c.limited}</InlineNotice>}
      {status === "error" && <InlineNotice tone="error" announce="alert">{c.error}</InlineNotice>}
      <canvas ref={canvas} role="img" aria-label={page?.title || c.strokes.replace("{number}",String(index+1))} hidden={status !== "ready"}
        className="mx-auto max-w-full bg-white shadow-sm" />
      {transcription && <details className="mx-auto mt-3 max-w-2xl border border-line px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">{c.text}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{transcription}</p>
      </details>}
    </div>
  </section>;
}
