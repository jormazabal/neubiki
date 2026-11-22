import { getProtonErrorMessage } from "../../lib/i18n/protonErrors";
import type { UiLanguage } from "../../lib/i18n/uiCopy";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkProtonFavorites, closePendingProtonFavorite, readProtonFavorites, updateProtonFavorites, type ProtonFavoritesScope, type ProtonFavoritesSnapshot } from "../../lib/api/protonFavorites";

type Issue = { cause?: unknown; fallback: "load" | "save" | "check" | "limit" };
type State = { key: string; snapshot?: ProtonFavoritesSnapshot; phase: "loading" | "ready" | "saving" | "checking" | "unknown" | "error"; error?: Issue };

const favoritesErrors = {
  es: {load:"No se pudieron leer los favoritos compartidos.", save:"No se confirmó el cambio. Comprueba su estado antes de continuar.", check:"No se pudo comprobar el estado de favoritos.", limit:"El proyecto admite hasta 200 favoritos."},
  en: {load:"Shared favorites could not be read.", save:"The change is unconfirmed. Check its status before continuing.", check:"The status of favorites could not be checked.", limit:"The project supports up to 200 favorites."},
};

export function useProtonFavorites({ scope, connected, canWrite, language = "es" }: { scope: ProtonFavoritesScope; connected: boolean; canWrite: boolean; language?: UiLanguage }) {
  const key = JSON.stringify([scope.accountId, scope.rootId]);
  const currentKey = useRef(key); currentKey.current = key;
  const inFlight = useRef(false);
  const [state, setState] = useState<State>({ key, phase: "loading" });
  const [reload, setReload] = useState(0);
  const current: State = state.key === key ? state : { key, phase: "loading" };
  const { accountId, rootId } = scope;
  const pendingReview = current.phase === "unknown" && !current.error && current.snapshot?.canReviewPending
    && current.snapshot.pendingOperationId ? {
      key: JSON.stringify([current.snapshot.pendingOperationId, current.snapshot.nodeId, current.snapshot.revisionId]),
      revisionId: current.snapshot.revisionId,
    } : null;

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    setState(previous => ({ key, snapshot: previous.key === key ? previous.snapshot : undefined, phase: "loading" }));
    void readProtonFavorites({ accountId, rootId }, controller.signal).then(snapshot => {
      if (!controller.signal.aborted && currentKey.current === key) setState({ key, snapshot, phase: snapshot.outcome === "unknown" ? "unknown" : "ready" });
    }, cause => {
      if (!controller.signal.aborted && currentKey.current === key) setState(previous => ({ ...previous, key, phase: "error", error: { cause, fallback: "load" } }));
    });
    return () => controller.abort();
  }, [accountId, rootId, key, connected, reload]);

  async function toggle(nodeId: string) {
    if (!connected || !canWrite || inFlight.current || current.phase !== "ready" || !current.snapshot) return;
    const base = current.snapshot;
    const items = base.items.includes(nodeId) ? base.items.filter(id => id !== nodeId) : [...base.items, nodeId];
    if (items.length > 200) { setState({ ...current, error: { fallback: "limit" } }); return; }
    inFlight.current = true;
    setState({ key, snapshot: base, phase: "saving" });
    try {
      const snapshot = await updateProtonFavorites({ accountId, rootId }, base, items);
      if (currentKey.current === key) setState({ key, snapshot, phase: snapshot.outcome === "unknown" ? "unknown" : "ready" });
    } catch (cause) {
      if (currentKey.current === key) setState({ key, snapshot: base, phase: "unknown", error: { cause, fallback: "save" } });
    } finally { inFlight.current = false; }
  }

  async function check(closeReviewKey?: string) {
    if (!connected || inFlight.current
      || (closeReviewKey !== undefined && (pendingReview?.key !== closeReviewKey || !current.snapshot))) return;
    inFlight.current = true;
    setState({ ...current, phase: "checking", error: undefined });
    try {
      const snapshot = closeReviewKey === undefined
        ? await checkProtonFavorites({ accountId, rootId })
        : await closePendingProtonFavorite({ accountId, rootId }, current.snapshot!);
      if (currentKey.current === key) setState({ key, snapshot, phase: snapshot.outcome === "unknown" ? "unknown" : "ready" });
    } catch (cause) {
      if (currentKey.current === key) setState({ ...current, phase: current.phase === "unknown" ? "unknown" : "error", error: { cause, fallback: "check" } });
    } finally { inFlight.current = false; }
  }

  const refresh = useCallback(() => { if (!inFlight.current) setReload(value => value + 1); }, []);
  const error = current.error ? getProtonErrorMessage(current.error.cause, favoritesErrors[language][current.error.fallback], language) : undefined;
  return { ids: current.snapshot?.items ?? [], phase: current.phase, error,
    updatedAt: current.snapshot?.updatedAt ?? null, pendingOperationId: current.snapshot?.pendingOperationId ?? null,
    pendingReview, closedWithoutConfirmation: current.snapshot?.closedWithoutConfirmation ?? null,
    busy: current.phase === "saving", canToggle: connected && canWrite && current.phase === "ready", toggle, refresh, check };
}
