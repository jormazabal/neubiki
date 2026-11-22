import { requestFormData, requestJson } from "./client";
import type { ProtonDocumentKey, ProtonDraft } from "../../types/protonWorkspace";
import type { HandwrittenStroke } from "../../types/domain";

export type ProtonNoteAiKind = "ocr" | "drawing" | "transcription";

export type ProtonNoteAiReceipt = {
  attemptId: string;
  pageId: string;
  kind: ProtonNoteAiKind;
  phase: "ready" | "uncertain" | "applied" | "failed" | "unavailable" | "expired";
  message: string;
  createdAt: number;
  expiresAt: number;
  text: string | null;
  sourceDataUrl: string | null;
  strokes: HandwrittenStroke[] | null;
  generatedElements: unknown;
  appliedGeneration: number | null;
};

export type ProtonNoteAiResult = {
  receipt: ProtonNoteAiReceipt;
  draft?: ProtonDraft;
  previousGeneration?: number | null;
};

export function generateProtonNoteAi(kind: ProtonNoteAiKind, address: ProtonDocumentKey, body: {
  attemptId: string; pageId: string; baseRevisionId: string; expectedGeneration: number | null; prompt?: string;
  audio?: File;
}) {
  const { audio, ...payload } = body;
  if (kind === "transcription" && audio) {
    const formData = new FormData();
    formData.append("file", audio);
    return requestFormData<ProtonNoteAiReceipt>(`/api/proton/handwritten/${kind}`, formData, {
      method: "POST", body: JSON.stringify({ ...address, ...payload, confirmed: true }), timeoutMs: 180_000,
    });
  }
  return requestJson<ProtonNoteAiReceipt>(`/api/proton/handwritten/${kind}`, {
    method: "POST", body: JSON.stringify({ ...address, ...payload, confirmed: true }), timeoutMs: 180_000,
  });
}

export function listProtonNoteAi(address: ProtonDocumentKey) {
  return requestJson<{ items: ProtonNoteAiReceipt[] }>("/api/proton/workspace/note-ai-catalog", {
    method: "POST", body: JSON.stringify(address),
  });
}

export function checkProtonNoteAi(address: ProtonDocumentKey, attemptId: string) {
  return requestJson<ProtonNoteAiResult>("/api/proton/workspace/note-ai-check", {
    method: "POST", body: JSON.stringify({ ...address, attemptId }), timeoutMs: 60_000,
  });
}

export function applyProtonNoteAi(address: ProtonDocumentKey, attemptId: string, expectedGeneration: number | null, documentName: string, text?: string) {
  return requestJson<ProtonNoteAiResult>("/api/proton/workspace/note-ai-apply", {
    method: "POST", body: JSON.stringify({ ...address, attemptId, expectedGeneration, documentName, text, confirmed: true }), timeoutMs: 60_000,
  });
}
