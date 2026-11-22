import { FileText, Folder, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { ApiError } from "../../lib/api/client";
import { getProtonErrorMessage } from "../../lib/i18n/protonErrors";
import {
  checkProtonTrashRestore, listProtonTrash, restoreProtonTrashItem,
  type ProtonTrashAttempt, type ProtonTrashItem, type ProtonTrashListing, type ProtonTrashResult,
  type ProtonTrashScope,
} from "../../lib/api/protonTrash";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { useRecoveryCopy } from "../../lib/i18n/recoveryCopy";

type Props = ProtonTrashScope & {
  canRestore: boolean;
  onRestored: () => void;
  onClose: () => void;
  fallbackFocus?: () => HTMLElement | null;
};

export function ProtonTrashDialog(props: Props) {
  return <TrashContent key={JSON.stringify([props.accountId, props.rootId])} {...props} />;
}

function TrashContent({ accountId, rootId, canRestore, onRestored, onClose, fallbackFocus }: Props) {
  const {trash:c,common} = useRecoveryCopy();
  const language = useUiLocale();
  const formatDate = new Intl.DateTimeFormat(language,{dateStyle:"medium",timeStyle:"short"});
  const [listing, setListing] = useState<ProtonTrashListing>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState<ProtonTrashItem>();
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "error"; text: string }>();
  const [busy, setBusy] = useState(false);
  const requestActive = useRef(false);
  const mounted = useRef(false);
  const heading = useRef<HTMLButtonElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement>();
  const scope = { accountId, rootId };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setLoadError("");
    void listProtonTrash({ accountId, rootId }, request.signal).then(value => {
      if (!request.signal.aborted) {
        setListing(value);
        setLoading(false);
      }
    }, cause => {
      if (!request.signal.aborted) {
        setLoadError(getProtonErrorMessage(cause, c.listFailed, language));
        setLoading(false);
      }
    });
    return () => request.abort();
  }, [accountId, rootId, refresh]);

  const pendingIds = new Set(listing?.pending.map(attempt => attempt.nodeId));
  const items = listing?.items.filter(item => !pendingIds.has(item.node.nodeId)) ?? [];

  function dismissReview() {
    setReview(undefined);
    requestAnimationFrame(() => {
      const trigger = reviewTrigger.current;
      (trigger?.isConnected ? trigger : heading.current)?.focus();
    });
  }

  function report(result: ProtonTrashResult, fallback?: ProtonTrashItem) {
    if (result.state === "restored") {
      setListing(current => current && {
        ...current,
        items: current.items.filter(item => item.node.nodeId !== result.node.nodeId),
        pending: current.pending.filter(item => item.nodeId !== result.node.nodeId),
      });
      setFeedback({ tone: "success", text: c.restored.replace("{name}",result.node.name) });
      onRestored();
    } else {
      if (fallback) recordPending(fallback);
      setFeedback({ tone: "warning", text: c.pendingResult });
    }
  }

  function recordPending(item: ProtonTrashItem) {
    const attempt = { nodeId: item.node.nodeId, parentId: item.parentId,
      expectedName: item.node.name, trashedAt: item.trashedAt };
    setListing(current => current && {
      ...current, pending: [...current.pending.filter(record => record.nodeId !== attempt.nodeId), attempt],
    });
  }

  async function run(work: () => Promise<ProtonTrashResult>, item?: ProtonTrashItem) {
    if (requestActive.current || loading) return;
    requestActive.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await work();
      if (mounted.current) {
        report(result, item);
        if (item) dismissReview();
      }
    } catch (cause) {
      if (!mounted.current) return;
      const unknown = !(cause instanceof ApiError) || cause.operationOutcome === "unknown";
      if (item && unknown) {
        recordPending(item);
        dismissReview();
      }
      if (cause instanceof ApiError && cause.code === "proton-trash-attempt-not-found") {
        setRefresh(value => value + 1);
      }
      setFeedback({
        tone: item && unknown ? "warning" : "error",
        text: item && unknown ? c.unknown : getProtonErrorMessage(cause, c.failed, language),
      });
    } finally {
      requestActive.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function close() {
    if (requestActive.current) return;
    if (review) dismissReview();
    else onClose();
  }

  function check(attempt: ProtonTrashAttempt) {
    void run(() => checkProtonTrashRestore(scope, attempt.nodeId));
  }

  return createPortal(
    <ModalFrame label={c.title} onClose={close} fallbackFocus={fallbackFocus} className="proton-rail-dialog">
      <section className="proton-confirm-dialog w-full space-y-3 p-5">
        <DialogHeading title={c.title} closeLabel={common.close} onClose={close} busy={busy} />
        {feedback && <InlineNotice tone={feedback.tone} announce={feedback.tone === "success" ? "status" : "alert"}>{feedback.text}</InlineNotice>}
        {review ? <div className="space-y-3">
          <h3 className="font-semibold">{c.review.replace("{name}",review.node.name)}</h3>
          <p className="break-words text-sm">{c.destination} <strong>{review.destination.join(" / ")}</strong></p>
          <p className="text-sm text-ink-secondary">{c.collisionHelp}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button ref={heading} disabled={busy} onClick={dismissReview}>{common.cancel}</Button>
            <Button variant="primary" disabled={busy || !canRestore}
              onClick={() => void run(() => restoreProtonTrashItem(scope, review), review)}>{c.restore}</Button>
          </div>
        </div> : <>
          {loadError && <InlineNotice tone="error" announce="alert">{loadError}</InlineNotice>}
          {listing && !listing.complete && <InlineNotice tone="warning">{c.partial}</InlineNotice>}
          {listing && !canRestore && <p className="text-sm text-ink-secondary">{c.unavailable}</p>}
          {listing && items.length === 0 && listing.pending.length === 0 && !loading && !loadError &&
            <p className="text-sm text-ink-secondary">{listing.complete ? c.empty : c.partialEmpty}</p>}
          {(items.length > 0 || !!listing?.pending.length) && <ul className="max-h-[50dvh] divide-y divide-line overflow-y-auto">
            {listing?.pending.map(attempt => <li key={attempt.nodeId} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{attempt.expectedName}</p>
                <p className="text-xs text-ink-secondary">{c.pending}</p>
              </div>
              <Button disabled={busy || loading} onClick={() => check(attempt)}>{c.check}</Button>
            </li>)}
            {items.map(item => {
              const Icon = item.node.type === "folder" ? Folder : FileText;
              return <li key={item.node.nodeId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="flex min-w-0 gap-2">
                  <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{item.node.name}</p>
                    <p className="break-words text-xs text-ink-secondary">{item.destination.join(" / ")}</p>
                    <time dateTime={item.trashedAt} className="text-xs text-ink-secondary">
                      {formatDate.format(new Date(item.trashedAt))}
                    </time>
                  </div>
                </div>
                {canRestore && <Button disabled={busy || loading || Boolean(loadError)} aria-label={c.restoreLabel.replace("{name}",item.node.name)}
                  onClick={event => {
                    reviewTrigger.current = event.currentTarget;
                    setFeedback(undefined);
                    setReview(item);
                    requestAnimationFrame(() => heading.current?.focus());
                  }}>
                  <RotateCcw size={16} aria-hidden="true" /> {c.openReview}
                </Button>}
              </li>;
            })}
          </ul>}
          <div className="flex justify-end">
            <Button ref={heading} disabled={loading || busy}
              onClick={() => setRefresh(value => value + 1)}>{loadError ? c.retry : c.refresh}</Button>
          </div>
        </>}
        {(loading || busy) && <ProgressBar label={loading ? c.loading : review ? c.restoring : c.checking} />}
      </section>
    </ModalFrame>, document.body,
  );
}
