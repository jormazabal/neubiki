import { LocalizedNoticeError, useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, Folder, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { getExportProfiles } from "../../lib/api/portabilityWorkspace";
import { readSharedExportProfiles, type SharedExportProfiles } from "../../lib/api/protonSharedProfiles";
import { exportCopy } from "../../lib/i18n/exportCopy";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonSharedProfilesCopy } from "./protonSharedProfilesCopy";
import { listDriveFolder } from "../../lib/api/protonWorkspace";
import { checkProtonExportBatch, deliverProtonExportBatch, discardProtonExportBatch, getProtonExportBatches } from "../../lib/api/protonExportBatch";
import type { ExportProfiles } from "../../types/portabilityWorkspace";
import type { ProtonBatchResult, ProtonExportBatch } from "../../types/protonExportBatch";
import type { ProtonNode, ProtonWorkspace } from "../../types/protonWorkspace";
import { isProtonHandwritten, isProtonMarkdown } from "./protonFileKinds";
import { prepareProtonSavedBatch } from "./prepareProtonSavedBatch";
type Props = {
  workspace: ProtonWorkspace; connected: boolean; beforePrepare: () => Promise<void>;
  onPendingChange?: (pending: boolean) => void; onClose: () => void; fallbackFocus?: () => HTMLElement | null;
};
export function ProtonBatchExportDialog(props: Props) {
  return <BatchContent key={JSON.stringify([props.workspace.accountId, props.workspace.root.nodeId])} {...props} />;
}
function BatchContent({ workspace, connected, beforePrepare, onPendingChange, onClose, fallbackFocus }: Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const language = useUiLocale();
  const t = protonSharedProfilesCopy[language];
  const c = exportCopy[language];
  const size = (bytes: number) => `${(bytes / 1024 ** 2).toLocaleString(language, { maximumFractionDigits: 1 })} MiB`;
  const { accountId, root } = workspace;
  const scope = { accountId, rootId: root.nodeId };
  const [path, setPath] = useState([root]);
  const [nodes, setNodes] = useState<ProtonNode[]>([]);
  const [selected, setSelected] = useState<ProtonNode[]>([]);
  const [format, setFormat] = useState<"pdf" | "docx" | "md">("pdf");
  const [profiles, setProfiles] = useState<ExportProfiles>();
  const [shared, setShared] = useState<SharedExportProfiles>();
  const [sharedError, setSharedError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [profileId, setProfileId] = useState("");
  const [jobs, setJobs] = useState<ProtonExportBatch[]>([]);
  const [job, setJob] = useState<ProtonExportBatch>();
  const [outcomes, setOutcomes] = useState<ProtonBatchResult[]>([]);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState("");
  const [folderError, setFolderError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [progress, setProgress] = useState("");
  const [requiresCheck, setRequiresCheck] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const notify = useRef(onPendingChange); notify.current = onPendingChange;
  const parentId = path[path.length - 1].nodeId;
  const busy = Boolean(progress);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (pending.current) notify.current?.(false); }; }, []);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true); setFolderError(""); setNodes([]);
    if (!connected) { setLoading(false); return; }
    void listDriveFolder(accountId, parentId, root.nodeId, request.signal).then(value => {
      if (!request.signal.aborted) { setNodes(value.items); setLoading(false); }
    }, cause => { if (!request.signal.aborted) { setFolderError(runtimeErrorMessage(cause, c.folderFailed)); setLoading(false); } });
    return () => request.abort();
  }, [accountId, root.nodeId, parentId, connected, reload]);
  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    void Promise.all([getExportProfiles(), getProtonExportBatches({ accountId, rootId: root.nodeId })]).then(([catalog, batches]) => {
      if (active) { setProfiles(catalog); setJobs(batches); setCatalogLoading(false); setRequiresCheck(false); }
    }, cause => { if (active) { setCatalogLoading(false); setError(runtimeErrorMessage(cause, c.catalogFailed)); } });
    return () => { active = false; };
  }, [accountId, root.nodeId, reload]);
  useEffect(() => {
    if (!connected) return;
    const request = new AbortController();
    setShared(undefined); setSharedError("");
    void readSharedExportProfiles({ accountId, rootId: root.nodeId }, request.signal).then(value => {
      if (!request.signal.aborted) setShared(value);
    }, cause => { if (!request.signal.aborted) setSharedError(runtimeErrorMessage(cause, t.sharedLoadFailed)); });
    return () => request.abort();
  }, [accountId, root.nodeId, connected, reload]);
  function start(text: string) {
    if (pending.current) return false;
    pending.current = true; notify.current?.(true); setProgress(text); setError(""); return true;
  }
  function finish() { pending.current = false; notify.current?.(false); if (mounted.current) setProgress(""); }
  function show(value: ProtonExportBatch) { setJob(value); setOutcomes(value.sourceMetadata.results); setAcceptPartial(false); setConfirmDiscard(false); setRequiresCheck(false); }
  function record(value: ProtonExportBatch) {
    show(value); setJobs(items => value.phase === "discarded" ? items.filter(item => item.id !== value.id) : [value, ...items.filter(item => item.id !== value.id)]);
  }
  async function prepare() {
    if (!profiles || !selected.length || !start(c.protecting)) return;
    try {
      await beforePrepare();
      const project = format !== "md" && profileId.startsWith("project:");
      if (project && (!shared || shared.outcome !== "confirmed")) throw new LocalizedNoticeError(t.staleSelection);
      const catalog: ExportProfiles = project && shared ? { schemaVersion: 1, revision: shared.revisionId, profiles: shared.profiles, checkedAt: shared.checkedAt } : profiles;
      const value = await prepareProtonSavedBatch(scope, selected, format, catalog, project ? profileId.slice("project:".length) : profileId,
        text => { if (mounted.current) setProgress(text); }, project ? "project" : undefined, language);
      if (!mounted.current) return;
      setOutcomes(value.results); setAcceptPartial(false); setError("");
      if (value.batch) record(value.batch);
    } catch (cause) {
      if (mounted.current) { setError(runtimeErrorMessage(cause, c.prepareFailed)); setRequiresCheck(true); }
    } finally { finish(); }
  }
  async function action(kind: "deliver" | "check" | "discard") {
    if (!job || !start(kind === "deliver" ? c.picking : c.checking)) return;
    try {
      const value = kind === "deliver" ? await deliverProtonExportBatch(scope, job) : kind === "discard" ? await discardProtonExportBatch(scope, job) : await checkProtonExportBatch(scope, job.id);
      if (mounted.current) record(value);
    } catch (cause) {
      if (mounted.current) { setError(runtimeErrorMessage(cause, c.resultFailed)); setRequiresCheck(true); }
    } finally { finish(); }
  }
  function close() { if (!pending.current) onClose(); }
  const omitted = outcomes.filter(item => item.status === "omitted");
  const visibleNodes = nodes.filter(node => node.type === "folder" || isProtonMarkdown(node.name) || isProtonHandwritten(node.name));
  const canDeliver = job && ["prepared", "cancelled"].includes(job.phase) && !requiresCheck && (!omitted.length || acceptPartial);
  return createPortal(<ModalFrame label={c.batchTitle} onClose={close} fallbackFocus={fallbackFocus} className="proton-rail-dialog">
    <section className="proton-confirm-dialog space-y-4 p-5" style={{ width: "min(100%, 52rem)" }}>
      <DialogHeading title={c.batchTitle} closeLabel={c.close} busy={busy} onClose={close} />
      <p className="text-sm">{c.selectionBefore} <strong>{root.name}</strong>. {c.selectionAfter}</p>
      {!connected && <InlineNotice tone="warning">{c.offline}</InlineNotice>}
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {sharedError && <InlineNotice tone="warning">{sharedError}</InlineNotice>}
      {busy && <div role="status" className="space-y-2 text-sm"><p>{progress}</p><ProgressBar label={c.preparing} /></div>}
      {!job && <fieldset disabled={busy} className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <label className="grid flex-1 gap-1 text-sm">{c.format}<select className="ui-field" value={format} onChange={event => setFormat(event.target.value as typeof format)}>
            <option value="pdf">PDF</option><option value="docx">Word</option><option value="md">{c.markdownImages}</option>
          </select></label>
          <label className="grid flex-1 gap-1 text-sm">{c.profile}<select className="ui-field" disabled={format === "md" || !profiles} value={profileId} onChange={event => setProfileId(event.target.value)}>
            <option value="">{c.currentTemplate}</option>
            {!!profiles?.profiles.length && <optgroup label={t.deviceGroup}>{profiles.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</optgroup>}
            {!!shared?.profiles.length && <optgroup label={t.projectGroup} disabled={shared.outcome !== "confirmed"}>{shared.profiles.map(profile => <option key={profile.id} value={`project:${profile.id}`}>{profile.name}</option>)}</optgroup>}
          </select></label>
        </div>
        <p className="text-xs text-ink-secondary">{t.batchNote}</p>
        {format !== "pdf" && <p className="text-sm text-muted">{c.handwrittenPdf}</p>}
        <div className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center gap-2"><Button size="icon" variant="quiet" aria-label={c.up} disabled={path.length < 2 || !connected} onClick={() => setPath(items => items.slice(0, -1))}><ArrowLeft size={16} /></Button>
            <p className="min-w-0 flex-1 break-words text-sm">{path.map(item => item.name).join(" / ")}</p>
            <Button size="icon" variant="quiet" aria-label={c.refresh} disabled={!connected} onClick={() => { setReload(value => value + 1); }}><RefreshCw size={16} /></Button></div>
          {loading && <p role="status" className="text-sm">{c.reading}</p>}
          {folderError && <InlineNotice tone="error">{folderError}</InlineNotice>}
          <ul className="max-h-[26dvh] space-y-1 overflow-auto" aria-label={c.folderFiles}>
            {visibleNodes.map(node => <li key={node.nodeId}>
              {node.type === "folder" ? <Button variant="quiet" size="compact" className="w-full justify-start" disabled={!connected} onClick={() => setPath(items => [...items, node])}><Folder size={16} />{node.name}</Button>
                : <label className="flex items-start gap-2 rounded-lg px-2 py-1 text-sm"><input type="checkbox" className="mt-1" checked={selected.some(item => item.nodeId === node.nodeId)}
                  disabled={!connected || !node.revisionId || format !== "pdf" && isProtonHandwritten(node.name) || selected.length >= 32 && !selected.some(item => item.nodeId === node.nodeId)}
                  onChange={event => setSelected(items => event.target.checked ? [...items, node] : items.filter(item => item.nodeId !== node.nodeId))} /><span className="break-words">{node.name}</span></label>}
            </li>)}
          </ul>
          {!loading && !folderError && !visibleNodes.length && <p className="text-sm text-muted">{c.empty}</p>}
        </div>
        <details open={selected.length > 0}><summary className="text-sm">{c.selected(selected.length)}</summary>
          <ul className="mt-2 max-h-[18dvh] space-y-1 overflow-auto">{selected.map(node => <li key={node.nodeId} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 break-words">{node.name}</span><Button size="icon" variant="quiet" aria-label={c.remove(node.name)} onClick={() => setSelected(items => items.filter(item => item.nodeId !== node.nodeId))}><Trash2 size={14} /></Button></li>)}</ul>
        </details>
      </fieldset>}
      {!!outcomes.length && <div className="space-y-2"><h3 className="text-sm font-semibold">{job ? c.batchReview : c.preparationResult}</h3>
        {job && <p className="text-sm">{c.files(job.documents.length)} · {size(job.archiveBytes)} · {job.profileName || c.currentTemplate} · <strong>{c.phases[job.phase]}</strong></p>}
        <ul className="max-h-[26dvh] space-y-2 overflow-auto text-sm">{outcomes.map(item => <li key={item.nodeId} className="rounded-lg border border-line p-2"><strong className="break-words">{item.name}</strong><span> · {item.status === "included" ? c.included : c.omitted}</span>{item.detail && <p className="mt-1 text-muted">{item.detail}</p>}</li>)}</ul>
        {job && <details className="text-xs text-muted"><summary>{c.integrity}</summary><p className="mt-2 break-all">SHA-256: {job.archiveSha256}</p><p>{c.contents}</p></details>}
        {job?.phase === "saved" && <InlineNotice tone="success" announce="status">{c.zipSaved}</InlineNotice>}
        {job?.phase === "cancelled" && <InlineNotice tone="neutral">{c.cancelled}</InlineNotice>}
        {(requiresCheck || job?.phase === "uncertain" || job?.phase === "picking") && <InlineNotice tone="warning">{c.uncertain}</InlineNotice>}
        {job && !!omitted.length && ["prepared", "cancelled"].includes(job.phase) && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acceptPartial} disabled={busy} onChange={event => setAcceptPartial(event.target.checked)} />{c.acceptPartial}</label>}
      </div>}
      {!!jobs.length && !job && <details><summary className="text-sm">{c.retained(jobs.length)}</summary><ul className="mt-2 max-h-[22dvh] space-y-2 overflow-auto">{jobs.map(item => <li key={item.id}><Button variant="quiet" size="compact" disabled={busy} className="w-full justify-start" onClick={() => show(item)}>{new Date(item.checkedAt).toLocaleString(language)} · {c.files(item.documents.length)} · {c.phases[item.phase]}</Button></li>)}</ul></details>}
      {confirmDiscard && job && <InlineNotice tone="warning">{c.discardWarning}<Button variant="danger" size="compact" disabled={busy} onClick={() => void action("discard")}>{c.confirmDiscard}</Button><Button variant="quiet" size="compact" disabled={busy} onClick={() => setConfirmDiscard(false)}>{c.cancelDiscard}</Button></InlineNotice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button data-autofocus disabled={busy} onClick={close}>{c.close}</Button>
        {job ? <>
          <Button disabled={busy} onClick={() => { setJob(undefined); setOutcomes([]); setConfirmDiscard(false); setRequiresCheck(false); }}>{c.newSelection}</Button>
          {job.phase !== "discarded" && <Button variant="quiet" disabled={busy || job.phase === "picking"} onClick={() => setConfirmDiscard(true)}>{c.discardBatch}</Button>}
          <Button disabled={busy} onClick={() => void action("check")}>{c.check}</Button>
          {canDeliver && <Button variant="primary" disabled={busy} onClick={() => void action("deliver")}><Download size={16} />{c.saveZip}</Button>}
        </> : <>
          {requiresCheck || !profiles ? <Button disabled={busy} onClick={() => { setReload(value => value + 1); }}>{c.refreshCatalog}</Button> : null}
          <Button variant="primary" disabled={busy || !connected || !profiles || catalogLoading || !selected.length || requiresCheck} onClick={() => void prepare()}>{c.prepareReview}</Button>
        </>}
      </div>
    </section>
  </ModalFrame>, document.body);
}
