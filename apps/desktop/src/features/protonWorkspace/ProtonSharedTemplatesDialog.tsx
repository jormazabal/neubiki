import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { listDocumentTemplates } from "../../lib/api/documentTemplates";
import { checkProtonSharedTemplates, importProtonTemplates, listProtonSharedTemplates, newSharedTemplateOperationId, publishProtonTemplates, reviewProtonTemplateImport, reviewProtonTemplatePublish } from "../../lib/api/protonSharedTemplates";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import type { DocumentTemplateCatalogEntry, DocumentTemplateInventory } from "../../types/documentTemplates";
import type { ProtonNode, ProtonWorkspace } from "../../types/protonWorkspace";
import type { SharedTemplateImportInput, SharedTemplateImportOutcome, SharedTemplateImportRequest, SharedTemplateImportReview, SharedTemplateList, SharedTemplatePublishRequest, SharedTemplatePublishReview, SharedTemplateReceipt } from "../../types/protonSharedTemplates";
import { protonSharedTemplatesCopy } from "./protonSharedTemplatesCopy";
const Preview = lazy(() => import("../editor/ReadonlyMarkdownViewer").then(module => ({ default: module.ReadonlyMarkdownViewer })));
type Props = { workspace: ProtonWorkspace; connected: boolean; onPendingChange?: (pending: boolean) => void; onClose: () => void; onImported?: (outcomes: SharedTemplateImportOutcome[]) => void; fallbackFocus?: () => HTMLElement | null };
export function ProtonSharedTemplatesDialog(props: Props) { return <SharedTemplatesContent key={JSON.stringify([props.workspace.accountId, props.workspace.root.nodeId])} {...props} />; }
function SharedTemplatesContent({ workspace, connected, onPendingChange, onClose, onImported, fallbackFocus }: Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const locale = useUiLocale(); const t = protonSharedTemplatesCopy[locale];
  const scope = { accountId: workspace.accountId, rootId: workspace.root.nodeId };
  const [mode, setMode] = useState<"publish" | "import">("import");
  const [local, setLocal] = useState<DocumentTemplateInventory>(); const [listing, setListing] = useState<SharedTemplateList>();
  const [remoteRead, setRemoteRead] = useState(false); const [remote, setRemote] = useState<ProtonNode[]>([]); const [remotePartial, setRemotePartial] = useState(false);
  const [selected, setSelected] = useState<string[]>([]); const [name, setName] = useState(() => `Plantillas-${new Date().toISOString().replace(/[:.]/g, "-")}.neubiki-templates.json`);
  const [publishReview, setPublishReview] = useState<SharedTemplatePublishReview>(); const [sourceReview, setSourceReview] = useState<SharedTemplateImportReview>();
  const [importReview, setImportReview] = useState<SharedTemplateImportReview>(); const [choices, setChoices] = useState<Record<number, string>>({});
  const [previewIndex, setPreviewIndex] = useState(0); const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [result, setResult] = useState<SharedTemplateReceipt>(); const [needsCheck, setNeedsCheck] = useState(false);
  const mounted = useRef(false); const pending = useRef(false); const unresolved = useRef(false); const guard = useRef(onPendingChange); guard.current = onPendingChange;
  const attempt = useRef<{ purpose: "publish" | "import"; operationId: string }>(); const notified = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; let active = true;
    void listDocumentTemplates().then(value => { if (active) setLocal(value); }, cause => { if (active) setError(runtimeErrorMessage(cause, t.failed)); });
    void listProtonSharedTemplates(scope).then(value => { if (active) setListing(value); }, cause => { if (active) setError(runtimeErrorMessage(cause, t.failed)); });
    return () => { active = false; mounted.current = false; if (pending.current || unresolved.current) guard.current?.(false); };
  }, []);
  function close() { if (!pending.current && !unresolved.current) onClose(); }
  function start() { if (pending.current) return false; pending.current = true; guard.current?.(true); setBusy(true); setError(""); return true; }
  function finish() { pending.current = false; guard.current?.(unresolved.current); if (mounted.current) setBusy(false); }
  function invalidate() { setPublishReview(undefined); setImportReview(undefined); setAck(false); }
  function selection() { return Object.entries(choices).map(([index, name]) => ({ index: Number(index), name: name.trim() })).sort((a, b) => a.index - b.index); }
  function importInput(): SharedTemplateImportInput | undefined { return sourceReview?.source.revisionId ? { ...scope, nodeId: sourceReview.source.nodeId, revisionId: sourceReview.source.revisionId, digest: sourceReview.digest, entries: selection() } : undefined; }
  function show(value: SharedTemplateReceipt) {
    setResult(value); setNeedsCheck(value.active); unresolved.current = value.active; setAck(false);
    if (value.purpose === "import" && value.outcomes?.some(row => ["imported", "existing", "observed"].includes(row.status)) && !notified.current.has(value.operationId)) {
      notified.current.add(value.operationId); onImported?.(value.outcomes);
    }
  }
  async function load(remote: boolean, offset = 0) {
    if (remote && !connected || !start()) return;
    try { const value = await listProtonSharedTemplates({ ...scope, offset, readRemote: remote }); if (mounted.current) { setListing(value); if (remote) { setRemote(value.items); setRemotePartial(value.partial); setRemoteRead(true); } } }
    catch (cause) { if (mounted.current) setError(runtimeErrorMessage(cause, t.failed)); } finally { finish(); }
  }
  async function reviewPublish() {
    if (!connected || !workspace.canWrite || !local?.complete || !selected.length || !start()) return;
    invalidate();
    try { const value = await reviewProtonTemplatePublish({ ...scope, name: name.trim(), entries: local.templates.filter(row => selected.includes(row.id)).map(row => ({ id: row.id, revision: row.revision })) }); if (mounted.current) { setPublishReview(value); setPreviewIndex(0); } }
    catch (cause) { if (mounted.current) setError(runtimeErrorMessage(cause, t.failed)); } finally { finish(); }
  }
  async function openSnapshot(node: ProtonNode) {
    if (!connected || !node.revisionId || !start()) return;
    invalidate(); setSourceReview(undefined); setChoices({});
    try { const value = await reviewProtonTemplateImport({ ...scope, nodeId: node.nodeId, revisionId: node.revisionId, entries: [] }); if (mounted.current) { setSourceReview(value); setPreviewIndex(0); } }
    catch (cause) { if (mounted.current) setError(runtimeErrorMessage(cause, t.failed)); } finally { finish(); }
  }
  async function reviewImport() {
    const input = importInput(); if (!input || !input.entries.length || !connected || !start()) return;
    setImportReview(undefined); setAck(false);
    try { const value = await reviewProtonTemplateImport(input); if (mounted.current) setImportReview(value); }
    catch (cause) { if (mounted.current) setError(runtimeErrorMessage(cause, t.failed)); } finally { finish(); }
  }
  async function apply() {
    if (!ack || !connected || result || needsCheck) return;
    const purpose = mode; const operationId = newSharedTemplateOperationId(purpose);
    let input: SharedTemplatePublishRequest | SharedTemplateImportRequest;
    if (purpose === "publish") {
      if (!workspace.canWrite || !publishReview || !local?.complete) return;
      input = { ...scope, operationId, name: publishReview.name, entries: local.templates.filter(row => selected.includes(row.id)).map(row => ({ id: row.id, revision: row.revision })), digest: publishReview.digest, reviewDigest: publishReview.reviewDigest, acknowledge: true };
    } else {
      const source = importInput(); if (!source || !importReview || !importReview.outcomes.length || importReview.outcomes.some(row => !["new", "existing"].includes(row.status))) return;
      input = { ...source, operationId, digest: importReview.digest, reviewDigest: importReview.reviewDigest, acknowledge: true, reviewedResources: true };
    }
    if (!start()) return; attempt.current = { purpose, operationId };
    try { const value = purpose === "publish" ? await publishProtonTemplates(input as SharedTemplatePublishRequest) : await importProtonTemplates(input as SharedTemplateImportRequest); if (mounted.current) show(value); }
    catch (cause) { if (mounted.current) { unresolved.current = true; setNeedsCheck(true); setError(runtimeErrorMessage(cause, t.uncertain)); } } finally { finish(); }
  }
  async function check(value = attempt.current) {
    if (!value || value.purpose === "publish" && !connected || !start()) return;
    attempt.current = { purpose: value.purpose, operationId: value.operationId };
    try { const next = await checkProtonSharedTemplates({ ...scope, ...attempt.current }); if (mounted.current) show(next); }
    catch (cause) { if (mounted.current) { unresolved.current = true; setNeedsCheck(true); setError(runtimeErrorMessage(cause, t.uncertain)); } } finally { finish(); }
  }
  function status(value: string) { return ({ pending: t.pending, confirmed: t.confirmed, observed: t.observed, conflict: t.conflict, complete: t.complete, partial: t.partialResult, "not-recorded": t.notRecorded, new: t.new, existing: t.existing, blocked: t.blocked, imported: t.imported, unconfirmed: t.unconfirmed } as Record<string, string>)[value] || value; }
  function outcomeList(rows: SharedTemplateImportOutcome[]) { return <ul className="space-y-2 text-sm">{rows.map(row => <li key={row.index} className="rounded-lg border border-line p-2"><strong className="break-words">{row.name}</strong><p>{status(row.status)}</p>{row.message && <p className="text-xs text-muted">{row.message}</p>}</li>)}</ul>; }
  const disabled = busy || needsCheck || Boolean(result); const catalog = mode === "publish" ? publishReview?.catalog : sourceReview?.catalog;
  const preview = catalog?.find(row => row.index === previewIndex); const reviewed = mode === "publish" ? publishReview : importReview;
  const canImport = Boolean(importReview?.outcomes.length && importReview.outcomes.every(row => ["new", "existing"].includes(row.status)));
  const personal = local?.templates.filter(row => !row.builtIn) || [];
  function previewContent(entry: DocumentTemplateCatalogEntry) { return <>
    <div className="max-h-[28dvh] overflow-auto rounded-xl border border-line p-3" onClickCapture={event => { if ((event.target as Element).closest("a")) { event.preventDefault(); event.stopPropagation(); } }}>
      <Suspense fallback={<p role="status">{t.loading}</p>}><Preview markdown={entry.markdown} ariaLabel={t.preview} emptyMessage="" resolveImageSource={source => /^data:image\/(png|jpeg|webp);base64,/i.test(source) ? source : ""} /></Suspense>
    </div><p className="text-sm">{entry.description}</p><div className="space-y-1 text-sm"><strong>{t.resources}</strong>{entry.resources?.length ? <ul>{entry.resources.map(resource => <li className="break-words" key={resource.path}>{resource.name} · {(resource.bytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KiB</li>)}</ul> : <p className="text-muted">{t.noResources}</p>}</div>
  </>; }
  return createPortal(<ModalFrame label={t.title} onClose={close} fallbackFocus={fallbackFocus} className="proton-rail-dialog"><section className="proton-confirm-dialog space-y-4 p-5" style={{ width: "min(100%, 52rem)" }}>
    <DialogHeading title={t.title} closeLabel={t.close} busy={busy || needsCheck} onClose={close} />
    <p className="text-sm">{t.help}</p><p className="text-xs text-muted">{t.scope}: <strong>{workspace.root.name}</strong> · {t.byteLimit}</p><p className="text-xs text-muted">{t.immutable}</p>
    {!connected && <InlineNotice tone="warning">{t.offline}</InlineNotice>}{!workspace.canWrite && <InlineNotice tone="neutral">{t.readOnly}</InlineNotice>}
    {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}{busy && <p role="status" className="text-sm">{t.loading}</p>}{needsCheck && <InlineNotice tone="warning">{t.uncertain}</InlineNotice>}
    {!result && <><div className="flex flex-wrap gap-2"><Button data-autofocus aria-pressed={mode === "import"} disabled={disabled} onClick={() => { setMode("import"); invalidate(); }}>{t.importTab}</Button><Button aria-pressed={mode === "publish"} disabled={disabled} onClick={() => { setMode("publish"); invalidate(); }}>{t.publishTab}</Button></div>
    <fieldset disabled={disabled} className="space-y-3">
      {mode === "publish" ? <><label className="grid gap-1 text-sm">{t.name}<input className="ui-field" value={name} maxLength={240} onChange={event => { setName(event.target.value); invalidate(); }} /></label><h3 className="text-sm font-semibold">{t.local}</h3>
      {local && !local.complete && <InlineNotice tone="warning">{t.incomplete}{local.warnings.map((row, i) => <p key={i}>{row.message}</p>)}</InlineNotice>}
      <p className="text-xs text-muted">{t.selection}</p>{personal.length ? <ul className="max-h-48 space-y-2 overflow-auto">{personal.map(row => <li key={row.id}><label className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(row.id)} disabled={!selected.includes(row.id) && selected.length >= 32} onChange={event => { setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id)); invalidate(); }} /><span className="break-words">{row.name}</span></label></li>)}</ul> : <p className="text-sm text-muted">{t.emptyLocal}</p>}
      <Button disabled={!connected || !workspace.canWrite || !local?.complete || !selected.length || !name.trim()} onClick={() => void reviewPublish()}>{t.reviewPublish}</Button></> : <>
      <Button disabled={!connected} onClick={() => void load(true)}>{t.read}</Button>{remotePartial && <InlineNotice tone="warning">{t.partial}</InlineNotice>}
      {remoteRead && <><h3 className="text-sm font-semibold">{t.snapshots}</h3>{remote.length ? <ul className="max-h-40 space-y-2 overflow-auto">{remote.map(row => <li key={row.nodeId} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 break-words">{row.name}</span><Button aria-label={`${t.open}: ${row.name}`} disabled={!connected} onClick={() => void openSnapshot(row)}>{t.open}</Button></li>)}</ul> : <p className="text-sm text-muted">{t.emptyRemote}</p>}</>}
      {sourceReview && <><p className="break-words text-sm font-semibold">{sourceReview.source.name}</p><h3 className="text-sm font-semibold">{t.choose}</h3><ul className="max-h-56 space-y-3 overflow-auto">{sourceReview.catalog.map(entry => <li key={entry.index} className="space-y-1 rounded-lg border border-line p-2"><label className="flex gap-2 text-sm"><input type="checkbox" checked={choices[entry.index] !== undefined} onChange={event => { setChoices(current => { const next = { ...current }; if (event.target.checked) next[entry.index] = entry.name; else delete next[entry.index]; return next; }); invalidate(); }} /><span className="break-words">{entry.name}</span></label>{choices[entry.index] !== undefined && <label className="grid gap-1 text-xs">{t.localName}: {entry.name}<input className="ui-field" value={choices[entry.index]} maxLength={240} onChange={event => { setChoices(current => ({ ...current, [entry.index]: event.target.value })); invalidate(); }} /></label>}<Button aria-label={`${t.preview}: ${entry.name}`} onClick={() => setPreviewIndex(entry.index)}>{t.preview}</Button></li>)}</ul><Button disabled={!connected || !selection().length || selection().some(row => !row.name)} onClick={() => void reviewImport()}>{t.reviewImport}</Button></>}
      </>}
      {catalog?.length ? <div className="space-y-3">{mode === "publish" && <label className="grid gap-1 text-sm">{t.preview}<select className="ui-field" value={previewIndex} onChange={event => setPreviewIndex(Number(event.target.value))}>{catalog.map(row => <option key={row.index} value={row.index}>{row.name}</option>)}</select></label>}{preview && previewContent(preview)}</div> : null}
      {importReview && outcomeList(importReview.outcomes)}
      {reviewed && <><p className="text-xs text-muted">{(reviewed.byteLength / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KiB · SHA-256 <span className="break-all">{reviewed.digest}</span></p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />{mode === "publish" ? t.ackPublish : t.ackImport}</label><Button variant="primary" disabled={!connected || !ack || mode === "publish" && !workspace.canWrite || mode === "import" && !canImport} onClick={() => void apply()}>{mode === "publish" ? t.publish : t.import}</Button></>}
    </fieldset></>}
    {result && <section className="space-y-2"><h3 className="text-sm font-semibold">{t.result}</h3><InlineNotice tone={result.state === "complete" || result.state === "confirmed" || result.state === "observed" ? "success" : "warning"} announce="status">{status(result.state)}{result.active && <p>{t.active}</p>}</InlineNotice><p className="break-words text-sm">{result.name}</p>{result.detail && <p className="text-sm">{result.detail}</p>}{result.outcomes && outcomeList(result.outcomes)}<p className="break-all text-xs text-muted">{result.operationId}</p></section>}
    {(needsCheck || result && ["pending", "partial", "not-recorded"].includes(result.state)) && <Button variant="primary" disabled={busy || attempt.current?.purpose === "publish" && !connected} onClick={() => void check()}>{t.check}</Button>}
    {!needsCheck && result && ["confirmed", "observed", "complete", "conflict"].includes(result.state) && <Button disabled={busy} onClick={() => { setResult(undefined); attempt.current = undefined; invalidate(); }}>{t.newAttempt}</Button>}
    {!needsCheck && <details className="space-y-2 rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm font-semibold">{t.attempts}</summary><Button disabled={busy} onClick={() => void load(false, 0)}>{t.refresh}</Button><ul className="max-h-48 space-y-2 overflow-auto">{listing?.attempts.map(row => <li key={row.operationId} className="space-y-1 rounded-lg border border-line p-2 text-sm"><p className="break-words">{row.name} · {status(row.state)}</p><p className="break-all text-xs text-muted">{row.operationId}</p><Button disabled={busy || row.purpose === "publish" && !connected} onClick={() => void check(row)}>{t.check}</Button></li>)}</ul>{listing && <div className="flex gap-2">{listing.offset > 0 && <Button disabled={busy} onClick={() => void load(false, Math.max(0, listing.offset - 20))}>{t.previous}</Button>}{listing.offset + listing.attempts.length < listing.totalAttempts && <Button disabled={busy} onClick={() => void load(false, listing.offset + 20)}>{t.more}</Button>}</div>}</details>}
    <div className="flex justify-end"><Button disabled={busy || needsCheck} onClick={close}>{t.close}</Button></div>
  </section></ModalFrame>, document.body);
}
