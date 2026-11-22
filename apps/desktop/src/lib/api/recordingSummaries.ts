import { requestJson } from "./client";

export type RecordingSummaryProposal = {
  sessionId: string;
  sourceRevision: string;
  skillId: string;
  skillVersion: string;
  mode: string;
  markdown: string;
};

export type SavedRecordingSummary = RecordingSummaryProposal & {
  schemaVersion: 1;
  revision: string;
  savedAt: string;
};

const summaryPath = (id: string) => `/api/proton/meetings/${encodeURIComponent(id)}/summary`;

export function getRecordingSummary(id: string) {
  return requestJson<SavedRecordingSummary | null>(summaryPath(id));
}

export function generateRecordingSummary(id: string, sourceRevision: string, mode: string, guidance: string) {
  return requestJson<RecordingSummaryProposal>(summaryPath(id), {
    method: "POST",
    body: JSON.stringify({ sourceRevision, mode, guidance, confirmed: true }),
    timeoutMs: 120_000,
  });
}

export function saveRecordingSummary(proposal: RecordingSummaryProposal, expectedRevision: string | null) {
  const { sessionId, sourceRevision, skillVersion, mode, markdown } = proposal;
  return requestJson<SavedRecordingSummary>(summaryPath(sessionId), {
    method: "PUT",
    body: JSON.stringify({ sourceRevision, expectedRevision, skillVersion, mode, markdown }),
  });
}
