import { requestJson } from "./client";
import type { ProtonReplacementReview } from "./protonReplacements";
import type { ProtonReplacementSuggestionAnchor } from "./protonReplacementSuggestion";

export type BatchEditTask = { task: "clarity" } | { task: "translate"; language: "es" | "en" | "eu" | "fr" };
export type BatchEditFile = { nodeId: string; revisionId: string; name: string };
export type BatchEditInput = ProtonReplacementSuggestionAnchor & BatchEditTask & { documents: BatchEditFile[] };
export type BatchEditQuote = { quoteId: string; issuedAt: number; expiresAt: number; model: string; estimatedEur: number; documents: BatchEditFile[] };
export type BatchEditProposal = BatchEditFile & { baseDigest: string; status: "proposed" | "unchanged" | "unavailable"; after: string | null };

function payload(input: BatchEditInput) {
  return {
    accountId: input.accountId, rootId: input.rootId, nodeId: input.nodeId, baseRevisionId: input.baseRevisionId,
    task: input.task, ...(input.task === "translate" ? { language: input.language } : {}),
    documents: input.documents.map(({ nodeId, revisionId }) => ({ nodeId, revisionId })),
  };
}

export function quoteProtonBatchEdit(input: BatchEditInput) {
  return requestJson<BatchEditQuote>("/api/proton/ai/batch-edit-review", {
    method: "POST", body: JSON.stringify(payload(input)), timeoutMs: 180_000,
  });
}

export function runProtonBatchEdit(input: BatchEditInput, quote: BatchEditQuote) {
  return requestJson<{ documents: BatchEditProposal[]; usageRecorded: boolean }>("/api/proton/ai/batch-edit-run", {
    method: "POST", timeoutMs: 240_000,
    body: JSON.stringify({ ...payload(input), quoteId: quote.quoteId, issuedAt: quote.issuedAt, confirmed: true }),
  });
}

export function prepareProtonBatchEdit(input: BatchEditInput, proposals: BatchEditProposal[], signal: AbortSignal) {
  return requestJson<ProtonReplacementReview>("/api/proton/workspace/batch-edit-prepare", {
    method: "POST", signal, timeoutMs: 180_000, body: JSON.stringify({
      ...payload(input), confirmed: true,
      proposals: proposals.map(({ nodeId, revisionId, baseDigest, after }) => ({ nodeId, revisionId, baseDigest, after })),
    }),
  });
}
