import { requestJson } from "./client";
import type { ProtonAsset, ProtonDocument, ProtonDocumentKey, ProtonDraft, ProtonEvents, ProtonNode, ProtonSaveResult, ProtonWorkspace } from "../../types/protonWorkspace";

function post<T>(action: string, body: object, signal?: AbortSignal) {
  return requestJson<T>(`/api/proton/workspace/${action}`, { method: "POST", body: JSON.stringify(body), signal, timeoutMs: 60_000 });
}

export const currentWorkspace = (signal?: AbortSignal) => post<ProtonWorkspace | null>("current", {}, signal);
export const readDriveRoot = (accountId: string) => post<{ root: ProtonNode }>("root", { accountId });
export const listDriveFolder = (accountId: string, parentId: string, rootId?: string, signal?: AbortSignal) =>
  post<{ items: ProtonNode[] }>("list", { accountId, parentId, rootId }, signal);
export const selectDriveFolder = (accountId: string, rootId: string) => post<ProtonWorkspace>("select", { accountId, rootId });
export const readDocument = (document: ProtonDocumentKey) => post<ProtonDocument>("read", document);
export const readAsset = (document: ProtonDocumentKey, relativePath: string, signal?: AbortSignal) =>
  post<ProtonAsset>("asset", { ...document, relativePath }, signal);
export const getWorkspaceEvents = (accountId: string, rootId: string, cursor: string | null, signal?: AbortSignal) =>
  post<ProtonEvents>("events", { accountId, rootId, cursor }, signal);
export const writeDraft = (document: ProtonDocumentKey, draft: { baseRevisionId: string; markdown: string; expectedGeneration: number | null }) =>
  post<ProtonDraft>("draft", { ...document, ...draft });
export const saveDocument = (document: ProtonDocumentKey, generation: number, operationId: string) =>
  post<ProtonSaveResult>("save", { ...document, generation, operationId });
export const reconcileDocument = (document: ProtonDocumentKey) => post<ProtonSaveResult>("reconcile", document);
export const discardDraft = (document: ProtonDocumentKey, generation: number) =>
  post<{ discarded: true }>("discard", { ...document, generation });
