import { requestJson } from "./client";
import type { ExportProfile } from "../../types/portabilityWorkspace";

export type SharedProfilesScope = { accountId: string; rootId: string };
export type SharedExportProfiles = {
  nodeId: string | null; revisionId: string | null; profiles: ExportProfile[]; operationId: string | null; updatedAt: string | null;
  outcome: "confirmed" | "unknown"; pendingOperationId: string | null; checkedAt: string;
};
function post(scope: SharedProfilesScope, action: string, body: object = {}, signal?: AbortSignal) {
  return requestJson<SharedExportProfiles>(`/api/proton/workspace/${action}`, {
    method: "POST", body: JSON.stringify({ ...scope, ...body }), signal, timeoutMs: 240_000,
  });
}
export const readSharedExportProfiles = (scope: SharedProfilesScope, signal?: AbortSignal) => post(scope, "profiles-read", {}, signal);
export const checkSharedExportProfiles = (scope: SharedProfilesScope) => post(scope, "profiles-check");
export const publishSharedExportProfiles = (scope: SharedProfilesScope, remote: SharedExportProfiles, localRevision: string) =>
  post(scope, "profiles-publish", { metadataNodeId: remote.nodeId, baseRevisionId: remote.revisionId, localRevision });
