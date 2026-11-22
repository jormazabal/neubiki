import type { ProtonDocumentKey } from "./protonWorkspace";
import type { DocumentTemplateSummary } from "./documentTemplates";
export type ProtonTemplateCaptureSource = ProtonDocumentKey & { revisionId: string };
export type ProtonTemplateCapturePreview = {
  schemaVersion: 1; source: ProtonTemplateCaptureSource & { name: string }; digest: string; markdown: string;
  resources: Array<{ kind: "image" | "attachment"; name: string | null; path: string | null; bytes: number; sha256: string; mimeType: string; embedded: boolean; width?: number; height?: number }>;
  privateDraftsIncluded: false; complete: true; checkedAt: string;
};
export type ProtonTemplateCaptureRequest = ProtonTemplateCaptureSource & { operationId: string; digest: string; name: string; description: string; acknowledge: true };
export type ProtonTemplateCaptureReceipt = {
  schemaVersion: 1; operationId: string; digest: string; state: "saved" | "not-recorded" | "retired";
  template: (DocumentTemplateSummary & { captureDigest: string }) | null; checkedAt: string;
};
