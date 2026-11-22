import type { ProtonAiHistoryEntry, ProtonAiHistorySummary } from "../../types/protonAiHistory";
import { requestJson } from "./client";

const base = "/api/proton/ai/history";
const item = (id: string) => `${base}/${encodeURIComponent(id)}`;

export function listProtonAiHistory(signal: AbortSignal) {
  return requestJson<{ entries: ProtonAiHistorySummary[] }>(base, { signal });
}

export function readProtonAiHistory(id: string, signal: AbortSignal) {
  return requestJson<ProtonAiHistoryEntry>(item(id), { signal });
}

export function deleteProtonAiHistory(id: string) {
  return requestJson<null>(item(id), { method: "DELETE" });
}
