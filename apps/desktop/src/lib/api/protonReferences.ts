import { requestJson } from "./client";
import type { ProtonDocumentKey, ProtonNode } from "../../types/protonWorkspace";

export type ProtonReference = { target: string; line: number; image: boolean } & (
  | { status: "available"; node: ProtonNode }
  | { status: "external" | "anchor" | "folder" | "missing" | "blocked" | "unverified" }
);

export type ProtonReferenceList = { revisionId: string; references: ProtonReference[]; partial: boolean };
export type ProtonIncomingReferences = {
  revisionId: string;
  references: Array<{ node: ProtonNode; parents: ProtonNode[]; revisionId: string; line: number; target?: string; image?: boolean }>;
  partial: boolean;
  scannedDocuments: number;
  scannedFolders: number;
};

export function listProtonIncomingReferences(address: ProtonDocumentKey, revisionId: string, signal?: AbortSignal) {
  return requestJson<ProtonIncomingReferences>("/api/proton/workspace/incoming-references", {
    method: "POST", body: JSON.stringify({ ...address, revisionId }), signal, timeoutMs: 60_000,
  });
}

export function listProtonReferences(address: ProtonDocumentKey, revisionId: string, signal?: AbortSignal) {
  return requestJson<ProtonReferenceList>("/api/proton/workspace/references", {
    method: "POST", body: JSON.stringify({ ...address, revisionId }), signal, timeoutMs: 60_000,
  });
}
