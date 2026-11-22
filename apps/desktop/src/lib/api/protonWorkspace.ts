import { requestFormData, requestJson } from "./client";
import type { ProtonAsset, ProtonDocument, ProtonDocumentKey, ProtonDraft, ProtonEvents, ProtonNode, ProtonSaveResult, ProtonTreeEdit, ProtonTreeEditResult, ProtonWorkspace } from "../../types/protonWorkspace";

function post<T>(action: string, body: object, signal?: AbortSignal) {
  return requestJson<T>(`/api/proton/workspace/${action}`, { method: "POST", body: JSON.stringify(body), signal, timeoutMs: 60_000 });
}

export const currentWorkspace = (signal?: AbortSignal) => post<ProtonWorkspace | null>("current", {}, signal);
export const readDriveRoot = (accountId: string) => post<{ root: ProtonNode }>("root", { accountId });
export const listDriveFolder = (accountId: string, parentId: string, rootId?: string, signal?: AbortSignal) =>
  post<{ items: ProtonNode[] }>("list", { accountId, parentId, rootId }, signal);
export const selectDriveFolder = (accountId: string, rootId: string) => post<ProtonWorkspace>("select", { accountId, rootId });
export const readDocument = (document: ProtonDocumentKey, signal?: AbortSignal) => post<ProtonDocument>("read", document, signal);
export const readAsset = (document: ProtonDocumentKey, relativePath: string, signal?: AbortSignal) =>
  post<ProtonAsset>("asset", { ...document, relativePath }, signal);
export const getWorkspaceEvents = (accountId: string, rootId: string, cursor: string | null, signal?: AbortSignal) =>
  post<ProtonEvents>("events", { accountId, rootId, cursor }, signal);
export const writeDraft = (document: ProtonDocumentKey, draft: { documentName?: string; baseRevisionId: string; markdown?: string; handwritten?: import("../../types/domain").HandwrittenNoteContent; expectedGeneration: number | null }) =>
  post<ProtonDraft>("draft", { ...document, ...draft });
export const saveDocument = (document: ProtonDocumentKey, generation: number, operationId: string) =>
  post<ProtonSaveResult>("save", { ...document, generation, operationId });
export const reconcileDocument = (document: ProtonDocumentKey) => post<ProtonSaveResult>("reconcile", document);
export const discardDraft = (document: ProtonDocumentKey, generation: number) =>
  post<{ discarded: true }>("discard", { ...document, generation });
export const editTree = (accountId: string, rootId: string, edit: ProtonTreeEdit) =>
  post<ProtonTreeEditResult>("tree-edit", { accountId, rootId, ...edit });

export const maxProtonImportFileBytes = 8 * 1024 * 1024;

export function importProtonFile(accountId: string, rootId: string, parentId: string, file: File) {
  if (file.size > maxProtonImportFileBytes) throw new Error(`«${file.name}» supera los 8 MiB.`);
  const data = new FormData();
  data.append("file", file);
  return requestFormData<{ node: ProtonNode }>("/api/proton/workspace/import-file", data, {
    body: JSON.stringify({ accountId, rootId, parentId }), timeoutMs: 240_000,
  });
}
