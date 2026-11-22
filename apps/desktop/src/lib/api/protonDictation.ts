import { requestFormData } from "./client";
import type { AiTranscriptionLanguage } from "../../types/domain";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";

export function transcribeProtonDictation(address: ProtonDocumentKey, baseRevisionId: string, file: File,
  language: AiTranscriptionLanguage) {
  const form = new FormData();
  form.append("file", file);
  return requestFormData<{ transcript: string; model: string; durationSeconds: number; usageRecorded: boolean }>(
    "/api/proton/ai/dictation", form,
    { method: "POST", body: JSON.stringify({ ...address, baseRevisionId, language, confirmed: true }), timeoutMs: 120_000 },
  );
}
