import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Star } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { listProtonFavoriteItems, type ProtonFavoritesScope } from "../../lib/api/protonFavorites";
import type { ProtonNode } from "../../types/protonWorkspace";
import { useUiLocale } from "../../lib/i18n/UiLocale";

type Page = Awaited<ReturnType<typeof listProtonFavoriteItems>>;

const text = {
  es: {
    title: "Favoritos compartidos", description: "Los favoritos de este proyecto se guardan en Proton Drive y se comparten entre dispositivos.",
    offline: "Vuelve a conectar a Proton para consultar el estado compartido.", check: "Comprobar",
    unknown: "Queda un cambio de favoritos pendiente de confirmación.", retry: "Reintentar",
    review: "Revisar la lista actual", continueWithCurrent: "Continuar con la lista de Proton",
    reviewHelp: "Revisa los favoritos guardados en Proton. Si continúas con esta lista, el intento anterior quedará cerrado sin confirmación. Si el cambio aún está en curso, podría aparecer más tarde.",
    cancelReview: "Volver", closedUnconfirmed: "Se cerró un intento sin confirmar. La lista muestra los favoritos guardados en Proton.",
    error: "No se pudieron consultar los favoritos.", loading: "Leyendo favoritos…",
    empty: "Todavía no hay favoritos. Puedes añadir archivos desde su menú de opciones.",
    partial: "Algunos favoritos ya no están disponibles o no se pudieron verificar.", missing: "Archivo no encontrado",
    unavailable: "Archivo por comprobar", unnamed: "favorito sin archivo", remove: "Quitar", previous: "Anterior", of: "de",
    next: "Siguiente", close: "Cerrar",
  },
  en: {
    title: "Shared favorites", description: "Project favorites are stored in Proton Drive and shared across devices.",
    offline: "Reconnect to Proton to check the shared state.", check: "Check",
    unknown: "A favorites change is waiting for confirmation.", retry: "Try again",
    review: "Review the current list", continueWithCurrent: "Continue with the Proton list",
    reviewHelp: "Review the favorites stored in Proton. Continuing with this list closes the earlier attempt without confirmation. A change still in progress could appear later.",
    cancelReview: "Go back", closedUnconfirmed: "An attempt was closed without confirmation. The list shows the favorites stored in Proton.",
    error: "Favorites could not be read.", loading: "Reading favorites…",
    empty: "There are no favorites yet. Add a file from its options menu.",
    partial: "Some favorites are unavailable or could not be verified.", missing: "File not found",
    unavailable: "File awaiting verification", unnamed: "missing favorite", remove: "Remove", previous: "Previous", of: "of",
    next: "Next", close: "Close",
  },
} as const;

export function ProtonFavoritesDialog({ scope, connected, canToggle, pending, unknown, mutationError, updatedAt,
  pendingReview, closedWithoutConfirmation, onOpen, onToggle, onCheck, onClosePending, onClose, fallbackFocus }: {
  scope: ProtonFavoritesScope;
  connected: boolean;
  canToggle: boolean;
  pending: boolean;
  unknown: boolean;
  mutationError?: string;
  updatedAt: string | null;
  pendingReview?: { key: string; revisionId: string | null } | null;
  closedWithoutConfirmation?: string | null;
  onOpen: (node: ProtonNode) => void;
  onToggle: (id: string) => void;
  onCheck: () => void;
  onClosePending?: (reviewKey: string) => void;
  onClose: () => void;
  fallbackFocus?: () => HTMLElement | null;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const copy = text[useUiLocale()];
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const reviewHadFocus = useRef(false);
  const { accountId, rootId } = scope;
  const reviewAvailable = connected && !pending && !loading && !error && !!page && !!pendingReview
    && page.revisionId === pendingReview.revisionId;
  const reviewing = reviewAvailable && reviewKey === pendingReview?.key;
  useEffect(() => {
    if (reviewing) {
      backButton.current?.focus();
      reviewHadFocus.current = true;
    } else if (reviewHadFocus.current && reviewAvailable) {
      reviewButton.current?.focus();
      reviewHadFocus.current = false;
    }
  }, [reviewAvailable, reviewing]);
  useEffect(() => {
    if (!connected || pending) return;
    const request = new AbortController();
    setLoading(true);
    setError("");
    void listProtonFavoriteItems({ accountId, rootId }, offset, request.signal).then(result => {
      if (request.signal.aborted) return;
      if (result.items.length === 0 && offset > 0) setOffset(Math.max(0, offset - 20));
      else setPage(result);
    }).catch(cause => {
      if (!request.signal.aborted) setError(runtimeErrorMessage(cause, copy.error));
    }).finally(() => {
      if (!request.signal.aborted) setLoading(false);
    });
    return () => request.abort();
  }, [accountId, rootId, offset, retry, connected, pending, updatedAt, copy.error, pendingReview?.key]);

  return createPortal(<ModalFrame label={copy.title} fallbackFocus={fallbackFocus}
    onClose={() => { if (!pending) onClose(); }}>
    <section className="proton-confirm-dialog space-y-3 p-4">
      <DialogHeading title={copy.title} closeLabel={copy.close} busy={pending} onClose={onClose} />
      <p className="text-sm text-ink-secondary">{copy.description}</p>
      {!connected && <InlineNotice tone="warning" announce="status">{copy.offline}</InlineNotice>}
      {unknown && <InlineNotice tone="warning" announce="status"
        action={<Button size="compact" disabled={!connected || pending} onClick={onCheck}>{copy.check}</Button>}>
        {copy.unknown}
      </InlineNotice>}
      {!unknown && closedWithoutConfirmation && <InlineNotice tone="warning" announce="status">{copy.closedUnconfirmed}</InlineNotice>}
      {mutationError && <InlineNotice tone="error" announce="alert">{mutationError}</InlineNotice>}
      {error && <InlineNotice tone="error" announce="alert"
        action={<Button size="compact" disabled={!connected || loading} onClick={() => setRetry(value => value + 1)}>{copy.retry}</Button>}>{error}</InlineNotice>}
      {loading && <p role="status" className="text-sm">{copy.loading}</p>}
      {connected && !loading && !error && page && <>
        {page.total === 0 && <p className="py-2 text-sm text-ink-secondary">{copy.empty}</p>}
        {page.partial && <InlineNotice tone="warning">{copy.partial}</InlineNotice>}
        <ul className="max-h-[42dvh] divide-y divide-line overflow-auto">
          {page.items.map(item => <li key={item.nodeId} className="flex min-h-12 items-center gap-2 py-1">
            <Star aria-hidden="true" size={15} className="shrink-0 fill-current text-brand-dark" />
            {item.node ? <button type="button" className="min-w-0 flex-1 break-all py-2 text-left text-sm hover:underline"
              disabled={pending} onClick={() => item.node && onOpen(item.node)}>{item.node.name}</button>
              : <span className="min-w-0 flex-1 text-sm text-ink-secondary">
                {item.status === "missing" ? copy.missing : copy.unavailable}
              </span>}
            <Button size="compact" variant="quiet" aria-label={`${copy.remove} ${item.node?.name ?? copy.unnamed}`}
              disabled={!canToggle || pending} onClick={() => onToggle(item.nodeId)}>{copy.remove}</Button>
          </li>)}
        </ul>
        {(page.offset > 0 || page.nextOffset !== null) && <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="compact" disabled={page.offset === 0 || pending} onClick={() => setOffset(Math.max(0, page.offset - 20))}>{copy.previous}</Button>
          <span className="text-xs text-ink-secondary">{page.offset + 1}–{page.offset + page.items.length} {copy.of} {page.total}</span>
          <Button size="compact" disabled={page.nextOffset === null || pending} onClick={() => setOffset(page.nextOffset ?? page.offset)}>{copy.next}</Button>
        </div>}
      </>}
      {unknown && pendingReview && onClosePending && (reviewing
        ? <section aria-label={copy.review} className="space-y-2 rounded-xl border border-line p-3 text-sm">
          <p>{copy.reviewHelp}</p>
          <div className="flex flex-wrap gap-2">
            <Button ref={backButton} size="compact" onClick={() => setReviewKey(null)}>{copy.cancelReview}</Button>
            <Button size="compact" variant="primary" onClick={() => {
              setReviewKey(null);
              onClosePending(pendingReview.key);
            }}>{copy.continueWithCurrent}</Button>
          </div>
        </section>
        : <Button ref={reviewButton} size="compact" disabled={!reviewAvailable} onClick={() => setReviewKey(pendingReview.key)}>{copy.review}</Button>)}
      <div className="flex justify-end">
        <Button disabled={pending} onClick={onClose}>{copy.close}</Button>
      </div>
    </section>
  </ModalFrame>, document.body);
}
