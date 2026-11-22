import { requestJson } from "./client";
import { invokeManagedNative } from "./nativeClient";
import type { MobileExportReceipt } from "../../types/exports";
import type { ProtonDocument, ProtonDocumentKey } from "../../types/protonWorkspace";
import type { HandwrittenNoteContent } from "../../types/domain";

export type RecoveryKind = "draft" | "local-original" | "remote-original";

export type ProtonRecoveryEntry = {
  key: ProtonDocumentKey;
  rootName: string;
  documentName: string;
  generation: number;
  kind: RecoveryKind;
  state: "draft" | "conflict" | "unknown" | "copy";
};

export type ProtonRecoverySnapshot = { markdown: string; fileName: string; handwritten?: HandwrittenNoteContent | null };

export type ProtonConflictReview = {
  handwritten?: boolean;
  name: string;
  remoteRevisionId: string;
  remoteMarkdown: string;
  draftGeneration: number;
  draftMarkdown: string;
};

export function recoveryEntryId(entry: ProtonRecoveryEntry) {
  return JSON.stringify([entry.key.accountId, entry.key.rootId, entry.key.nodeId, entry.generation, entry.kind]);
}

function target(entry: ProtonRecoveryEntry) {
  return { ...entry.key, generation: entry.generation, kind: entry.kind };
}

function post<T>(action: string, body: object, signal?: AbortSignal) {
  return requestJson<T>(`/api/proton/workspace/${action}`, {
    method: "POST", body: JSON.stringify(body), signal, timeoutMs: 60_000,
  });
}

export const listProtonRecovery = (cursor: string | null, signal?: AbortSignal) =>
  post<{ entries: ProtonRecoveryEntry[]; nextCursor: string | null; partial: boolean }>("recovery-list", { cursor }, signal);

export const readProtonRecovery = (entry: ProtonRecoveryEntry, signal?: AbortSignal) =>
  post<ProtonRecoverySnapshot>("recovery-read", target(entry), signal);

export const removeProtonRecoveryCopies = (entry: ProtonRecoveryEntry) =>
  post<{ removed: true }>("recovery-remove-copy", { ...target(entry), kind: "local-original", confirmed: true });

export const reviewProtonConflict = (address: ProtonDocumentKey, signal?: AbortSignal) =>
  post<ProtonConflictReview>("conflict-review", address, signal);

export type ProtonNoteMergePlan = {
  general: "local" | "remote";
  choices: Array<{ pageId: string; choice: "local" | "remote" | "both" }>;
};

export const resolveProtonConflict = (address: ProtonDocumentKey, review: ProtonConflictReview, markdown: string, handwrittenMerge?: ProtonNoteMergePlan) =>
  post<ProtonDocument>("conflict-resolve", {
    ...address, draftGeneration: review.draftGeneration, remoteRevisionId: review.remoteRevisionId, markdown, handwrittenMerge,
  });

export function exportProtonRecovery(entry: ProtonRecoveryEntry, outputPath: string) {
  return requestJson<{ outputPath: string }>("/api/proton/export", {
    method: "POST",
    body: JSON.stringify({ format: "md", recovery: target(entry), outputPath }),
    timeoutMs: 180_000,
  });
}

export function exportProtonRecoveryToMobile(entry: ProtonRecoveryEntry) {
  return invokeManagedNative<MobileExportReceipt>("export_document_mobile", {
    request: { method: "POST", path: "/api/proton/export/content", body: { format: "md", recovery: target(entry) } },
  });
}
