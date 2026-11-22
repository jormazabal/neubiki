import { requestJson } from "./client";
import type { SharedTemplateScope, SharedTemplatePublishReview, SharedTemplateImportReview, SharedTemplateReceipt, SharedTemplateList, SharedTemplatePublishInput, SharedTemplateImportInput, SharedTemplatePublishRequest, SharedTemplateImportRequest, SharedTemplateImportOutcome } from "../../types/protonSharedTemplates";
import type { ProtonNode } from "../../types/protonWorkspace";
const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown): value is string => typeof value === "string";
function invalid(): never { throw Error("El catálogo compartido requiere una nueva revisión de su ámbito y contenido."); }
function scope(value: SharedTemplateScope & { schemaVersion: number; checkedAt: string }, expected: SharedTemplateScope) {
  if (value?.schemaVersion !== 1 || value.accountId !== expected.accountId || value.rootId !== expected.rootId || !Number.isFinite(Date.parse(value.checkedAt))) invalid();
}
function node(value: ProtonNode | null | undefined): value is ProtonNode {
  return Boolean(value && text(value.nodeId) && value.nodeId && text(value.name) && value.name.toLowerCase().endsWith(".neubiki-templates.json") && value.type === "file" && text(value.revisionId) && value.revisionId);
}
function outcomes(value: SharedTemplateImportOutcome[]) {
  if (!Array.isArray(value) || value.length > 32 || value.some(row => !Number.isSafeInteger(row.index) || row.index < 0 || row.index >= 32 || !text(row.name) || !text(row.message)
    || !["new", "existing", "conflict", "blocked", "imported", "observed", "not-recorded", "unconfirmed"].includes(row.status)
    || row.template !== null && (!row.template?.id?.startsWith("custom-") || !text(row.template.name) || !sha(row.template.revision)))) invalid();
}
function review<T extends SharedTemplatePublishReview | SharedTemplateImportReview>(value: T, expected: SharedTemplateScope): T {
  scope(value, expected);
  if (!sha(value.digest) || !sha(value.reviewDigest) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > 8 * 1024 ** 2
    || !Array.isArray(value.catalog) || !value.catalog.length || value.catalog.length > 32 || value.catalog.some((entry, index) => entry.index !== index || !text(entry.name) || !text(entry.description) || !text(entry.markdown)
      || new TextEncoder().encode(entry.markdown).byteLength > 1024 ** 2 || !Array.isArray(entry.variables) || entry.variables.some(variable => !text(variable))
      || entry.resources !== undefined && (!Array.isArray(entry.resources) || entry.resources.length > 8 || entry.resources.some(resource => !text(resource.path) || !text(resource.name) || !text(resource.mimeType) || !sha(resource.sha256) || !Number.isSafeInteger(resource.bytes) || resource.bytes < 1 || resource.bytes > 1024 ** 2)))) invalid();
  return value;
}
function receipt(value: SharedTemplateReceipt, expected: SharedTemplateScope, purpose?: SharedTemplateReceipt["purpose"], operationId?: string) {
  scope(value, expected);
  if (!["publish", "import"].includes(value.purpose) || purpose && purpose !== value.purpose || operationId && operationId !== value.operationId || !text(value.operationId)
    || !value.operationId.startsWith(`template-${value.purpose}-`) || typeof value.active !== "boolean" || !["pending", "confirmed", "observed", "conflict", "complete", "partial", "not-recorded"].includes(value.state)
    || value.digest !== undefined && !sha(value.digest) || value.node != null && !node(value.node) || value.source != null && !node(value.source)) invalid();
  if (value.outcomes != null) outcomes(value.outcomes);
  return value;
}
const post = <T>(action: string, body: unknown) => requestJson<T>(`/api/proton/templates/shared/${action}`, { method: "POST", timeoutMs: 240_000, body: JSON.stringify(body) });
export const newSharedTemplateOperationId = (purpose: "publish" | "import") => `template-${purpose}-${crypto.randomUUID()}`;
export async function listProtonSharedTemplates(input: SharedTemplateScope & { readRemote?: boolean; offset?: number }) {
  const value = await post<SharedTemplateList>("list", input); scope(value, input);
  if (!Array.isArray(value.items) || value.items.length > 200 || value.items.some(item => !node(item)) || typeof value.partial !== "boolean" || !Array.isArray(value.attempts) || value.attempts.length > 20
    || !Number.isSafeInteger(value.offset) || value.offset !== (input.offset ?? 0) || !Number.isSafeInteger(value.totalAttempts) || value.totalAttempts < 0) invalid();
  value.attempts.forEach(item => receipt(item, input)); return value;
}
export async function reviewProtonTemplatePublish(input: SharedTemplatePublishInput) {
  const value = review(await post<SharedTemplatePublishReview>("publish-review", input), input); if (value.name !== input.name.trim()) invalid(); return value;
}
export async function publishProtonTemplates(input: SharedTemplatePublishRequest) {
  const value = receipt(await post<SharedTemplateReceipt>("publish", input), input, "publish", input.operationId); if (value.digest !== input.digest || value.name !== input.name.trim()) invalid(); return value;
}
export async function reviewProtonTemplateImport(input: SharedTemplateImportInput) {
  const value = review(await post<SharedTemplateImportReview>("import-review", input), input);
  if (!node(value.source) || value.source.nodeId !== input.nodeId || value.source.revisionId !== input.revisionId || input.digest && value.digest !== input.digest) invalid();
  outcomes(value.outcomes); if (value.outcomes.length !== input.entries.length) invalid(); return value;
}
export async function importProtonTemplates(input: SharedTemplateImportRequest) {
  const value = receipt(await post<SharedTemplateReceipt>("import", input), input, "import", input.operationId); if (value.digest !== input.digest || value.source?.nodeId !== input.nodeId || value.source.revisionId !== input.revisionId) invalid(); return value;
}
export async function checkProtonSharedTemplates(input: SharedTemplateScope & { purpose: "publish" | "import"; operationId: string }) {
  return receipt(await post<SharedTemplateReceipt>(`${input.purpose}-check`, input), input, input.purpose, input.operationId);
}
