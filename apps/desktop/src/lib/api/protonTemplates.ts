import { requestJson } from "./client";
import { importProtonFile } from "./protonWorkspace";
import type { ProtonNode } from "../../types/protonWorkspace";

export type ProtonTemplatePreview = { name: string; markdown: string; templateId: string; revision: string; previewDigest?: string; resources?: import("../../types/documentTemplates").DocumentTemplateResourceSummary[] };
export type ProtonTemplateInput = {
  accountId: string; rootId: string; templateId: string; revision: string;
  name: string; values: Record<string, string>; localDate: string;
};

export function previewProtonTemplate(input: ProtonTemplateInput, signal?: AbortSignal) {
  return requestJson<ProtonTemplatePreview>("/api/proton/templates/preview", {
    method: "POST", body: JSON.stringify(input), signal,
  });
}

export async function createProtonTemplateDocument(
  accountId: string, rootId: string, parentId: string, preview: ProtonTemplatePreview,
): Promise<ProtonNode> {
  if (preview.resources?.length) throw new Error("Las plantillas con adjuntos requieren una carpeta nueva revisada.");
  const file = new File([preview.markdown], preview.name, { type: "text/markdown" });
  const result = await importProtonFile(accountId, rootId, parentId, file);
  if (result.node?.name !== preview.name || result.node.type !== "file") {
    throw new Error("No se pudo confirmar el documento creado. Comprueba la carpeta antes de repetir.");
  }
  return result.node;
}

export async function prepareProtonTemplatePackage(input: ProtonTemplateInput, preview: ProtonTemplatePreview) {
  if (!preview.resources?.length || !preview.previewDigest) throw new Error("Vuelve a revisar la plantilla con sus adjuntos.");
  const value = await requestJson<import("../../types/projectTransfer").ProjectTransferJob>("/api/proton/templates/package", {
    method: "POST", timeoutMs: 240_000, body: JSON.stringify({ ...input, previewDigest: preview.previewDigest }),
  });
  if (value?.kind !== "import" || value.phase !== "ready" || !value.id?.startsWith("transfer-") || !value.archiveSha256
    || value.manifest?.schemaVersion !== 1 || value.manifest.supplement || !value.manifest.files.some(file => file.path === preview.name && file.sha256 === preview.previewDigest)) {
    throw new Error("La carpeta preparada no coincide con la plantilla revisada. Consulta las copias portables antes de repetir.");
  }
  return value;
}
