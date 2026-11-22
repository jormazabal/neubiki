import { requestJson } from "./client";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";

export type ProtonNotePageRender = {
  sourceName: string; sourceNodeId: string; sourceRevisionId: string;
  pageId: string; pageNumber: number; sourceRelativePath: string; contentBase64: string;
};

export function renderProtonNotePage(target: ProtonDocumentKey, baseRevisionId: string,
  source: {nodeId:string;revisionId:string;pageId:string}) {
  return requestJson<ProtonNotePageRender>("/api/proton/workspace/note-page-render", {
    method:"POST",body:JSON.stringify({...target,baseRevisionId,sourceNodeId:source.nodeId,sourceRevisionId:source.revisionId,pageId:source.pageId}),timeoutMs:120_000,
  });
}
