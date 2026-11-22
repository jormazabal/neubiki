import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api/errors";
import * as api from "../../lib/api/protonWorkspace";
import type { ProtonDocument, ProtonDocumentKey, ProtonDraft, ProtonSaveResult } from "../../types/protonWorkspace";

export type OpenedDocument = {
  address: ProtonDocumentKey;
  document: ProtonDocument;
  markdown: string;
  draft: ProtonDraft | null;
  uncertain: boolean;
  receipt: "saved" | "observed" | null;
  editorKey: number;
};

export function useProtonDocument(onDraftError: (error: unknown) => void, flushEditor: (key: number) => void) {
  const [opened, setOpened] = useState<OpenedDocument | null>(null);
  const current = useRef<OpenedDocument | null>(null);
  const sequence = useRef(0);
  const latestError = useRef(onDraftError);
  latestError.current = onDraftError;
  const pending = useRef<Promise<void>>(Promise.resolve());

  const update = useCallback((next: OpenedDocument | null) => {
    current.current = next;
    setOpened(next);
  }, []);

  const getCurrent = useCallback(() => current.current, []);

  const clear = useCallback(() => { update(null); }, [update]);

  const open = useCallback((address: ProtonDocumentKey, document: ProtonDocument) => {
    update({
      address, document, editorKey: ++sequence.current,
      markdown: document.draft?.markdown ?? document.markdown ?? "",
      draft: document.draft, uncertain: false, receipt: null,
    });
  }, [update]);

  const edit = useCallback((markdown: string) => {
    const value = current.current;
    if (value && !value.uncertain && (!value.draft || value.draft.state === "draft") && value.markdown !== markdown) {
      update({ ...value, markdown, receipt: null });
    }
  }, [update]);

  const protect = useCallback(() => {
    const requestedKey = current.current?.editorKey;
    const next = pending.current.then(async () => {
      if (requestedKey === undefined || current.current?.editorKey !== requestedKey) return;
      flushEditor(requestedKey);
      const snapshot = current.current;
      if (!snapshot || snapshot.editorKey !== requestedKey || snapshot.document.markdown === null) return;
      if (snapshot.markdown === (snapshot.draft?.markdown ?? snapshot.document.markdown)) return;
      const draft = await api.writeDraft(snapshot.address, {
        baseRevisionId: snapshot.draft?.baseRevisionId ?? snapshot.document.revisionId,
        expectedGeneration: snapshot.draft?.generation ?? null,
        markdown: snapshot.markdown,
      });
      if (current.current?.editorKey === requestedKey) update({ ...current.current, draft });
    });
    pending.current = next.catch(() => { /* Preserve order and allow a manual retry. */ });
    return next;
  }, [flushEditor, update]);

  // Persist local drafts promptly and serialize responses against the generation
  // that actually reached Rust. No timers initiate remote writes.
  const edited = Boolean(opened && opened.document.markdown !== null && opened.markdown !== (opened.draft?.markdown ?? opened.document.markdown));
  useEffect(() => {
    if (!edited) return;
    const timer = setTimeout(() => { void protect().catch(error => latestError.current(error)); }, 250);
    return () => clearTimeout(timer);
  }, [edited, opened?.markdown, protect]);

  useEffect(() => {
    function protectInBackground() {
      if (document.visibilityState === "hidden") void protect().catch(error => latestError.current(error));
    }
    document.addEventListener("visibilitychange", protectInBackground);
    return () => document.removeEventListener("visibilitychange", protectInBackground);
  }, [protect]);

  const applyResult = useCallback((snapshot: OpenedDocument, result: ProtonSaveResult) => {
    if (current.current?.editorKey !== snapshot.editorKey) return;
    const proved = (result.state === "saved" || result.state === "observed") && !!result.revisionId;
    update({
      ...current.current,
      document: proved ? { ...snapshot.document, markdown: snapshot.draft?.markdown ?? snapshot.markdown, revisionId: result.revisionId! } : snapshot.document,
      draft: proved ? result.draft : result.draft ?? snapshot.draft,
      uncertain: result.state === "unknown" || (result.state === "conflict" && !result.draft) || ((result.state === "saved" || result.state === "observed") && !proved),
      receipt: proved ? result.state as "saved" | "observed" : null,
    });
  }, [update]);

  const save = useCallback(async () => {
    await protect();
    const snapshot = current.current;
    if (!snapshot?.draft || snapshot.uncertain || snapshot.draft.state !== "draft") return;
    try {
      const result = await api.saveDocument(snapshot.address, snapshot.draft.generation, crypto.randomUUID());
      applyResult(snapshot, result);
    } catch (error) {
      const didNotStart = error instanceof ApiError && (error.operationOutcome === "not-started" || error.operationOutcome === "not-applied");
      if (!didNotStart && current.current?.editorKey === snapshot.editorKey) update({ ...current.current, uncertain: true });
      throw error;
    }
  }, [applyResult, protect, update]);

  const reconcile = useCallback(async () => {
    const snapshot = current.current;
    if (!snapshot?.draft) return;
    applyResult(snapshot, await api.reconcileDocument(snapshot.address));
  }, [applyResult]);

  const discard = useCallback(async () => {
    const snapshot = current.current;
    if (!snapshot?.draft) return;
    await api.discardDraft(snapshot.address, snapshot.draft.generation);
    // Show fresh remote contents or an empty workspace. Never replace a
    // discarded draft with a stale view of the remote revision.
    clear();
    open(snapshot.address, await api.readDocument(snapshot.address));
  }, [clear, open]);

  return { opened, edited, getCurrent, clear, open, edit, protect, save, reconcile, discard };
}
