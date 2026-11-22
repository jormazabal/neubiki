import type { ProtonBatchScope } from "./protonExportBatch";
export type ProtonRestore = ProtonBatchScope & {
  schemaVersion: 1; parentId?: string; parentName?: string | null; revision: string; transferId: string; archiveSha256: string; name: string;
  phase: "reviewed" | "running" | "interrupted" | "uncertain" | "cancelled" | "complete";
  entries: Array<{ path: string; name: string; kind: "folder" | "file"; status: "planned" | "pending" | "confirmed" | "observed";
    nodeId: string | null; revisionId: string | null; parentId: string | null; bytes: number; sha256: string | null; detail: string | null }>;
  checkedAt: string; cancelRequested?: boolean; rootNodeId?: string | null;
};
