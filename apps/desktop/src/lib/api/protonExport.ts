import type { ExportDocumentPayload } from "../../types/domain";
import type { HandwrittenExportFormat, HandwrittenNoteContent } from "../../types/domain";
import type { MobileExportReceipt } from "../../types/exports";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";
import { requestJson } from "./client";
import { invokeManagedNative } from "./nativeClient";

export type ProtonExportPayload = ProtonDocumentKey & Omit<ExportDocumentPayload, "outputPath"> & {
  name: string;
  markdown: string;
  profileId?: string;
  profileRevision?: string;
  profileSource?: "device" | "project";
};

export type ProtonNoteExportPayload = ProtonDocumentKey & {
  name: string;
  format: HandwrittenExportFormat;
  handwritten: HandwrittenNoteContent;
  pageId?: string;
};

export function exportProtonDocument(payload: ProtonExportPayload | ProtonNoteExportPayload, outputPath: string) {
  return requestJson<{ outputPath: string }>("/api/proton/export", {
    method: "POST",
    body: JSON.stringify({ ...payload, outputPath }),
    timeoutMs: 180_000,
  });
}

export function exportProtonDocumentToMobile(payload: ProtonExportPayload | ProtonNoteExportPayload) {
  return invokeManagedNative<MobileExportReceipt>("export_document_mobile", {
    request: { method: "POST", path: "/api/proton/export/content", body: payload },
  });
}
