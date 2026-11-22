import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { getProtonErrorMessage } from "../../lib/i18n/protonErrors";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { resolveProtonConflict, reviewProtonConflict, type ProtonConflictReview } from "../../lib/api/protonRecovery";
import type { ProtonDocument, ProtonDocumentKey } from "../../types/protonWorkspace";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { ReadonlyMarkdownViewer } from "../editor/ReadonlyMarkdownViewer";
import type { MarkdownEditorController } from "../editor/editorTypes";
import "./ProtonRecovery.css";
import { ProtonHandwrittenPreview } from "./ProtonHandwrittenPreview";
import type { HandwrittenNoteContent } from "../../types/domain";
import { ProtonHandwrittenMergeReview, type ProtonNoteMergeSelection } from "./ProtonHandwrittenMergeReview";
import { useHandwrittenCopy } from "../../lib/i18n/handwrittenCopy";

const noAction = () => undefined;
const omitImages = () => "";

export function ProtonConflictDialog({ address, name, onClose, onResolved }: {
  address: ProtonDocumentKey;
  name: string;
  onClose: () => void;
  onResolved: (document: ProtonDocument) => void;
}) {
  const language = useUiLocale();
  const {conflict:c,common} = useHandwrittenCopy();
  const sources = [{value:"local",label:c.local},{value:"remote",label:c.remote}] as const;
  const { accountId, rootId, nodeId } = address;
  const [review, setReview] = useState<ProtonConflictReview | null>(null);
  const [source, setSource] = useState<"local" | "remote">("local");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<"local" | "remote" | "edited" | "pages">("local");
  const [merged, setMerged] = useState<ProtonNoteMergeSelection | null>(null);
  const [editorStart, setEditorStart] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const manual = useRef("");
  const editor = useRef<MarkdownEditorController | null>(null);
  const activeSave = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void reviewProtonConflict({ accountId, rootId, nodeId }, controller.signal).then(result => {
      if (!controller.signal.aborted) { setReview(result); setMerged(null); setChoice("local"); }
    }, cause => {
      if (!controller.signal.aborted) setError(getProtonErrorMessage(cause, c.readFailed, language));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountId, rootId, nodeId, reload]);
  const notes = useMemo(() => review?.handwritten ? {
    local: JSON.parse(review.draftMarkdown) as HandwrittenNoteContent,
    remote: JSON.parse(review.remoteMarkdown) as HandwrittenNoteContent,
  } : null, [review]);

  function currentEdit() {
    return editor.current?.getMarkdownSnapshot() ?? manual.current;
  }

  function close() {
    if (activeSave.current) return;
    if (choice === "pages") { setConfirmDiscard(true); return; }
    if (choice === "edited") {
      try {
        if (currentEdit() !== editorStart) {
          setConfirmDiscard(true);
          return;
        }
      } catch {
        // A composition in progress may contain changes beyond the last snapshot.
        setConfirmDiscard(true);
        return;
      }
    }
    onClose();
  }

  function edit() {
    if (!review || choice === "edited") return;
    const value = choice === "local" ? review.draftMarkdown : review.remoteMarkdown;
    setEditorStart(value);
    manual.current = value;
    setChoice("edited");
  }

  async function save() {
    if (!review || loading || error || activeSave.current) return;
    activeSave.current = true;
    setSaving(true);
    try {
      if (choice === "pages" && !merged) return;
      const markdown = choice === "pages" ? JSON.stringify(merged!.note) : choice === "edited" ? currentEdit()
        : choice === "local" ? review.draftMarkdown : review.remoteMarkdown;
      const snapshot = await resolveProtonConflict(address, review, markdown, choice === "pages" ? merged!.plan : undefined);
      onResolved(snapshot);
    } catch (cause) {
      setError(getProtonErrorMessage(cause, c.prepareFailed, language));
    } finally {
      activeSave.current = false;
      setSaving(false);
    }
  }

  return createPortal(<ModalFrame label={c.title} onClose={close}>
    <section className="proton-confirm-dialog proton-recovery-dialog p-4 md:p-5">
      <DialogHeading title={c.title} closeLabel={common.close} onClose={close} busy={saving} />
      <p className="min-w-0 break-words text-sm font-semibold text-ink-primary">{review?.name ?? name}</p>
      {loading && <p role="status" className="text-sm text-ink-secondary">{c.loading}</p>}
      {error && <InlineNotice tone="warning" announce="alert" action={
        <Button size="compact" disabled={loading || saving} onClick={() => setReload(value => value + 1)}>{c.refresh}</Button>
      }>{error}</InlineNotice>}
      {review && <>
        <p className="text-sm text-ink-secondary">{c.help}</p>
        <div className="proton-recovery-comparison-switch">
          <SegmentedControl label={c.version} options={sources} value={source} onChange={setSource} />
        </div>
        <div className="proton-recovery-comparison" data-source={source}>
          <section data-version="local">
            <h3>{c.local}</h3>
            {review.handwritten ? <ProtonHandwrittenPreview note={JSON.parse(review.draftMarkdown) as HandwrittenNoteContent} busy={saving} onReload={noAction} />
              : <ReadonlyMarkdownViewer markdown={review.draftMarkdown} ariaLabel={c.local} emptyMessage={c.emptyLocal} resolveImageSource={omitImages} />}
          </section>
          <section data-version="remote">
            <h3>{c.remote}</h3>
            {review.handwritten ? <ProtonHandwrittenPreview note={JSON.parse(review.remoteMarkdown) as HandwrittenNoteContent} busy={saving} onReload={noAction} />
              : <ReadonlyMarkdownViewer markdown={review.remoteMarkdown} ariaLabel={c.remote} emptyMessage={c.emptyRemote} resolveImageSource={omitImages} />}
          </section>
        </div>
        {choice === "pages" && notes ? <ProtonHandwrittenMergeReview key={`${review.remoteRevisionId}:${review.draftGeneration}`}
          local={notes.local} remote={notes.remote} disabled={loading || saving} onChange={setMerged} /> : choice === "edited" ? <section className="proton-recovery-editor" aria-label={c.edit}>
          <h3>{c.edit}</h3>
          <MarkdownEditor documentKey="proton-conflict-resolution" markdown={editorStart} onChange={text => { manual.current = text; }}
            readOnly={saving} zoomPercent={100} resolveImageSource={omitImages}
            onControllerChange={controller => { editor.current = controller; }}
            onFormatStateChange={noAction} onHistoryStateChange={noAction} onSelectionChange={noAction} />
        </section> : <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label={c.newDraft} options={sources} value={choice as "local" | "remote"} onChange={setChoice} />
          {!review.handwritten && <Button variant="quiet" disabled={loading || saving} onClick={edit}>{c.editBefore}</Button>}
          {review.handwritten && <Button variant="quiet" disabled={loading || saving} onClick={() => setChoice("pages")}>{c.merge}</Button>}
        </div>}
        <p className="text-sm text-ink-secondary">{c.preserved}</p>
      </>}
      <footer className="flex flex-wrap justify-end gap-2">
        <Button data-autofocus disabled={saving} onClick={close}>{common.close}</Button>
        {review && <Button variant="primary" disabled={loading || saving || !!error || choice === "pages" && !merged} onClick={() => { void save(); }}>
          {saving ? c.preparing : c.apply}
        </Button>}
      </footer>
    </section>
    {confirmDiscard && <ModalFrame label={c.discardLabel} role="alertdialog" className="!z-[90]"
      onClose={() => setConfirmDiscard(false)}>
      <section className="proton-confirm-dialog space-y-3 p-5">
        <DialogHeading title={c.discardTitle} closeLabel={common.close} onClose={() => setConfirmDiscard(false)} />
        <p className="text-sm text-ink-secondary">{c.discardHelp}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button data-autofocus variant="primary" onClick={() => setConfirmDiscard(false)}>{c.keepEditing}</Button>
          <Button variant="danger" onClick={onClose}>{common.discard}</Button>
        </div>
      </section>
    </ModalFrame>}
  </ModalFrame>, document.body);
}
