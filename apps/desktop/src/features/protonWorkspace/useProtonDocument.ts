import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api/errors";
import * as api from "../../lib/api/protonWorkspace";
import type { HandwrittenNoteContent } from "../../types/domain";
import { checkpointPendingEditorInput } from "../editor/pendingInputCheckpoints";
import type { ProtonDocument, ProtonDocumentKey, ProtonDraft, ProtonNode, ProtonSaveResult } from "../../types/protonWorkspace";

export type OpenedDocument = {
  address: ProtonDocumentKey;
  document: ProtonDocument;
  markdown: string;
  handwritten?: HandwrittenNoteContent;
  draft: ProtonDraft | null;
  uncertain: boolean;
  receipt: "saved" | "observed" | null;
  remoteChanged: boolean;
  needsDraftReload?: boolean;
  editorKey: number;
  ancestorIds: string[];
};

export function relocatedAncestors(ancestorIds: string[], nodeId: string, movedId: string, destination: string[]) {
  if (nodeId === movedId) return destination;
  const index = ancestorIds.indexOf(movedId);
  return index < 0 ? ancestorIds : [...destination, ...ancestorIds.slice(index)];
}

type Documents = { tabs: OpenedDocument[]; activeId: string | null };
const emptyDocuments: Documents = { tabs: [], activeId: null };

function activeDocument({ tabs, activeId }: Documents) {
  return tabs.find(tab => tab.address.nodeId === activeId) ?? null;
}

export function hasUnprotectedEdits(tab: OpenedDocument) {
  if (tab.handwritten) {
    const protectedNote = tab.draft?.handwritten ?? tab.document.handwritten;
    return tab.handwritten !== protectedNote && JSON.stringify(tab.handwritten) !== JSON.stringify(protectedNote);
  }
  return tab.document.markdown !== null && tab.markdown !== (tab.draft?.markdown ?? tab.document.markdown);
}

export function useProtonDocument(onDraftError: (error: unknown) => void, flushEditor: (key: number) => void) {
  const [documents, setDocuments] = useState(emptyDocuments);
  const current = useRef(emptyDocuments);
  const sequence = useRef(0);
  const latestError = useRef(onDraftError);
  latestError.current = onDraftError;
  const pending = useRef<Promise<void>>(Promise.resolve());

  const updateDocuments = useCallback((next: Documents) => {
    current.current = next;
    setDocuments(next);
  }, []);

  const update = useCallback((next: OpenedDocument) => {
    const { tabs } = current.current;
    const id = next.address.nodeId;
    const index = tabs.findIndex(tab => tab.address.nodeId === id);
    const nextTabs = [...tabs];
    if (index < 0) nextTabs.push(next);
    else nextTabs[index] = next;
    updateDocuments({ tabs: nextTabs, activeId: id });
  }, [updateDocuments]);

  const getCurrent = useCallback(() => activeDocument(current.current), []);
  const clear = useCallback(() => { updateDocuments(emptyDocuments); }, [updateDocuments]);
  const select = useCallback((id: string | null) => {
    const { tabs, activeId } = current.current;
    if (id !== activeId && (id === null || tabs.some(tab => tab.address.nodeId === id))) {
      updateDocuments({ tabs, activeId: id });
    }
  }, [updateDocuments]);

  const close = useCallback((ids: string[]) => {
    const { tabs, activeId } = current.current;
    const remaining = tabs.filter(tab => !ids.includes(tab.address.nodeId));
    if (remaining.length === tabs.length) return;
    if (activeId === null || !ids.includes(activeId)) {
      updateDocuments({ tabs: remaining, activeId });
      return;
    }
    const activeIndex = tabs.findIndex(tab => tab.address.nodeId === activeId);
    const before = tabs.slice(0, activeIndex).filter(tab => !ids.includes(tab.address.nodeId)).length;
    const neighbor = remaining[Math.min(before, remaining.length - 1)];
    updateDocuments({ tabs: remaining, activeId: neighbor?.address.nodeId ?? null });
  }, [updateDocuments]);

  const reorder = useCallback((dragged: string, target: string, placement: "before" | "after") => {
    const { tabs, activeId } = current.current;
    const tab = tabs.find(item => item.address.nodeId === dragged);
    if (!tab || dragged === target) return;
    const remaining = tabs.filter(item => item !== tab);
    const index = remaining.findIndex(item => item.address.nodeId === target);
    if (index < 0) return;
    remaining.splice(index + (placement === "after" ? 1 : 0), 0, tab);
    updateDocuments({ tabs: remaining, activeId });
  }, [updateDocuments]);

  const markRemoteChanged = useCallback(() => {
    const { tabs, activeId } = current.current;
    if (tabs.some(tab => !tab.remoteChanged)) {
      updateDocuments({ tabs: tabs.map(tab => ({ ...tab, remoteChanged: true })), activeId });
    }
  }, [updateDocuments]);

  const open = useCallback((address: ProtonDocumentKey, document: ProtonDocument, ancestorIds?: string[]) => {
    update({
      address, document, editorKey: ++sequence.current,
      ancestorIds: document.ancestorIds ?? ancestorIds ?? current.current.tabs.find(tab => tab.address.nodeId === address.nodeId)?.ancestorIds ?? [],
      markdown: document.draft?.markdown ?? document.markdown ?? "",
      handwritten: document.draft?.handwritten ?? document.handwritten,
      draft: document.draft, uncertain: false, receipt: null, remoteChanged: false,
    });
  }, [update]);

  const updateTreeNode = useCallback((node: ProtonNode, destination?: string[]) => {
    const { tabs, activeId } = current.current;
    updateDocuments({ activeId, tabs: tabs.map(tab => {
      const id = tab.address.nodeId;
      const ancestorIds = destination ? relocatedAncestors(tab.ancestorIds, id, node.nodeId, destination) : tab.ancestorIds;
      if (id === node.nodeId) return { ...tab, ancestorIds, document: { ...tab.document, node } };
      return ancestorIds === tab.ancestorIds ? tab : { ...tab, ancestorIds };
    }) });
  }, [updateDocuments]);

  const edit = useCallback((markdown: string) => {
    const value = getCurrent();
    if (value && !value.needsDraftReload && !value.uncertain && (!value.draft || value.draft.state === "draft") && value.markdown !== markdown) {
      update({ ...value, markdown, receipt: null });
    }
  }, [getCurrent, update]);

  const editHandwritten = useCallback((handwritten: HandwrittenNoteContent) => {
    const value = getCurrent();
    if (value?.handwritten && !value.needsDraftReload && !value.uncertain && (!value.draft || value.draft.state === "draft")) {
      update({ ...value, handwritten, receipt: null });
    }
  }, [getCurrent, update]);

  const acceptHandwrittenAiDraft = useCallback((snapshot: OpenedDocument, draft: ProtonDraft, previousGeneration: number | null) => {
    const latest = getCurrent();
    if (!latest || latest.editorKey !== snapshot.editorKey || !draft.handwritten) return false;
    if ((latest.draft?.generation ?? null) !== previousGeneration || JSON.stringify(latest.handwritten) !== JSON.stringify(snapshot.handwritten)) {
      update({ ...latest, needsDraftReload: true });
      return false;
    }
    update({ ...latest, handwritten: draft.handwritten, draft, receipt: null });
    return true;
  }, [getCurrent, update]);

  const protect = useCallback(() => {
    const requestedKey = getCurrent()?.editorKey;
    const next = pending.current.then(async () => {
      if (requestedKey === undefined || getCurrent()?.editorKey !== requestedKey) return;
      checkpointPendingEditorInput();
      flushEditor(requestedKey);
      const snapshot = getCurrent();
      if (!snapshot || snapshot.editorKey !== requestedKey || !hasUnprotectedEdits(snapshot)) return;
      const draft = await api.writeDraft(snapshot.address, {
        documentName: snapshot.document.node.name,
        baseRevisionId: snapshot.draft?.baseRevisionId ?? snapshot.document.revisionId,
        expectedGeneration: snapshot.draft?.generation ?? null,
        ...(snapshot.handwritten ? { handwritten: snapshot.handwritten } : { markdown: snapshot.markdown }),
      });
      const latest = getCurrent();
      if (latest?.editorKey === requestedKey) update({ ...latest, draft,
        handwritten: latest.handwritten === snapshot.handwritten ? draft.handwritten ?? latest.handwritten : latest.handwritten });
    });
    pending.current = next.catch(() => { /* Preserve order and allow a manual retry. */ });
    return next;
  }, [flushEditor, getCurrent, update]);

  // Only the active editor has an unprotected buffer.
  const opened = activeDocument(documents);
  const edited = opened !== null && hasUnprotectedEdits(opened);
  useEffect(() => {
    if (!edited) return;
    const timer = setTimeout(() => { void protect().catch(error => latestError.current(error)); }, 250);
    return () => clearTimeout(timer);
  }, [edited, opened?.editorKey, opened?.markdown, opened?.handwritten, protect]);

  useEffect(() => {
    function protectInBackground() {
      if (document.visibilityState === "hidden") void protect().catch(error => latestError.current(error));
    }
    document.addEventListener("visibilitychange", protectInBackground);
    return () => document.removeEventListener("visibilitychange", protectInBackground);
  }, [protect]);

  const applyResult = useCallback((snapshot: OpenedDocument, result: ProtonSaveResult) => {
    const latest = getCurrent();
    if (latest?.editorKey !== snapshot.editorKey) return;
    const proved = (result.state === "saved" || result.state === "observed") && !!result.revisionId;
    update({
      ...latest,
      document: proved ? { ...snapshot.document,
        ...(snapshot.handwritten ? { handwritten: snapshot.draft?.handwritten ?? snapshot.handwritten }
          : { markdown: snapshot.draft?.markdown ?? snapshot.markdown }), revisionId: result.revisionId! } : snapshot.document,
      draft: proved ? result.draft : result.draft ?? snapshot.draft,
      uncertain: result.state === "unknown" || (result.state === "conflict" && !result.draft) || ((result.state === "saved" || result.state === "observed") && !proved),
      receipt: proved ? result.state as "saved" | "observed" : null,
      remoteChanged: !proved && latest.remoteChanged,
    });
  }, [getCurrent, update]);

  const save = useCallback(async () => {
    await protect();
    const snapshot = getCurrent();
    if (!snapshot?.draft || snapshot.needsDraftReload || snapshot.uncertain || snapshot.draft.state !== "draft") return;
    try {
      const result = await api.saveDocument(snapshot.address, snapshot.draft.generation, crypto.randomUUID());
      applyResult(snapshot, result);
    } catch (error) {
      const didNotStart = error instanceof ApiError && (error.operationOutcome === "not-started" || error.operationOutcome === "not-applied");
      const latest = getCurrent();
      if (!didNotStart && latest?.editorKey === snapshot.editorKey) update({ ...latest, uncertain: true });
      throw error;
    }
  }, [applyResult, getCurrent, protect, update]);

  const reconcile = useCallback(async () => {
    const snapshot = getCurrent();
    if (!snapshot?.draft || snapshot.needsDraftReload) return;
    applyResult(snapshot, await api.reconcileDocument(snapshot.address));
  }, [applyResult, getCurrent]);

  const discard = useCallback(async () => {
    const snapshot = getCurrent();
    if (!snapshot?.draft || snapshot.needsDraftReload) return;
    await api.discardDraft(snapshot.address, snapshot.draft.generation);
    // Never replace a discarded draft with a stale view of the remote revision.
    try {
      open(snapshot.address, await api.readDocument(snapshot.address));
    } catch (error) {
      close([snapshot.address.nodeId]);
      throw error;
    }
  }, [close, getCurrent, open]);

  const refreshPreparedDrafts = useCallback(async (nodeIds: string[]) => {
    const affected = current.current.tabs.filter(tab => nodeIds.includes(tab.address.nodeId));
    if (affected.length === 0) return true;
    const requested = new Set(affected.map(tab => tab.editorKey));
    const results = await Promise.allSettled(affected.map(async tab => ({
      editorKey: tab.editorKey,
      snapshot: await api.readDocument(tab.address),
    })));
    const refreshed = new Map(results.flatMap(result => result.status === "fulfilled"
      ? [[result.value.editorKey, result.value.snapshot] as const] : []));
    const { tabs, activeId } = current.current;
    updateDocuments({ activeId, tabs: tabs.map(tab => {
      const snapshot = refreshed.get(tab.editorKey);
      if (!requested.has(tab.editorKey) || hasUnprotectedEdits(tab)) return tab;
      if (!snapshot) return { ...tab, needsDraftReload: true };
      return {
        ...tab,
        document: snapshot,
        draft: snapshot.draft,
        markdown: snapshot.draft?.markdown ?? snapshot.markdown ?? "",
        handwritten: snapshot.draft?.handwritten ?? snapshot.handwritten,
        editorKey: ++sequence.current,
        uncertain: false,
        receipt: null,
        remoteChanged: false,
        needsDraftReload: false,
      };
    }) });
    return results.every(result => result.status === "fulfilled");
  }, [updateDocuments]);

  return { opened, tabs: documents.tabs, edited, editHandwritten, acceptHandwrittenAiDraft, getCurrent, clear, select, close, reorder, markRemoteChanged, open, updateTreeNode, edit, protect, save, reconcile, discard, refreshPreparedDrafts };
}
