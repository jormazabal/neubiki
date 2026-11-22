import { useEffect, useRef, useState } from "react";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { getProtonErrorMessage } from "../../lib/i18n/protonErrors";
import { applyProtonReplacements, checkProtonReplacements, reviewProtonReplacements, type ProtonReplacementReview } from "../../lib/api/protonReplacements";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonExplorationCopy } from "./protonExplorationCopy";
import type { ProtonWorkspace } from "../../types/protonWorkspace";

type Props = {
  workspace: ProtonWorkspace;
  onBeforeReview: () => Promise<void>;
  onPrepared: (nodeIds: string[]) => Promise<void> | void;
  onClose: () => void;
  onPending?: (pending: boolean) => void;
  reviewTitle?: string;
} & ({ nodeIds: string[]; query: string; replacement: string; loadReview?: never }
  | { loadReview: (signal: AbortSignal) => Promise<ProtonReplacementReview>; nodeIds?: never; query?: never; replacement?: never });

export function ProtonReplacementDialog({ workspace, nodeIds, query, replacement, loadReview, reviewTitle, onBeforeReview, onPrepared, onClose, onPending }: Props) {
  const language = useUiLocale();
  const t = protonExplorationCopy[language];
  const title = reviewTitle ?? t.reviewTitle;
  const [review, setReview] = useState<ProtonReplacementReview>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [uncertain, setUncertain] = useState(false);
  const [choice, setChoice] = useState(0);
  const [version, setVersion] = useState<"before" | "after">("after");
  const [attempt, setAttempt] = useState(0);
  const applying = useRef(false);
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  useEffect(() => {
    const request = new AbortController();
    setBusy(true);
    setError("");
    void onBeforeReview().then(() => {
      if (request.signal.aborted) return undefined;
      return loadReview ? loadReview(request.signal)
        : reviewProtonReplacements(workspace, nodeIds!, query!, replacement!, request.signal);
    }).then(result => {
      if (!request.signal.aborted && result) setReview(result);
    }, cause => {
      if (!request.signal.aborted) setError(getProtonErrorMessage(cause, t.reviewFailed, language));
    }).finally(() => { if (!request.signal.aborted) setBusy(false); });
    return () => request.abort();
    // A review is a frozen request. Retry explicitly prepares a new review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  async function apply(check = false) {
    if (!review || applying.current) return;
    applying.current = true;
    onPending?.(true);
    setBusy(true);
    setError("");
    try {
      const result = await (check ? checkProtonReplacements(workspace, review.operationId) : applyProtonReplacements(workspace, review.operationId));
      if (!live.current) return;
      setReview(result);
      setUncertain(false);
      if (result.applied) await onPrepared(result.items.filter(item => item.state === "prepared").map(item => item.nodeId));
    } catch (cause) {
      if (!live.current) return;
      setUncertain(true);
      setError(getProtonErrorMessage(cause, t.resultUnknown, language));
    } finally {
      applying.current = false;
      onPending?.(false);
      if (live.current) setBusy(false);
    }
  }

  function close() {
    if (!applying.current) onClose();
  }

  const current = review?.items[choice];
  const pending = review?.applied && review.items.some(item => item.state === "reviewed" || item.state === "unknown");
  return <ModalFrame label={title} onClose={close} className="!z-[90]">
    <section className="proton-confirm-dialog !w-full !max-w-3xl space-y-3 p-4">
      <DialogHeading title={title} closeLabel={t.close} onClose={close} busy={applying.current} />
      <p className="text-sm text-ink-secondary">{t.reviewHelp}</p>
      {error && <InlineNotice tone="warning" announce="alert">{error}</InlineNotice>}
      {busy && <p role="status">{review ? t.preparing : t.reviewing}</p>}
      {review && <>
        <label className="grid gap-1 text-sm">{t.document}
          <select className="ui-field" value={choice} onChange={event => setChoice(Number(event.target.value))}>
            {review.items.map((item, index) => <option key={item.nodeId} value={index}>
              {item.name}{!loadReview && ` · ${t.occurrences(item.occurrences)}`}
            </option>)}
          </select>
        </label>
        {current && <>
          <div className="lg:hidden">
            <SegmentedControl label={t.compareContent} value={version} onChange={setVersion}
              options={[{ value: "before", label: t.original }, { value: "after", label: t.proposal }]} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={version === "before" ? "min-w-0" : "hidden min-w-0 lg:block"}>
              <p className="mb-1 hidden text-sm font-medium lg:block">{t.original}</p>
              <pre tabIndex={0} aria-label={t.originalMarkdown}
                className="max-h-[40dvh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-panel p-3 text-sm">{current.before}</pre>
            </div>
            <div className={version === "after" ? "min-w-0" : "hidden min-w-0 lg:block"}>
              <p className="mb-1 hidden text-sm font-medium lg:block">{t.proposal}</p>
              <pre tabIndex={0} aria-label={t.proposedMarkdown}
                className="max-h-[40dvh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-panel p-3 text-sm">{current.after}</pre>
            </div>
          </div>
        </>}
        {review.applied && <ul className="space-y-1 text-sm" aria-label={t.documentResults}>
          {review.items.map(item => <li key={item.nodeId}>{item.name} · {item.state === "prepared" ? t.draftPrepared
            : item.state === "not-applied" ? t.notApplied : t.resultPending}</li>)}
        </ul>}
        {pending && <InlineNotice tone="warning">{t.interrupted}</InlineNotice>}
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={applying.current} onClick={close}>{t.close}</Button>
        {!review && error && <Button onClick={() => setAttempt(value => value + 1)} disabled={busy}>{t.retryReview}</Button>}
        {review && !review.applied && !uncertain && <Button variant="primary" disabled={busy} onClick={() => void apply()}>{t.prepareDrafts(review.items.length)}</Button>}
        {review && uncertain && <Button variant="primary" disabled={busy} onClick={() => void apply(true)}>{t.checkResult}</Button>}
      </div>
    </section>
  </ModalFrame>;
}
