import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import {
  checkProtonResearch, removeProtonResearchReport, reviewProtonResearch, runProtonResearch,
  type ProtonResearchAttempt, type ProtonResearchQuote, type ProtonResearchReport,
} from "../../lib/api/protonResearch";
import type { ProtonToolTarget } from "../protonWorkspace/protonToolTypes";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonAssistantCopy } from "./protonAssistantCopy";
import type { SelectedAiSource } from "./ProtonAiSourcesDialog";

export function ProtonResearchDialog({ target, initialQuestion, availableSources = [], canSubmit = true, onClose }: {
  target: Pick<ProtonToolTarget, "address" | "baseRevisionId">;
  initialQuestion: string;
  onClose: () => void;
  availableSources?:SelectedAiSource[];
  canSubmit?: boolean;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const locale = useUiLocale();
  const copy = protonAssistantCopy[locale].research;
  const [question, setQuestion] = useState(initialQuestion);
  const [quote, setQuote] = useState<ProtonResearchQuote | null>(null);
  const [report, setReport] = useState<ProtonResearchReport | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sent, setSent] = useState(false);
  const [sourceSnapshot] = useState(()=>availableSources.filter(source=>source.kind==="text").map(source=>({...source})));
  const [includeSources,setIncludeSources] = useState(false);
  const [retainPublicReport, setRetainPublicReport] = useState(false);
  const [attempts, setAttempts] = useState<ProtonResearchAttempt[] | null>(null);
  const [selectedAttempt, setSelectedAttempt] = useState<ProtonResearchAttempt | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [removing, setRemoving] = useState(false);
  const active = useRef(false);
  const receiptTitle = useRef<HTMLParagraphElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const request = { ...target.address, baseRevisionId: target.baseRevisionId, question: question.trim(),
    ...(includeSources && sourceSnapshot.length ? {sources:sourceSnapshot.map(({nodeId,revisionId})=>({nodeId,revisionId}))} : {}),
    ...(retainPublicReport ? { retainPublicReport: true } : {}),
  };
  const displayReport = selectedAttempt ? selectedAttempt.publicReport : report;
  const disabled = busy || checking || removing;
  const title = canSubmit ? copy.title : copy.receiptsTitle;
  const shortDate = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const usageStatus = (recorded: boolean | null) => recorded === null ? copy.usageUnknown : recorded ? copy.usageRecorded : copy.usageUnconfirmed;

  async function checkAttempt(id?: string) {
    if (active.current) return;
    active.current = true;
    setChecking(true);
    setLookupError("");
    setNotice("");
    setConfirmRemoval(false);
    try {
      const { attempts: result } = await checkProtonResearch(target.address, id);
      if (id) {
        const next = result.find(attempt => attempt.attemptId === id) ?? null;
        setSelectedAttempt(next);
        if (next) setError("");
        else setLookupError(copy.noReceipt);
      } else {
        setAttempts(result);
      }
    } catch (cause) {
      setLookupError(runtimeErrorMessage(cause, copy.lookupError));
    } finally {
      active.current = false;
      setChecking(false);
    }
  }

  async function removeReport() {
    if (!selectedAttempt?.publicReport || !confirmRemoval || active.current) return;
    const id = selectedAttempt.attemptId;
    active.current = true;
    setRemoving(true);
    setLookupError("");
    setNotice("");
    try {
      const { attempts: result } = await removeProtonResearchReport(target.address, id);
      const updated = result.find(attempt => attempt.attemptId === id);
      if (!updated || updated.publicReportAvailable || updated.publicReport) throw new Error();
      setSelectedAttempt(updated);
      setConfirmRemoval(false);
      setNotice(copy.reportRemoved);
      if (quote?.attemptId === id) setReport(current => current && { ...current, publicReportSaved: undefined });
      requestAnimationFrame(() => receiptTitle.current?.focus());
    } catch {
      setLookupError(copy.removeReportError);
    } finally {
      active.current = false;
      setRemoving(false);
    }
  }

  async function review() {
    if (!canSubmit || !request.question || active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const reviewed=await reviewProtonResearch(request);
      if (!reviewed.attemptId) throw new Error(copy.reviewError);
      if (Boolean(reviewed.synthesis) !== Boolean(request.sources?.length)) {
        setError(copy.synthesisQuoteError);
        return;
      }
      setQuote(reviewed);
    }
    catch (cause) { setError(runtimeErrorMessage(cause, copy.reviewError)); }
    finally { active.current = false; setBusy(false); }
  }

  async function run() {
    if (!canSubmit || !quote || active.current || sent) return;
    active.current = true;
    setBusy(true);
    setSent(true);
    setError("");
    setSelectedAttempt(null);
    try { setReport(await runProtonResearch(request, { quoteId: quote.quoteId, attemptId: quote.attemptId })); }
    catch (cause) { setError(runtimeErrorMessage(cause, copy.uncertain)); }
    finally { active.current = false; setBusy(false); }
  }

  async function copyReport(synthesis=false) {
    if (!displayReport) return;
    try {
      const sources = displayReport.sources.map(source => `${source.title}\n${source.url}`).join("\n\n");
      await navigator.clipboard.writeText(synthesis ? displayReport.synthesis??"" : `${displayReport.report}\n\n${copy.sourcesHeading}\n\n${sources}`);
      setNotice(synthesis?copy.synthesisCopied:copy.copied);
    } catch { setNotice(copy.copyError); }
  }

  return createPortal(<ModalFrame label={title} onClose={() => { if (!active.current) onClose(); }}>
    <section className="proton-confirm-dialog space-y-3 p-4">
      <DialogHeading title={title} closeLabel={copy.close} busy={disabled} onClose={onClose} />
      {canSubmit && <>
      <p className="text-sm text-ink-secondary">{copy.description}</p>
      <label className="grid gap-1 text-sm font-medium">{copy.question}
        <textarea data-autofocus rows={3} maxLength={4096} className="ui-field resize-y" value={question}
          disabled={disabled || sent} onChange={event => { setQuestion(event.target.value); setQuote(null); setError(""); setSelectedAttempt(null); }} />
      </label>
      {sourceSnapshot.length>0 && <section className="space-y-2 rounded-xl border border-line p-3 text-sm" aria-label={copy.sourceNames}>
        <label className="flex min-h-12 items-center gap-2">
          <input type="checkbox" checked={includeSources} disabled={disabled||sent}
            onChange={event=>{setIncludeSources(event.target.checked);setQuote(null);setError("");}}/>
          {copy.includeSources}
        </label>
        <ul className="list-inside list-disc break-words text-xs text-ink-secondary">{sourceSnapshot.map(source=><li key={source.nodeId}>{source.name}</li>)}</ul>
        <p className="text-xs text-ink-secondary">{copy.sourcePrivacy}</p>
      </section>}
      <label className="flex min-h-12 items-center gap-2 text-sm">
        <input type="checkbox" checked={retainPublicReport} disabled={disabled || sent}
          onChange={event => { setRetainPublicReport(event.target.checked); setQuote(null); setError(""); }} />
        {copy.retainReport}
      </label>
      <p className="text-xs text-ink-secondary">{copy.receiptPrivacy}</p>
      </>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={() => void checkAttempt()}>{copy.recentAttempts}</Button>
        {sent && quote && <Button disabled={disabled} onClick={() => void checkAttempt(quote.attemptId)}>{copy.checkAttempt}</Button>}
        {selectedAttempt && report && <Button disabled={disabled} onClick={() => setSelectedAttempt(null)}>{copy.returnToResult}</Button>}
      </div>
      {(checking || removing) && <p className="text-sm" role="status">{removing ? copy.removingReport : copy.checking}</p>}
      {lookupError && <InlineNotice tone="warning" announce="status">{lookupError}</InlineNotice>}
      {attempts && (attempts.length ? <ul aria-label={copy.recentAttempts} className="max-h-36 space-y-1 overflow-auto">
        {attempts.map(attempt => <li key={attempt.attemptId}>
          <Button disabled={disabled} onClick={() => void checkAttempt(attempt.attemptId)}>
            {shortDate.format(new Date(attempt.startedAt * 1000))} · {copy.web[attempt.webState]}
          </Button>
        </li>)}
      </ul> : <p className="text-sm" role="status">{copy.noAttempts}</p>)}
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {notice && <InlineNotice tone="neutral" announce="status">{notice}</InlineNotice>}
      {busy && <p className="text-sm" role="status">{sent ? copy.investigating : copy.estimating}</p>}
      {canSubmit && quote && !report && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-panel p-3 text-sm">
        <dt>{copy.model}</dt><dd>{quote.model}</dd>
        <dt>{copy.estimate}</dt><dd>{new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 4 }).format(quote.estimatedEur)}</dd>
        <dt>{copy.countLabel}</dt><dd>{copy.upTo} {quote.sourceLimit}</dd>
        <dt>{copy.synthesisEstimate}</dt><dd>{quote.synthesis?copy.yes:copy.no}</dd>
      </dl>}
      {selectedAttempt && <div className="space-y-1 rounded-xl bg-panel p-3 text-sm" role="status">
        <p ref={receiptTitle} tabIndex={-1} className="font-semibold">{copy.web[selectedAttempt.webState]}</p>
        {copy.synthesisReceipt[selectedAttempt.synthesisState] && <p>{copy.synthesisReceipt[selectedAttempt.synthesisState]}</p>}
        {selectedAttempt.webState === "completed" && !selectedAttempt.publicReport && <p>{copy.reportUnavailable}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 pt-1 text-xs text-ink-secondary">
          <dt>{copy.webUsage}</dt><dd>{usageStatus(selectedAttempt.webUsageRecorded)}</dd>
          {(["started", "completed", "unconfirmed"] as const).some(state => state === selectedAttempt.synthesisState) && <>
            <dt>{copy.synthesisUsage}</dt><dd>{usageStatus(selectedAttempt.synthesisUsageRecorded)}</dd>
          </>}
        </dl>
      </div>}
      {selectedAttempt?.publicReport && (confirmRemoval ? <div className="space-y-2 rounded-xl border border-line p-3 text-sm" role="group" aria-label={copy.confirmRemoveReport}>
        <p>{copy.removeReportDescription}</p>
        <div className="flex flex-wrap gap-2">
          <Button ref={cancelButton} size="compact" disabled={disabled} onClick={() => {
            setConfirmRemoval(false);
            requestAnimationFrame(() => removeButton.current?.focus());
          }}>{copy.cancelRemoval}</Button>
          <Button size="compact" variant="danger" disabled={disabled} onClick={() => void removeReport()}>{copy.confirmRemoveReport}</Button>
        </div>
      </div> : <Button ref={removeButton} size="compact" variant="quiet" disabled={disabled} onClick={() => {
        setConfirmRemoval(true);
        requestAnimationFrame(() => cancelButton.current?.focus());
      }}>{copy.removeReport}</Button>)}
      {!selectedAttempt && report?.receiptSaved === false && <InlineNotice tone="warning" announce="status">{copy.receiptUnavailable}</InlineNotice>}
      {!selectedAttempt && retainPublicReport && report?.publicReportSaved === false && <InlineNotice tone="warning" announce="status">{copy.reportNotSaved}</InlineNotice>}
      {displayReport && <>
        {!selectedAttempt && !displayReport.usageRecorded && <InlineNotice tone="warning" announce="status">{copy.usage}</InlineNotice>}
        <h3 className="text-sm font-semibold">{copy.report}</h3>
        <div role="region" aria-label={copy.report} tabIndex={0}
          className="max-h-[38dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line p-3 text-sm">{displayReport.report}</div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{displayReport.limited ? copy.shownCites : copy.verifiedCites}</h3>
          <ul className="max-h-32 space-y-1 overflow-auto">
            {displayReport.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 break-all text-sm text-brand-dark underline">
              {source.title}<ExternalLink size={14} aria-hidden="true" />
            </a></li>)}
          </ul>
        </div>
        {!selectedAttempt && (quote?.synthesis || displayReport.synthesisStatus) && <section className="space-y-2 border-t border-line pt-3">
          <h3 className="text-sm font-semibold">{copy.synthesisTitle}</h3>
          {displayReport.sourceNames?.length ? <p className="break-words text-xs text-ink-secondary">{copy.sourceNames}: {displayReport.sourceNames.join(" · ")}</p> : null}
          {displayReport.synthesisStatus==="completed" && displayReport.synthesis?.trim() ? <>
            <div role="region" aria-label={copy.synthesisTitle} tabIndex={0} className="max-h-[30dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line p-3 text-sm">{displayReport.synthesis}</div>
            <Button onClick={()=>void copyReport(true)}>{copy.copySynthesis}</Button>
          </> : <InlineNotice tone="warning" announce="status">{displayReport.synthesisStatus==="skipped"?copy.synthesisSkipped:copy.synthesisUnavailable}</InlineNotice>}
        </section>}
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={disabled}>{copy.close}</Button>
        {canSubmit && !quote && !report && <Button variant="primary" onClick={() => void review()} disabled={disabled || !question.trim()}>{copy.review}</Button>}
        {canSubmit && quote && !sent && <Button variant="primary" onClick={() => void run()} disabled={disabled}>{copy.confirm}</Button>}
        {displayReport && <Button variant="primary" onClick={() => void copyReport()}>{copy.copy}</Button>}
      </div>
    </section>
  </ModalFrame>, document.body);
}
