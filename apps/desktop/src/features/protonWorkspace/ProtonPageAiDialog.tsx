import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { StatusTag } from "../../components/ui/StatusTag";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { applyProtonNoteAi, checkProtonNoteAi, generateProtonNoteAi, listProtonNoteAi,
  type ProtonNoteAiKind, type ProtonNoteAiReceipt, type ProtonNoteAiResult } from "../../lib/api/protonNoteAi";
import type { HandwrittenNoteContent } from "../../types/domain";
import type { ProtonDraft } from "../../types/protonWorkspace";
import type { OpenedDocument } from "./useProtonDocument";
import { ProtonHandwrittenPreview } from "./ProtonHandwrittenPreview";
import { ProtonAudioCapture } from "../transcription/ProtonAudioCapture";
import { useHandwrittenCopy } from "../../lib/i18n/handwrittenCopy";
import { useUiLocale } from "../../lib/i18n/UiLocale";

export type ProtonNoteAiController = {
  getCurrent: () => OpenedDocument | null;
  protect: () => Promise<void>;
  onApplied: (snapshot: OpenedDocument, draft: ProtonDraft, previousGeneration: number | null) => boolean;
};

export function ProtonPageAiDialog({ kind, pageId, pageNumber, controller, onClose }: {
  kind: ProtonNoteAiKind; pageId: string; pageNumber: number; controller: ProtonNoteAiController; onClose: () => void;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const {ai:c,common} = useHandwrittenCopy();
  const language = useUiLocale();
  const origin = useRef(controller.getCurrent());
  const [receipt, setReceipt] = useState<ProtonNoteAiReceipt | null>(null);
  const [catalog, setCatalog] = useState<ProtonNoteAiReceipt[]>([]);
  const [attempt, setAttempt] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [previewNote, setPreviewNote] = useState<HandwrittenNoteContent | null>(null);
  const pending = useRef(false);
  const live = useRef(true);
  const title = kind === "ocr" ? c.ocrTitle : kind === "transcription" ? c.audioTitle : c.drawingTitle;

  useEffect(() => {
    live.current = true;
    const current = origin.current;
    if (current) void listProtonNoteAi(current.address).then(result => {
      if (live.current) setCatalog(result.items.filter(item => item.kind === kind && item.pageId === pageId));
    }, cause => { if (live.current) setError(runtimeErrorMessage(cause, c.catalogFailed)); });
    return () => { live.current = false; };
  }, [kind, pageId]);

  function current() {
    const note = controller.getCurrent();
    if (!origin.current || note?.editorKey !== origin.current.editorKey || !note.handwritten
      || !note.handwritten.pages.some(page => page.id === pageId)) throw new Error(c.sourceChanged);
    return note;
  }

  function accept(next: ProtonNoteAiReceipt) {
    if (!live.current) return;
    setReceipt(next);
    setAttempt(next.attemptId);
    setText(next.text ?? "");
    setReviewed(false);
  }

  function adopt(result: ProtonNoteAiResult, snapshot: OpenedDocument) {
    accept(result.receipt);
    if (result.draft && result.previousGeneration !== undefined) {
      const applied = controller.onApplied(snapshot, result.draft, result.previousGeneration);
      setMessage(applied ? c.applied : c.draftChanged);
    }
  }

  async function run(task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try { await task(); }
    catch (cause) { if (live.current) setError(runtimeErrorMessage(cause, c.unconfirmed)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }

  async function generate() {
    if (!consent || kind === "drawing" && !prompt.trim() || kind === "transcription" && !audio) return;
    await controller.protect();
    const snapshot = current();
    setPreviewNote(snapshot.handwritten ?? null);
    const id = `note-ai-${crypto.randomUUID()}`;
    setAttempt(id);
    setConsent(false);
    const next = await generateProtonNoteAi(kind, snapshot.address, { attemptId: id, pageId,
      baseRevisionId: snapshot.draft?.baseRevisionId ?? snapshot.document.revisionId,
      expectedGeneration: snapshot.draft?.generation ?? null, prompt: kind === "drawing" ? prompt.trim() : undefined,
      ...(kind === "transcription" && audio ? { audio } : {}) });
    setAudio(null);
    accept(next);
  }

  async function check(id = attempt) {
    if (!id) return;
    const snapshot = current();
    if (kind === "drawing" && !previewNote) setPreviewNote(snapshot.handwritten ?? null);
    adopt(await checkProtonNoteAi(snapshot.address, id), snapshot);
  }

  async function apply() {
    if (!reviewed || receipt?.phase !== "ready") return;
    await controller.protect();
    const snapshot = current();
    setReceipt({ ...receipt, phase: "uncertain", message: c.applyPending });
    const result = await applyProtonNoteAi(snapshot.address, receipt.attemptId, snapshot.draft?.generation ?? null,
      snapshot.document.node.name, kind !== "drawing" ? text : undefined);
    adopt(result, snapshot);
  }

  function close() {
    if (pending.current) return;
    if (audio || receipt?.phase === "ready" && kind !== "drawing" && text !== (receipt.text ?? "")) setConfirmClose(true);
    else onClose();
  }

  const page = previewNote?.pages.find(page => page.id === pageId);
  const drawingPreview = previewNote && page && receipt?.strokes ? { ...previewNote,
    pages: [{ ...page, strokes: [...page.strokes, ...receipt.strokes] }] } : null;
  const priorUncertain = catalog.some(item => item.phase === "uncertain");

  return createPortal(<ModalFrame label={title} onClose={close} className="!z-[180]">
    <section className="proton-confirm-dialog !w-full !max-w-3xl space-y-3 p-4 md:p-5">
      <DialogHeading title={`${title} · ${common.page} ${pageNumber}`} onClose={close} closeLabel={common.close} busy={busy} />
      <p className="break-words text-sm font-medium">{origin.current?.document.node.name}</p>
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {message && <InlineNotice tone="neutral" announce="status">{message}</InlineNotice>}
      {!attempt && <>
        {priorUncertain && <InlineNotice tone="warning">{c.priorUncertain}</InlineNotice>}
        {catalog.length > 0 && <details className="rounded-xl border border-line p-3 text-sm">
          <summary>{c.previous}</summary>
          <ul>{catalog.map(item => <li key={item.attemptId}>
            <Button variant="quiet" size="compact" disabled={busy} onClick={() => { void run(() => check(item.attemptId)); }}>
              {new Date(item.createdAt * 1000).toLocaleString(language)} · {item.phase === "ready" ? c.reviewProposal : c.checkResult}
            </Button>
          </li>)}</ul>
        </details>}
        {kind === "drawing" && <label className="grid gap-1 text-sm font-medium">{c.description}
          <textarea className="ui-field" rows={3} maxLength={2000} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} />
        </label>}
        {kind === "transcription" && <ProtonAudioCapture disabled={busy} onClip={file => { setAudio(file); setConsent(false); }} />}
        <p className="text-sm text-ink-secondary">{kind === "ocr"
          ? c.ocrHelp : kind === "transcription" ? c.audioHelp : c.drawingHelp}</p>
        <label className="flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
          {priorUncertain ? c.repeatConsent : c.consent}
        </label>
        <Button variant="primary" disabled={busy || !consent || kind === "drawing" && !prompt.trim() || kind === "transcription" && !audio} onClick={() => { void run(generate); }}>
          {kind === "ocr" ? c.recognize : kind === "transcription" ? c.transcribe : c.draw}
        </Button>
      </>}
      {busy && <StatusTag activity="working" role="status">{c.processing}</StatusTag>}
      {attempt && !receipt && <InlineNotice tone="warning">{c.pending}</InlineNotice>}
      {receipt && <>
        <InlineNotice tone={receipt.phase === "applied" ? "success" : receipt.phase === "ready" ? "neutral" : "warning"} announce="status">{receipt.message}</InlineNotice>
        {receipt.sourceDataUrl && <details className="rounded-xl border border-line p-3 text-sm">
          <summary>{c.viewOriginal}</summary><img src={receipt.sourceDataUrl} alt={c.originalAlt} className="max-h-72 max-w-full object-contain" />
        </details>}
        {receipt.phase === "ready" && <>
          {kind !== "drawing" ? <label className="grid gap-1 text-sm font-medium">{kind === "ocr" ? c.recognizedText : c.pageText}
            <textarea className="ui-field min-h-48" rows={8} value={text} maxLength={64000} disabled={busy}
              onChange={event => { setText(event.target.value); setReviewed(false); }} />
          </label> : drawingPreview && <div className="h-80 overflow-auto rounded-xl border border-line">
            <ProtonHandwrittenPreview note={drawingPreview} busy={busy} onReload={() => { void run(() => check()); }} />
          </div>}
          <label className="flex min-h-12 items-center gap-2 text-sm">
            <input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />
            {kind !== "drawing" ? c.reviewText : c.reviewDrawing}
          </label>
          <Button variant="primary" disabled={busy || !reviewed || kind === "drawing" && !drawingPreview} onClick={() => { void run(apply); }}>
            {kind !== "drawing" ? c.applyText : c.applyDrawing}
          </Button>
        </>}
      </>}
      {attempt && <div className="flex flex-wrap justify-between gap-2">
        <Button disabled={busy} onClick={close}>{c.back}</Button>
        <Button disabled={busy} onClick={() => { void run(() => check()); }}>{c.checkAttempt}</Button>
      </div>}
      <p className="text-xs text-ink-secondary">{c.retention}</p>
    </section>
    {confirmClose && <ModalFrame label={c.discardLabel} className="!z-[190]" onClose={() => setConfirmClose(false)}>
      <section className="proton-confirm-dialog space-y-3 p-4">
        <DialogHeading title={c.discardTitle} closeLabel={common.close} onClose={() => setConfirmClose(false)} />
        <p className="text-sm">{c.discardHelp}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button data-autofocus onClick={() => setConfirmClose(false)}>{c.keepReviewing}</Button>
          <Button variant="danger" onClick={onClose}>{common.discard}</Button>
        </div>
      </section>
    </ModalFrame>}
  </ModalFrame>, document.body);
}
