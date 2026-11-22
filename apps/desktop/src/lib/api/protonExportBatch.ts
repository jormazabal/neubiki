import { requestJson } from "./client";
import { invokeManagedNative } from "./nativeClient";
import type { ProtonBatchPreparation, ProtonBatchResult, ProtonBatchScope, ProtonExportBatch } from "../../types/protonExportBatch";
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const stamp = (value: { schemaVersion: number; checkedAt: string }) => value?.schemaVersion === 1 && Number.isFinite(Date.parse(value.checkedAt));
function results(value: ProtonBatchResult[]) {
  if (!Array.isArray(value) || !value.length || value.length > 32 || value.some(item => !item.nodeId || !item.revisionId || !item.name
    || !["included", "omitted"].includes(item.status) || item.status === "omitted" && typeof item.detail !== "string")) throw Error("No se pudieron verificar los resultados del lote.");
}
export function validateProtonExportBatch(value: ProtonExportBatch, scope: ProtonBatchScope, id?: string) {
  const source = value?.sourceMetadata;
  if (!stamp(value) || !value.id.startsWith("export-batch-") || id && value.id !== id || !hash(value.revision) || !hash(value.archiveSha256)
    || !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes < 1 || value.archiveBytes > 512 * 1024 ** 2
    || value.frozen !== true || value.includesConfirmedDrafts !== false || source?.kind !== "proton-saved-revisions"
    || source.includesPrivateDrafts !== false || source.accountId !== scope.accountId || source.rootId !== scope.rootId
    || !["prepared", "picking", "saved", "cancelled", "uncertain", "discarded"].includes(value.phase)
    || !["pdf", "docx", "md"].includes(value.format) || !Array.isArray(value.documents) || !value.documents.length || value.documents.length > 32
    || value.documents.some(row => !row.filename || !hash(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 0)) throw Error("El lote no corresponde a la carpeta revisada.");
  results(source.results);
  if (source.results.filter(row => row.status === "included").length !== value.documents.length) throw Error("Los resultados del lote no coinciden con sus archivos.");
  return value;
}
export async function getProtonExportBatches(scope: ProtonBatchScope, signal?: AbortSignal) {
  const value = await requestJson<{ schemaVersion: 1; items: ProtonExportBatch[]; checkedAt: string }>("/api/proton/export-batches/catalog", { method: "POST", body: JSON.stringify(scope), signal });
  if (!stamp(value) || !Array.isArray(value.items) || value.items.length > 2048) throw Error("No se pudieron revisar los lotes conservados.");
  return value.items.map(item => validateProtonExportBatch(item, scope));
}
export async function prepareProtonExportBatch(scope: ProtonBatchScope, documents: Array<{ nodeId: string; revisionId: string; name?: string; diagramAssets?: unknown }>, format: string, profile?: { id: string; revision: string; source?: "device" | "project" }) {
  const value = await requestJson<ProtonBatchPreparation>("/api/proton/export-batches/prepare", { method: "POST", timeoutMs: 240_000,
    body: JSON.stringify({ ...scope, documents, format, ...(profile ? { profileId: profile.id, profileRevision: profile.revision, ...(profile.source ? { profileSource: profile.source } : {}) } : {}) }) });
  if (!stamp(value)) throw Error("La preparación requiere comprobar su resultado.");
  results(value.results);
  if (value.batch) validateProtonExportBatch(value.batch, scope);
  return value;
}
export async function checkProtonExportBatch(scope: ProtonBatchScope, id: string) {
  return validateProtonExportBatch(await requestJson<ProtonExportBatch>(`/api/export-batches/${encodeURIComponent(id)}`), scope, id);
}
export async function deliverProtonExportBatch(scope: ProtonBatchScope, value: ProtonExportBatch) {
  const next = validateProtonExportBatch(await invokeManagedNative<ProtonExportBatch>("export_document_batch", { id: value.id, revision: value.revision }), scope, value.id);
  if (next.revision !== value.revision) throw Error("El lote cambió. Comprueba el resultado antes de continuar.");
  return next;
}
export async function discardProtonExportBatch(scope: ProtonBatchScope, value: ProtonExportBatch) {
  const next = validateProtonExportBatch(await requestJson<ProtonExportBatch>(`/api/export-batches/${encodeURIComponent(value.id)}`, { method: "DELETE", body: JSON.stringify({ revision: value.revision, acknowledge: true }) }), scope, value.id);
  if (next.revision !== value.revision) throw Error("El lote cambió. Comprueba el resultado antes de continuar.");
  return next;
}
