import { requestJson } from "./client";
import { invokeManagedNative } from "./nativeClient";
import type { ProtonPackage } from "../../types/protonPackage";
import type { ProtonBatchScope } from "../../types/protonExportBatch";
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validateProtonPackage(value: ProtonPackage, scope: ProtonBatchScope, id?: string) {
  const source = value?.sourceMetadata, manifest = source?.manifest;
  if (value?.schemaVersion !== 1 || !Number.isFinite(Date.parse(value.checkedAt)) || !value.id.startsWith("export-batch-") || id && value.id !== id
    || !hash(value.revision) || !hash(value.archiveSha256) || !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes < 1 || value.archiveBytes > 512 * 1024 ** 2
    || value.format !== "project" || value.frozen !== true || value.includesConfirmedDrafts !== false || source?.kind !== "proton-project-package"
    || source.includesPrivateDrafts !== false || source.accountId !== scope.accountId || source.rootId !== scope.rootId
    || !["prepared", "picking", "saved", "cancelled", "uncertain", "discarded"].includes(value.phase)
    || manifest?.format !== "neubiki.project" || manifest.schemaVersion !== 1 || manifest.supplement || !Array.isArray(manifest.files) || manifest.files.length > 32
    || !Array.isArray(manifest.directories) || manifest.directories.length > 32 || !Array.isArray(manifest.exclusions) || manifest.exclusions.length > 64
    || !Array.isArray(value.documents) || value.documents.length !== manifest.files.length
    || value.documents.some(row => !hash(row.sha256) || !row.filename || !Number.isSafeInteger(row.bytes) || row.bytes < 0)) throw Error("La copia no corresponde al proyecto revisado.");
  return value;
}
export async function prepareProtonPackage(scope: ProtonBatchScope) {
  return validateProtonPackage(await requestJson<ProtonPackage>("/api/proton/packages/prepare", { method: "POST", timeoutMs: 240_000, body: JSON.stringify(scope) }), scope);
}
export async function getProtonPackages(scope: ProtonBatchScope, signal?: AbortSignal) {
  const value = await requestJson<{ schemaVersion: 1; items: ProtonPackage[]; checkedAt: string }>("/api/proton/packages/catalog", { method: "POST", body: JSON.stringify(scope), signal });
  if (value?.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > 2048) throw Error("No se pudieron revisar las copias conservadas.");
  return value.items.map(item => validateProtonPackage(item, scope));
}
export async function checkProtonPackage(scope: ProtonBatchScope, id: string) {
  return validateProtonPackage(await requestJson<ProtonPackage>(`/api/export-batches/${encodeURIComponent(id)}`), scope, id);
}
export async function deliverProtonPackage(scope: ProtonBatchScope, value: ProtonPackage) {
  const next = validateProtonPackage(await invokeManagedNative<ProtonPackage>("export_document_batch", { id: value.id, revision: value.revision }), scope, value.id);
  if (next.revision !== value.revision) throw Error("La copia cambió; comprueba el resultado antes de repetir.");
  return next;
}
export async function discardProtonPackage(scope: ProtonBatchScope, value: ProtonPackage) {
  return validateProtonPackage(await requestJson<ProtonPackage>(`/api/export-batches/${encodeURIComponent(value.id)}`, { method: "DELETE", body: JSON.stringify({ revision: value.revision, acknowledge: true }) }), scope, value.id);
}
