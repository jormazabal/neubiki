import { requestJson } from "./client";
import type { ProtonNode, ProtonWorkspace } from "../../types/protonWorkspace";

export type ProtonSearchMode = "files" | "content";
export type ProtonSearchFileType = "all" | "markdown" | "handwritten" | "pdf" | "docx" | "xlsx" | "text";
export type ProtonSearchMatch = { node: ProtonNode; parents: ProtonNode[]; line: number | null; excerpt: string | null; pageNumber?: number | null; pageId?: string | null; sheetId?: string | null; row?: number | null; column?: number | null };
export type ProtonSearchResults = {
  results: ProtonSearchMatch[];
  partial: boolean;
  limited: boolean;
  failedReads: number;
  oversizedFiles?: number;
  scannedFolders: number;
  scannedDocuments: number;
  withoutText?: number;
  index?: { mode: "revision-memory" | "revision-device"; reusedDocuments: number; readBytes: number };
};

export function searchProtonWorkspace(workspace: ProtonWorkspace, query: string, mode: ProtonSearchMode, signal: AbortSignal, folderId?: string, fileType?: ProtonSearchFileType) {
  return requestJson<ProtonSearchResults>("/api/proton/workspace/search", {
    method: "POST", signal, timeoutMs: 60_000,
    body: JSON.stringify({ accountId: workspace.accountId, rootId: workspace.root.nodeId, query, mode, folderId, fileType }),
  });
}
