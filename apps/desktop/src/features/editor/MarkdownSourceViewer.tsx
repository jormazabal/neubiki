import { useEffect, useRef, type CSSProperties } from "react";

import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonExplorationCopy } from "../protonWorkspace/protonExplorationCopy";

type MarkdownSourceViewerProps = {
  markdown: string;
  zoomPercent: number;
  ariaLabel?: string;
  lineNumber?: number | null;
};

export function MarkdownSourceViewer({ markdown, zoomPercent, ariaLabel, lineNumber }: MarkdownSourceViewerProps) {
  const t = protonExplorationCopy[useUiLocale()];
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const selected = Number.isInteger(lineNumber) && lineNumber! >= 1 && lineNumber! <= lines.length ? lineNumber! - 1 : null;
  const line = useRef<HTMLElement>(null);
  const displayMarkdown = selected === null ? formatMarkdownSourceForDisplay(markdown) : normalized;
  useEffect(() => {
    if (selected !== null) { line.current?.scrollIntoView?.({ block: "center" }); line.current?.focus({ preventScroll: true }); }
  }, [selected, markdown]);

  return (
    <div
      className="neubiki-markdown-source-viewer"
      style={{ "--neubiki-markdown-zoom": String(zoomPercent / 100) } as CSSProperties}
      aria-label={ariaLabel ?? t.markdownSource}
    >
      <pre>
        <code>{selected === null ? displayMarkdown : <>
          {lines.slice(0, selected).join("\n")}{selected > 0 ? "\n" : ""}
          <mark ref={line} tabIndex={-1} aria-label={t.lineLabel(selected + 1)} className="bg-brand-hover text-ink-primary outline-none">{lines[selected] || " "}</mark>
          {selected < lines.length - 1 ? "\n" : ""}{lines.slice(selected + 1).join("\n")}
        </>}</code>
      </pre>
    </div>
  );
}

export function formatMarkdownSourceForDisplay(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previousLine = output[output.length - 1];
    const nextLine = lines[index + 1];

    if (line.trim() === "" && previousLine !== undefined && nextLine !== undefined) {
      const previousListIndent = getListMarkerIndent(previousLine);
      const nextListIndent = getListMarkerIndent(nextLine);
      if (previousListIndent !== null && previousListIndent === nextListIndent) continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

function getListMarkerIndent(line: string) {
  const match = line.match(/^(\s*)(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/);
  return match ? match[1].length : null;
}
