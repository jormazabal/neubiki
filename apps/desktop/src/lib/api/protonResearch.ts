import { requestJson } from "./client";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";

type ResearchRequest = ProtonDocumentKey & {
  baseRevisionId: string;
  question: string;
  sources?: { nodeId: string; revisionId: string }[];
  retainPublicReport?: boolean;
};
export type ProtonResearchQuote = {
  quoteId: string;
  attemptId: string;
  model: string;
  estimatedEur: number;
  sourceLimit: number;
  synthesis?: boolean;
};
export type ProtonResearchReport = {
  report: string;
  sources: { url: string; title: string }[];
  limited: boolean;
  usageRecorded: boolean;
  synthesis?:string;
  synthesisStatus?:"completed"|"unconfirmed"|"skipped";
  sourceNames?:string[];
  receiptSaved?: boolean;
  publicReportSaved?: boolean;
};
export type ProtonResearchAttempt = {
  attemptId: string;
  startedAt: number;
  webState: "started" | "completed" | "unconfirmed";
  synthesisState: "notRequested" | "waiting" | "started" | "completed" | "unconfirmed" | "skipped";
  webUsageRecorded: boolean | null;
  synthesisUsageRecorded: boolean | null;
  publicReportAvailable: boolean;
  publicReport?: ProtonResearchReport;
};
function payload(input: ResearchRequest) {
  const { accountId, rootId, nodeId, baseRevisionId, question } = input;
  return { accountId, rootId, nodeId, baseRevisionId, question,
    ...(input.sources?.length ? { sources: input.sources.map(({ nodeId, revisionId }) => ({ nodeId, revisionId })) } : {}),
    ...(input.retainPublicReport === true ? { retainPublicReport: true } : {}),
  };
}

export function reviewProtonResearch(input: ResearchRequest) {
  return requestJson<ProtonResearchQuote>("/api/proton/ai/research-review", {
    method: "POST", body: JSON.stringify(payload(input)),
  });
}

export function runProtonResearch(input: ResearchRequest, { quoteId, attemptId }: Pick<ProtonResearchQuote, "quoteId" | "attemptId">) {
  return requestJson<ProtonResearchReport>("/api/proton/ai/research-run", {
    method: "POST", body: JSON.stringify({ ...payload(input), quoteId, attemptId, confirmed: true }), timeoutMs: input.sources?.length ? 240_000 : 120_000,
  });
}

export function checkProtonResearch({ accountId, rootId, nodeId }: ProtonDocumentKey, attemptId?: string) {
  return requestJson<{ attempts: ProtonResearchAttempt[] }>("/api/proton/ai/research-status", {
    method: "POST",
    body: JSON.stringify({ accountId, rootId, nodeId, ...(attemptId ? { attemptId } : {}) }),
  });
}

export function removeProtonResearchReport({ accountId, rootId, nodeId }: ProtonDocumentKey, attemptId: string) {
  return requestJson<{ attempts: ProtonResearchAttempt[] }>("/api/proton/ai/research-report-delete", {
    method: "POST", body: JSON.stringify({ accountId, rootId, nodeId, attemptId, confirmed: true }),
  });
}
