import { requestJson } from "./client";
import type { ProtonNode } from "../../types/protonWorkspace";

export type ProtonTrashScope = { accountId: string; rootId: string };
export type ProtonTrashItem = {
  node: ProtonNode;
  parentId: string;
  destination: string[];
  trashedAt: string;
};
export type ProtonTrashAttempt = {
  nodeId: string;
  parentId: string;
  expectedName: string;
  trashedAt: string;
};
export type ProtonTrashListing = {
  items: ProtonTrashItem[];
  pending: ProtonTrashAttempt[];
  complete: boolean;
};
export type ProtonTrashResult =
  | { state: "restored"; node: ProtonNode }
  | { state: "pending"; nodeId: string };

function trashRequest<T>(action: string, body: object, signal?: AbortSignal) {
  return requestJson<T>(`/api/proton/workspace/${action}`, {
    method: "POST", body: JSON.stringify(body), timeoutMs: 210_000, signal,
  });
}

export function listProtonTrash(scope: ProtonTrashScope, signal?: AbortSignal) {
  return trashRequest<ProtonTrashListing>("trash-list", scope, signal);
}

export function restoreProtonTrashItem(scope: ProtonTrashScope, item: ProtonTrashItem) {
  return trashRequest<ProtonTrashResult>("trash-restore", {
    ...scope, nodeId: item.node.nodeId, parentId: item.parentId,
    expectedName: item.node.name, trashedAt: item.trashedAt,
  });
}

export function checkProtonTrashRestore(scope: ProtonTrashScope, nodeId: string) {
  return trashRequest<ProtonTrashResult>("trash-check", { ...scope, nodeId });
}
