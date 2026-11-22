import { requestJson } from "./client";
import type { ProtonTemplateCapturePreview, ProtonTemplateCaptureReceipt, ProtonTemplateCaptureRequest, ProtonTemplateCaptureSource } from "../../types/protonTemplateCapture";
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const newProtonTemplateCaptureOperationId = () => `template-capture-${crypto.randomUUID()}`;
export function validateProtonTemplateCapture(value: ProtonTemplateCapturePreview, source: ProtonTemplateCaptureSource) {
  if (value?.schemaVersion !== 1 || !Number.isFinite(Date.parse(value.checkedAt)) || !hash(value.digest) || !value.source?.name
    || value.source.accountId !== source.accountId || value.source.rootId !== source.rootId || value.source.nodeId !== source.nodeId || value.source.revisionId !== source.revisionId
    || value.privateDraftsIncluded !== false || value.complete !== true || typeof value.markdown !== "string" || new TextEncoder().encode(value.markdown).byteLength > 1024 ** 2
    || !Array.isArray(value.resources) || value.resources.length > 24 || value.resources.some(resource => !["image", "attachment"].includes(resource.kind)
      || !Number.isSafeInteger(resource.bytes) || resource.bytes < 1 || resource.bytes > (resource.kind === "image" ? 512 * 1024 : 1024 ** 2)
      || !hash(resource.sha256) || typeof resource.embedded !== "boolean" || typeof resource.mimeType !== "string")) throw Error("La revisión de captura no coincide con el documento guardado.");
  return value;
}
function receipt(value: ProtonTemplateCaptureReceipt, request: ProtonTemplateCaptureRequest) {
  if (value?.schemaVersion !== 1 || !Number.isFinite(Date.parse(value.checkedAt)) || value.operationId !== request.operationId || value.digest !== request.digest
    || !["saved", "not-recorded", "retired"].includes(value.state) || value.state === "not-recorded" && value.template !== null
    || value.state !== "not-recorded" && (!value.template?.id.startsWith("custom-") || value.template.captureDigest !== request.digest
      || value.template.name !== request.name.trim() || value.template.description !== request.description.trim() || !hash(value.template.revision))) throw Error("La captura requiere consultar de nuevo su resultado.");
  return value;
}
export async function prepareProtonTemplateCapture(source: ProtonTemplateCaptureSource) {
  return validateProtonTemplateCapture(await requestJson<ProtonTemplateCapturePreview>("/api/proton/templates/source/prepare", { method: "POST", timeoutMs: 240_000, body: JSON.stringify(source) }), source);
}
export async function saveProtonTemplateCapture(request: ProtonTemplateCaptureRequest) {
  return receipt(await requestJson<ProtonTemplateCaptureReceipt>("/api/proton/templates/capture", { method: "POST", timeoutMs: 240_000, body: JSON.stringify(request) }), request);
}
export async function checkProtonTemplateCapture(request: ProtonTemplateCaptureRequest) {
  return receipt(await requestJson<ProtonTemplateCaptureReceipt>("/api/proton/templates/capture/check", { method: "POST", timeoutMs: 240_000, body: JSON.stringify(request) }), request);
}
