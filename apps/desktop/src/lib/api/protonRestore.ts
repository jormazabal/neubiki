import { requestJson } from "./client";
import type { ProtonRestore } from "../../types/protonRestore";
import type { ProtonBatchScope } from "../../types/protonExportBatch";
import type { ProjectTransferJob } from "../../types/projectTransfer";
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validateProtonRestore(value: ProtonRestore, scope: ProtonBatchScope, source?: ProjectTransferJob) {
  if (value?.schemaVersion !== 1 || !hash(value.revision) || !hash(value.archiveSha256) || !Number.isFinite(Date.parse(value.checkedAt))
    || value.accountId !== scope.accountId || value.rootId !== scope.rootId || !value.transferId?.startsWith("transfer-") || !value.name
    || source && (value.transferId !== source.id || value.archiveSha256 !== source.archiveSha256)
    || !["reviewed", "running", "interrupted", "uncertain", "cancelled", "complete"].includes(value.phase)
    || !Array.isArray(value.entries) || !value.entries.length || value.entries.length > 65
    || value.entries.some(entry => !["folder", "file"].includes(entry.kind) || !["planned", "pending", "confirmed", "observed"].includes(entry.status)
      || typeof entry.path !== "string" || !entry.name || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.kind === "file" && !hash(entry.sha256))
    || value.phase === "complete" && value.entries.some(entry => !["confirmed", "observed"].includes(entry.status))) throw Error("La restauración no corresponde al paquete y destino revisados.");
  return value;
}
function identity(scope: ProtonBatchScope, source: ProjectTransferJob) {
  if (!source.archiveSha256) throw Error("El paquete todavía no está verificado.");
  return { ...scope, transferId: source.id, archiveSha256: source.archiveSha256 };
}
export async function getProtonRestore(scope: ProtonBatchScope, source: ProjectTransferJob) {
  const value = await requestJson<ProtonRestore | null>("/api/proton/packages/restore/status", { method: "POST", body: JSON.stringify(identity(scope, source)) });
  return value ? validateProtonRestore(value, scope, source) : null;
}
export async function reviewProtonRestore(scope: ProtonBatchScope, source: ProjectTransferJob, name: string, parentId?: string) {
  return validateProtonRestore(await requestJson<ProtonRestore>("/api/proton/packages/restore/review", { method: "POST", timeoutMs: 240_000,
    body: JSON.stringify({ ...identity(scope, source), name, ...(parentId ? { parentId } : {}) }) }), scope, source);
}
export async function actOnProtonRestore(scope: ProtonBatchScope, source: ProjectTransferJob, value: ProtonRestore, action: "apply" | "check" | "cancel") {
  const next = validateProtonRestore(await requestJson<ProtonRestore>(`/api/proton/packages/restore/${action}`, { method: "POST", timeoutMs: 240_000,
    body: JSON.stringify({ ...identity(scope, source), revision: value.revision, ...(action === "apply" ? { acknowledge: true } : {}) }) }), scope, source);
  if (next.revision !== value.revision) throw Error("La restauración cambió. Consulta su resultado antes de continuar.");
  return next;
}
export async function getProtonRestoreHistory(scope: ProtonBatchScope) {
  const value = await requestJson<{ schemaVersion: 1; accountId: string; rootId: string; items: ProtonRestore[] }>("/api/proton/packages/restore/history", { method: "POST", body: JSON.stringify(scope) });
  if (value?.schemaVersion !== 1 || value.accountId !== scope.accountId || value.rootId !== scope.rootId || !Array.isArray(value.items) || value.items.length > 2048) throw Error("Los resultados conservados no se pudieron verificar.");
  return value.items.map(item => validateProtonRestore(item, scope));
}
