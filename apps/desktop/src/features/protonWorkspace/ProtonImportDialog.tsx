import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import type { ProtonImportResult } from "../../lib/api/protonTreeImport";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { getProtonErrorMessage } from "../../lib/i18n/protonErrors";
import type { ProtonImportEntry, ProtonNode } from "../../types/protonWorkspace";
import { ProtonImportSourceError, type LoadProtonImport } from "./protonImportSources";
import { protonImportCopy } from "./protonImportCopy";

type ImportIssue = { kind: "selection"; source?: ProtonImportSourceError } | { kind: "start" };

export function ProtonImportDialog({ destination, load, disabled, onApply, onClose, fallbackFocus }: {
  destination: ProtonNode[];
  load: LoadProtonImport;
  disabled: boolean;
  onApply: (entries: ProtonImportEntry[], onProgress: (confirmed: number) => void) => Promise<ProtonImportResult | undefined>;
  onClose: () => void;
  fallbackFocus: () => HTMLElement | null;
}) {
  const language = useUiLocale();
  const copy = protonImportCopy[language];
  const [entries, setEntries] = useState<ProtonImportEntry[] | null>(null);
  const [issue, setIssue] = useState<ImportIssue>();
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ProtonImportResult>();
  const [importing, setImporting] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    void load().then(value => { if (active) setEntries(value); }, cause => {
      if (active) setIssue({ kind: "selection", source: cause instanceof ProtonImportSourceError ? cause : undefined });
    });
    return () => { active = false; };
  }, [load]);

  function close() { if (!pending.current) onClose(); }

  async function apply() {
    if (!entries || pending.current || disabled || result) return;
    pending.current = true;
    setIssue(undefined);
    setImporting(true);
    try {
      const outcome = await onApply(entries, setProgress);
      if (outcome) setResult(outcome);
      else setIssue({ kind: "start" });
    } finally {
      pending.current = false;
      setImporting(false);
    }
  }

  const paths = entries ? importPaths(entries) : [];
  const error = issue?.kind === "selection"
    ? issue.source ? copy.source[issue.source.reason](issue.source.entryName) : copy.selectionFailed
    : issue?.kind === "start" ? copy.startFailed : "";
  return createPortal(<ModalFrame label={copy.title} onClose={close} fallbackFocus={fallbackFocus} className="proton-rail-dialog">
    <section className="proton-confirm-dialog space-y-3 p-5">
      <DialogHeading title={copy.title} onClose={close} closeLabel={copy.close} busy={importing} />
      <p className="break-words text-sm">{copy.destination} <strong>{destination.map(node => node.name).join(" / ")}</strong></p>
      {!entries && !error && <p role="status">{copy.loading}</p>}
      {!!paths.length && <details>
        <summary className="text-sm">{copy.reviewCount(paths.length)}</summary>
        <ul className="max-h-40 overflow-y-auto text-sm text-ink-secondary">
          {paths.map(path => <li key={path} className="break-words py-1">{path}</li>)}
        </ul>
      </details>}
      {importing && <>
        <ProgressBar label={copy.progressLabel} value={100 * progress / paths.length} />
        <p role="status" className="text-sm">{copy.progress(progress, paths.length)}</p>
      </>}
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {result?.failure && <InlineNotice tone="warning" announce="alert">
        {copy.progress(result.confirmed, paths.length)}. {copy.stopped(result.failure.path)}{" "}
        {result.failure.reason ? copy[result.failure.reason] : getProtonErrorMessage(result.failure.cause, copy.unconfirmed, language)} {copy.checkDestination}
      </InlineNotice>}
      {result && !result.failure && <InlineNotice tone="success" announce="status">
        {copy.success(result.confirmed)}
      </InlineNotice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button data-autofocus disabled={importing} onClick={close}>{result ? copy.close : copy.cancel}</Button>
        {!result && <Button variant="primary" disabled={!paths.length || disabled || importing} onClick={() => void apply()}>{copy.apply}</Button>}
      </div>
    </section>
  </ModalFrame>, document.body);
}

function importPaths(entries: ProtonImportEntry[], prefix = ""): string[] {
  return entries.flatMap(entry => {
    const path = `${prefix}${entry.name}`;
    return entry.type === "folder" ? [`${path}/`, ...importPaths(entry.children, `${path}/`)] : [path];
  });
}
