import { requestJson } from "./client";
import type { ProtonDocumentKey, ProtonNode } from "../../types/protonWorkspace";
import type { ProtonReference, ProtonIncomingReferences } from "./protonReferences";

export type ProtonResourceKind = "markdown" | "handwritten" | "image" | "audio" | "video" | "pdf" | "docx" | "xlsx" | "text" | "other";
export type ProtonResourceCatalog = { resources: { kind: ProtonResourceKind; node: ProtonNode; parents: ProtonNode[] }[]; partial: boolean; scannedFolders: number };
export type ProtonReferenceImpact = Omit<ProtonIncomingReferences, "revisionId"> & {
  revisionId: string | null; node: ProtonNode; action: "rename" | "move";
  outgoing: (Pick<ProtonReference, "target" | "line"> & { sourceName?: string })[];
};
type ReferenceImpactTarget = { parentId: string; expectedName: string; action: "rename" | "move" } &
  ({ revisionId: string; nodeKind?: never } | { nodeKind: "folder"; revisionId?: never });

export function readProtonResourceCatalog(accountId: string, rootId: string, signal?: AbortSignal) {
  return requestJson<ProtonResourceCatalog>("/api/proton/workspace/resource-catalog", {
    method: "POST", body: JSON.stringify({ accountId, rootId }), signal, timeoutMs: 60_000,
  });
}

export function readProtonReferenceImpact(address: ProtonDocumentKey, target: ReferenceImpactTarget, signal?: AbortSignal) {
  return requestJson<ProtonReferenceImpact>("/api/proton/workspace/reference-impact", {
    method: "POST", body: JSON.stringify({ ...address, ...target }), signal, timeoutMs: 60_000,
  });
}
