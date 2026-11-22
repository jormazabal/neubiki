import type { ProtonTextRequest, ProtonTextResult } from "../../types/protonText";
import { requestJson } from "./client";

export function requestProtonText(request: ProtonTextRequest, signal?: AbortSignal) {
  return requestJson<ProtonTextResult>("/api/proton/ai/text", {
    method: "POST",
    body: JSON.stringify(request),
    signal,
    timeoutMs: 120_000,
  });
}
