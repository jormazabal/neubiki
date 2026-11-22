import { useEffect, useRef, useState } from "react";
import { ArrowLeft, History, Trash2 } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { deleteProtonAiHistory, listProtonAiHistory, readProtonAiHistory } from "../../lib/api/protonAiHistory";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import type { ProtonAiHistoryEntry, ProtonAiHistorySummary } from "../../types/protonAiHistory";
import { protonAssistantCopy } from "./protonAssistantCopy";

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function HistoryContent({ content, copy }: { content: ProtonAiHistoryEntry["content"]; copy: typeof protonAssistantCopy.es.history }) {
  if (content.kind === "image") {
    return imageTypes.has(content.contentType)
      ? <img className="max-h-80 w-full rounded-xl object-contain" alt={copy.retainedImage}
        src={`data:${content.contentType};base64,${content.contentBase64}`} />
      : <p>{copy.imageUnavailable}</p>;
  }
  return <div className="space-y-3">
    {content.kind === "assistant" && <div>
      <h4 className="font-semibold">{copy.prompt}</h4>
      <p className="whitespace-pre-wrap break-words">{content.prompt}</p>
    </div>}
    {content.kind === "translation" && <div>
      <h4 className="font-semibold">{copy.targetLanguage}</h4>
      <p>{content.language}</p>
    </div>}
    <div>
      <h4 className="font-semibold">{copy.result}</h4>
      <p className="whitespace-pre-wrap break-words rounded-xl bg-panel p-3">{content.text}</p>
    </div>
  </div>;
}

export function ProtonAiHistoryDialog({ onClose }: { onClose: () => void }) {
  const locale = useUiLocale();
  const copy = protonAssistantCopy[locale].history;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const [entries, setEntries] = useState<ProtonAiHistorySummary[] | null>(null);
  const [selected, setSelected] = useState<ProtonAiHistorySummary | null>(null);
  const [detail, setDetail] = useState<ProtonAiHistoryEntry | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [readError, setReadError] = useState<"expired" | "readError" | null>(null);
  const [listError, setListError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<"removed" | "openExpired" | null>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setListError(false);
    listProtonAiHistory(controller.signal).then(
      ({ entries }) => { if (!controller.signal.aborted) setEntries(entries); },
      () => { if (!controller.signal.aborted) setListError(true); },
    );
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    readProtonAiHistory(selected.id, controller.signal).then(
      entry => {
        if (controller.signal.aborted) return;
        if (Date.parse(entry.summary.expiresAt) > Date.now()) setDetail(entry);
        else setReadError("expired");
      },
      () => { if (!controller.signal.aborted) setReadError("readError"); },
    );
    return () => controller.abort();
  }, [selected]);

  useEffect(() => {
    if (!entries?.length) return;
    const next = Math.min(...entries.map(entry => Date.parse(entry.expiresAt)));
    if (!Number.isFinite(next)) return;
    function discardExpired() {
      const now = Date.now();
      if (now < next) return;
      setEntries(current => current?.filter(entry => Date.parse(entry.expiresAt) > now) ?? null);
      setDetail(current => current && Date.parse(current.summary.expiresAt) > now ? current : null);
      if (selected && Date.parse(selected.expiresAt) <= now) {
        setSelected(null);
        setConfirming(false);
        setNotice("openExpired");
        requestAnimationFrame(() => listTitle.current?.focus());
      }
    }
    const timer = window.setTimeout(discardExpired, Math.max(next - Date.now(), 0));
    document.addEventListener("visibilitychange", discardExpired);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", discardExpired);
    };
  }, [entries, selected]);

  function open(entry: ProtonAiHistorySummary) {
    setDetail(null);
    setReadError(null);
    setDeleteError(false);
    setNotice(null);
    setConfirming(false);
    // Reopen a failed request even when the same row is selected.
    setSelected({ ...entry });
    requestAnimationFrame(() => detailTitle.current?.focus());
  }

  function back() {
    setSelected(null);
    setDetail(null);
    setConfirming(false);
    requestAnimationFrame(() => listTitle.current?.focus());
  }

  async function removeSelected() {
    if (!selected || deleting) return;
    setDeleting(true);
    setDeleteError(false);
    try {
      await deleteProtonAiHistory(selected.id);
      setEntries(current => current?.filter(entry => entry.id !== selected.id) ?? null);
      setNotice("removed");
      back();
    } catch {
      setDeleteError(true);
    } finally {
      setDeleting(false);
    }
  }

  function close() {
    if (!deleting) onClose();
  }

  function date(iso: string) {
    const timestamp = Date.parse(iso);
    return Number.isFinite(timestamp) ? dateFormat.format(timestamp) : copy.noDate;
  }

  return <ModalFrame label={copy.title} onClose={close} className="!z-[170]">
    <section className="proton-confirm-dialog !w-full !max-w-3xl space-y-3 p-4 text-sm text-ink-primary">
      <DialogHeading title={copy.title} closeLabel={copy.close} onClose={close} busy={deleting} />
      <p className="text-ink-secondary">{copy.retention}</p>
      {notice && <InlineNotice tone={notice === "removed" ? "success" : "neutral"} announce="status">{copy[notice]}</InlineNotice>}
      {listError && <InlineNotice tone="error" announce="alert" action={<Button size="compact" onClick={() => setRefresh(value => value + 1)}>{copy.retry}</Button>}>
        {copy.listError}
      </InlineNotice>}
      {!entries && !listError && <p role="status">{copy.loading}</p>}
      {entries && entries.length === 0 && <p className="rounded-xl bg-panel p-4 text-ink-secondary">{copy.empty}</p>}
      {entries && entries.length > 0 && <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
        <nav aria-label={copy.recent} className={selected ? "hidden md:block" : undefined}>
          <h3 ref={listTitle} tabIndex={-1} className="mb-2 font-semibold">{copy.recent}</h3>
          <ul className="max-h-[45vh] space-y-1 overflow-y-auto">
            {entries.map(entry => <li key={entry.id}>
              <Button className="!h-auto !min-h-12 !w-full !justify-start text-left" variant={selected?.id === entry.id ? "secondary" : "quiet"}
                aria-current={selected?.id === entry.id ? "true" : undefined} disabled={deleting} onClick={() => open(entry)}>
                <History size={16} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block">{copy.labels[entry.kind]}</span>
                  <time dateTime={entry.createdAt} className="block text-xs text-ink-secondary">{date(entry.createdAt)}</time>
                </span>
              </Button>
            </li>)}
          </ul>
        </nav>
        {selected ? <article aria-label={copy.details} className="min-w-0 space-y-3">
          <Button variant="quiet" className="md:hidden" disabled={deleting} onClick={back}>
            <ArrowLeft size={16} aria-hidden="true" /> {copy.back}
          </Button>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 ref={detailTitle} tabIndex={-1} className="font-semibold">{copy.labels[selected.kind]}</h3>
              <p className="text-xs text-ink-secondary">{copy.expires} <time dateTime={selected.expiresAt}>{date(selected.expiresAt)}</time></p>
            </div>
            {!confirming && <Button variant="quiet" size="compact" onClick={() => setConfirming(true)}>
              <Trash2 size={16} aria-hidden="true" /> {copy.remove}
            </Button>}
          </div>
          {confirming && <div className="space-y-2 rounded-xl bg-panel p-3" role="group" aria-label={copy.confirmRemove}>
            <p>{copy.confirmText}</p>
            {deleteError && <InlineNotice tone="error" announce="alert">{copy.removeError}</InlineNotice>}
            <div className="flex flex-wrap gap-2">
              <Button size="compact" disabled={deleting} onClick={() => { setConfirming(false); setDeleteError(false); }}>{copy.cancel}</Button>
              <Button size="compact" variant="danger" disabled={deleting} onClick={() => void removeSelected()}>
                {deleting ? copy.removing : copy.removeEntry}
              </Button>
            </div>
          </div>}
          {readError && <InlineNotice tone="error" announce="alert">{copy[readError]}</InlineNotice>}
          {!detail && !readError && <p role="status">{copy.opening}</p>}
          {detail && <div className="max-h-[42vh] overflow-y-auto"><HistoryContent content={detail.content} copy={copy} /></div>}
        </article> : <p className="hidden rounded-xl bg-panel p-4 text-ink-secondary md:block">{copy.select}</p>}
      </div>}
    </section>
  </ModalFrame>;
}
