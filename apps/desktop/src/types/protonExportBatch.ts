import type { ProtonDocumentKey } from "./protonWorkspace";
export type ProtonBatchScope = Pick<ProtonDocumentKey, "accountId" | "rootId">;
export type ProtonBatchResult = { nodeId: string; revisionId: string; name: string; status: "included" | "omitted"; detail?: string };
export type ProtonExportBatch = {
  schemaVersion: 1; id: string; projectId: string; revision: string;
  phase: "prepared" | "picking" | "saved" | "cancelled" | "uncertain" | "discarded";
  format: "pdf" | "docx" | "md"; profileName: string | null;
  documents: Array<{ source: string; filename: string; bytes: number; sha256: string }>;
  archiveSha256: string; archiveBytes: number; checkedAt: string; frozen: true; includesConfirmedDrafts: false;
  sourceMetadata: ProtonBatchScope & { kind: "proton-saved-revisions"; includesPrivateDrafts: false; results: ProtonBatchResult[] };
};
export type ProtonBatchPreparation = { schemaVersion: 1; batch: ProtonExportBatch | null; results: ProtonBatchResult[]; checkedAt: string };
