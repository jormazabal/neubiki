import { requestJson } from "./client";
import type { ProtonWorkspace } from "../../types/protonWorkspace";

export type ProtonReplacementReview = {
  operationId: string;
  applied: boolean;
  items: Array<{ nodeId: string; name: string; occurrences: number; before: string; after: string; state: "reviewed" | "prepared" | "not-applied" | "unknown" }>;
};

function post(workspace: ProtonWorkspace, action: string, body: object, signal?: AbortSignal) {
  return requestJson<ProtonReplacementReview>(`/api/proton/workspace/${action}`, {
    method: "POST", timeoutMs: 240_000, signal,
    body: JSON.stringify({ accountId: workspace.accountId, rootId: workspace.root.nodeId, ...body }),
  });
}

export function reviewProtonReplacements(workspace: ProtonWorkspace, nodeIds: string[], query: string, replacement: string, signal: AbortSignal) {
  return post(workspace, "replacement-review", { nodeIds, query, replacement }, signal);
}

export const applyProtonReplacements = (workspace: ProtonWorkspace, operationId: string) => post(workspace, "replacement-apply", { operationId });
export const checkProtonReplacements = (workspace: ProtonWorkspace, operationId: string) => post(workspace, "replacement-status", { operationId });
