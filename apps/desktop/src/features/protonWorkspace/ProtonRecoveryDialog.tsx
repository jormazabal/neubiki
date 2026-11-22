import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { createPortal } from "react-dom";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { StatusTag } from "../../components/ui/StatusTag";
import { getProtonErrorMessage } from "../../lib/i18n/protonErrors";
import {
  exportProtonRecovery, exportProtonRecoveryToMobile, listProtonRecovery, readProtonRecovery,
  recoveryEntryId, removeProtonRecoveryCopies, type ProtonRecoveryEntry, type ProtonRecoverySnapshot,
} from "../../lib/api/protonRecovery";
import { selectExportFilePath, selectHandwrittenExportFilePath } from "../../lib/runtime/exportDialogs";
import { ProtonHandwrittenPreview } from "./ProtonHandwrittenPreview";
import { isTauriMobileRuntime } from "../../lib/runtime/platform";
import type { ProtonWorkspace } from "../../types/protonWorkspace";
import { ReadonlyMarkdownViewer } from "../editor/ReadonlyMarkdownViewer";
import "./ProtonRecovery.css";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { useRecoveryCopy } from "../../lib/i18n/recoveryCopy";

const omitImages = () => "";

export function ProtonRecoveryDialog({ workspace, onClose }: { workspace: ProtonWorkspace | null; onClose: () => void }) {
  const {recovery:c,common} = useRecoveryCopy();
  const language = useUiLocale();
  const [entries, setEntries] = useState<ProtonRecoveryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<ProtonRecoveryEntry | null>(null);
  const [snapshot, setSnapshot] = useState<ProtonRecoverySnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const activeQuery = useRef<AbortController | null>(null);
  const activeAction = useRef(false);
  const heading = useRef<HTMLDivElement>(null);
  const lastSelected = useRef<string | null>(null);

  async function load(nextCursor: string | null, signal: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const page = await listProtonRecovery(nextCursor, signal);
      if (signal.aborted) return;
      setEntries(previous => nextCursor ? [...new Map([...previous, ...page.entries].map(entry => [recoveryEntryId(entry), entry])).values()] : page.entries);
      setCursor(page.nextCursor);
      setPartial(previous => nextCursor ? previous || page.partial : page.partial);
      setLoaded(true);
    } catch (cause) {
      if (!signal.aborted) setError(getProtonErrorMessage(cause, c.listFailed, language));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const query = new AbortController();
    activeQuery.current = query;
    void load(null, query.signal);
    return () => activeQuery.current?.abort();
  }, [refresh]);

  useEffect(() => {
    if (!selection) return;
    const query = new AbortController();
    void readProtonRecovery(selection, query.signal).then(value => {
      if (!query.signal.aborted) setSnapshot(value);
    }, cause => {
      if (!query.signal.aborted) setError(getProtonErrorMessage(cause, c.readFailed, language));
    });
    heading.current?.focus();
    return () => query.abort();
  }, [selection]);

  function open(entry: ProtonRecoveryEntry) {
    setSnapshot(null);
    setError("");
    setNotice("");
    lastSelected.current = recoveryEntryId(entry);
    setSelection(entry);
  }

  function back() {
    setSelection(null);
    setSnapshot(null);
    setError("");
    setConfirmRemove(false);
    requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-recovery-entry]")).find(button => button.dataset.recoveryEntry === lastSelected.current);
      (target ?? heading.current)?.focus({ preventScroll: true });
    });
  }

  async function exportEntry() {
    if (!selection || !snapshot || activeAction.current) return;
    activeAction.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (isTauriMobileRuntime()) {
        const result = await exportProtonRecoveryToMobile(selection);
        if (result.status === "saved") setNotice(c.exported.replace("{name}",result.fileName));
      } else {
        const output = snapshot.handwritten ? await selectHandwrittenExportFilePath(snapshot.fileName, "nbnote", language)
          : await selectExportFilePath(snapshot.fileName, "md", language);
        if (output) {
          const result = await exportProtonRecovery(selection, output);
          setNotice(c.exported.replace("{name}",result.outputPath.split(/[\\/]/).pop() || snapshot.fileName));
        }
      }
    } catch (cause) {
      setError(getProtonErrorMessage(cause, c.exportFailed, language));
    } finally {
      activeAction.current = false;
      setBusy(false);
    }
  }

  async function removeCopies() {
    if (!selection || !confirmRemove || activeAction.current) return;
    activeAction.current = true;
    setBusy(true);
    setError("");
    try {
      await removeProtonRecoveryCopies(selection);
      back();
      setNotice(c.removed);
      setRefresh(value => value + 1);
    } catch (cause) {
      setError(getProtonErrorMessage(cause, c.removeFailed, language));
    } finally {
      activeAction.current = false;
      setBusy(false);
    }
  }

  function close() {
    if (activeAction.current) return;
    if (confirmRemove) setConfirmRemove(false);
    else if (selection) back();
    else onClose();
  }

  const groups = new Map<string, { current: boolean; name: string; entries: ProtonRecoveryEntry[] }>();
  for (const entry of entries) {
    const groupId = JSON.stringify([entry.key.accountId, entry.key.rootId]);
    if (!groups.has(groupId)) groups.set(groupId, {
      current: workspace?.accountId === entry.key.accountId && workspace.root.nodeId === entry.key.rootId,
      name: entry.rootName, entries: [],
    });
    groups.get(groupId)!.entries.push(entry);
  }
  const orderedGroups = [...groups.entries()].sort(([, a], [, b]) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name,language));

  return createPortal(<ModalFrame label={c.title} onClose={close}>
    <section className="proton-confirm-dialog proton-recovery-dialog p-4 md:p-5">
      <div ref={heading} tabIndex={-1} className="outline-none"><DialogHeading title={c.title} closeLabel={common.close} onClose={onClose} busy={busy} /></div>
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {notice && <InlineNotice tone="success" announce="status">{notice}</InlineNotice>}
      {selection ? <>
        <Button variant="quiet" size="compact" disabled={busy} onClick={back}><ArrowLeft size={16} aria-hidden="true" /> {c.back}</Button>
        <div className="min-w-0 break-words">
          <p className="text-xs text-ink-secondary">{selection.rootName} · {c.kinds[selection.kind]}</p>
          <h3 className="text-base font-semibold">{selection.documentName}</h3>
        </div>
        {!snapshot && !error && <p role="status" className="text-sm text-ink-secondary">{c.reading}</p>}
        {snapshot && <div className="proton-recovery-reader">{snapshot.handwritten
          ? <ProtonHandwrittenPreview note={snapshot.handwritten} busy={busy} onReload={() => open(selection)} />
          : <ReadonlyMarkdownViewer markdown={snapshot.markdown}
            ariaLabel={c.content} emptyMessage={c.emptyDocument} resolveImageSource={omitImages} />}</div>}
        {confirmRemove ? <div className="space-y-2">
          <InlineNotice tone="warning">{c.removeHelp}</InlineNotice>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => setConfirmRemove(false)}>{common.cancel}</Button>
            <Button variant="danger" disabled={busy} onClick={() => { void removeCopies(); }}>{c.removeBoth}</Button>
          </div>
        </div> : <div className="flex flex-wrap justify-end gap-2">
          {selection.kind !== "draft" && snapshot && <Button variant="quiet" disabled={busy} onClick={() => setConfirmRemove(true)}>{c.remove}</Button>}
          <Button variant="primary" disabled={busy || !snapshot} onClick={() => { void exportEntry(); }}>
            <Download size={16} aria-hidden="true" /> {busy ? c.exporting : snapshot?.handwritten ? c.exportNote : c.exportMarkdown}
          </Button>
        </div>}
      </> : <>
        <p className="text-sm text-ink-secondary">{c.help}</p>
        {partial && <InlineNotice tone="warning">{c.partial}</InlineNotice>}
        {loading && <p role="status" className="text-sm text-ink-secondary">{c.loading}</p>}
        {loaded && !loading && !entries.length && !cursor && <p className="text-sm text-ink-secondary">{c.empty}</p>}
        {orderedGroups.map(([groupId, group]) => <section key={groupId} className="min-w-0 space-y-2">
          <h3 className="break-words text-sm font-semibold">{group.name}{group.current && <span className="ml-2 text-xs font-normal text-ink-secondary">{c.current}</span>}</h3>
          <ul className="proton-recovery-list">
            {group.entries.map(entry => <li key={recoveryEntryId(entry)}>
              <button type="button" className="proton-recovery-item" data-recovery-entry={recoveryEntryId(entry)} onClick={() => open(entry)}>
                <FileText size={17} aria-hidden="true" />
                <span className="min-w-0 grow break-words text-left">{entry.documentName}</span>
                <StatusTag tone={entry.state === "conflict" || entry.state === "unknown" ? "warning" : "neutral"}>
                  {entry.state === "conflict" ? c.conflict : entry.state === "unknown" ? c.pending : c.kinds[entry.kind]}
                </StatusTag>
              </button>
            </li>)}
          </ul>
        </section>)}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{c.refresh}</Button>
          {cursor && <Button disabled={loading} onClick={() => {
            activeQuery.current?.abort();
            const query = new AbortController();
            activeQuery.current = query;
            void load(cursor, query.signal);
          }}>{c.more}</Button>}
          <Button data-autofocus onClick={onClose}>{common.close}</Button>
        </div>
      </>}
    </section>
  </ModalFrame>, document.body);
}
