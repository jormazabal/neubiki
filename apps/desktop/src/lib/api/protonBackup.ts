import { requestJson } from "./client";
import type { ProtonBatchScope } from "../../types/protonExportBatch";

export type ProtonBackupSchedule = {
  intervalDays: 1 | 7 | null;
  revision: string;
  nextDue: number | null;
  lastAttempt: number | null;
  packageId: string | null;
  status: "waiting" | "preparing" | "prepared" | "failed" | null;
};

function request(operation: string, body: object, signal?: AbortSignal) {
  return requestJson<ProtonBackupSchedule | null>(`/api/proton/packages/${operation}`, {
    method: "POST", body: JSON.stringify(body), signal, timeoutMs: 240_000,
  });
}

export const readProtonBackup = (scope: ProtonBatchScope, signal?: AbortSignal) => request("backup-schedule", scope, signal);
export const tickProtonBackup = (scope: ProtonBatchScope, signal: AbortSignal) => request("backup-tick", scope, signal);
export const updateProtonBackup = (scope: ProtonBatchScope, expectedRevision: string, intervalDays: 1 | 7 | null) =>
  request("backup-schedule-update", { ...scope, expectedRevision, intervalDays });
