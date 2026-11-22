import { requestJson } from "./client";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";

export type ProtonReplacementSuggestionAnchor = ProtonDocumentKey & { baseRevisionId: string };
export type ProtonReplacementSuggestionSource = { nodeId: string; revisionId: string; name: string };
type Input = ProtonReplacementSuggestionAnchor & {
  query: string;
  intent: string;
  sources: Pick<ProtonReplacementSuggestionSource, "nodeId" | "revisionId">[];
};
export type ProtonReplacementSuggestionQuote = { quoteId: string; model: string; estimatedEur: number; sourceNames: string[] };
type Reply = { replacement: string; usageRecorded: boolean };

function payload({ accountId, rootId, nodeId, baseRevisionId, query, intent, sources }: Input) {
  return { accountId, rootId, nodeId, baseRevisionId, query, intent,
    sources: sources.map(({ nodeId, revisionId }) => ({ nodeId, revisionId })) };
}

export function reviewProtonReplacementSuggestion(input: Input) {
  return requestJson<ProtonReplacementSuggestionQuote>("/api/proton/ai/replacement-suggestion-review", {
    method: "POST", body: JSON.stringify(payload(input)),
  });
}

export function runProtonReplacementSuggestion(input: Input, quoteId: string) {
  return requestJson<Reply>("/api/proton/ai/replacement-suggestion-run", {
    method: "POST", body: JSON.stringify({ ...payload(input), quoteId, confirmed: true }), timeoutMs: 120_000,
  });
}
