import { requestJson } from "./client";
import type { ProtonNode } from "../../types/protonWorkspace";

export type ProtonFavoritesScope = { accountId: string; rootId: string };
export type ProtonFavoritesSnapshot = {
  nodeId: string | null; revisionId: string | null; items: string[]; operationId: string | null; updatedAt: string | null;
  outcome: "confirmed" | "unknown"; pendingOperationId: string | null; checkedAt: string;
  canReviewPending?: boolean;
  closedWithoutConfirmation?: string;
};

function post(scope: ProtonFavoritesScope, action: string, body: object = {}, signal?: AbortSignal) {
  return requestJson<ProtonFavoritesSnapshot>(`/api/proton/workspace/${action}`, {
    method: "POST", body: JSON.stringify({ ...scope, ...body }), signal, timeoutMs: 240_000,
  });
}
export const readProtonFavorites = (scope: ProtonFavoritesScope, signal?: AbortSignal) => post(scope, "favorites", {}, signal);
export const checkProtonFavorites = (scope: ProtonFavoritesScope) => post(scope, "favorites-check");
export const closePendingProtonFavorite = (scope: ProtonFavoritesScope, review: ProtonFavoritesSnapshot) =>
  post(scope, "favorites-check", { closePending: {
    acknowledged: true, operationId: review.pendingOperationId, metadataNodeId: review.nodeId, revisionId: review.revisionId,
  } });
export const updateProtonFavorites = (scope: ProtonFavoritesScope, base: ProtonFavoritesSnapshot, items: string[]) =>
  post(scope, "favorites-update", { metadataNodeId: base.nodeId, baseRevisionId: base.revisionId, items });

export type ProtonFavoriteItems = {
  items: { nodeId: string; node: ProtonNode | null; status: "available" | "missing" | "unavailable" }[];
  total: number; offset: number; nextOffset: number | null; missing: number; unavailable: number; partial: boolean; revisionId: string | null; checkedAt: string;
};
export function listProtonFavoriteItems(scope: ProtonFavoritesScope, offset = 0, signal?: AbortSignal) {
  return requestJson<ProtonFavoriteItems>("/api/proton/workspace/favorite-items", {
    method: "POST", body: JSON.stringify({ ...scope, offset }), signal, timeoutMs: 240_000,
  });
}
