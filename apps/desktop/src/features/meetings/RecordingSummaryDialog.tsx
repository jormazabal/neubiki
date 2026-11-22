import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { StatusTag } from "../../components/ui/StatusTag";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { recordingTranscript } from "../../lib/api/recordings";
import type { MeetingPublicationSource } from "../../lib/api/meetingPublication";
import { getAiSkill } from "../../lib/api/skills";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import {
  generateRecordingSummary, getRecordingSummary, saveRecordingSummary,
  type RecordingSummaryProposal, type SavedRecordingSummary,
} from "../../lib/api/recordingSummaries";
import type { AiSkillMode } from "../../types/domain";
import type { RecordingTranscript } from "../../types/recording";
import { ReadonlyMarkdownViewer } from "../editor/ReadonlyMarkdownViewer";
import { recordingSummaryCopy } from "./recordingSummaryCopy";

const omitExternalImages = () => "";
type SummaryIssue = { reason: keyof typeof recordingSummaryCopy.es.errors; detail?: string };

export function RecordingSummaryDialog({ sessionId, onClose, onPublish }: {
  sessionId: string; onClose: () => void; onPublish?: (source: MeetingPublicationSource) => void;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const copy = recordingSummaryCopy[useUiLocale()];
  const views = [{ value: "edit", label: copy.edit }, { value: "preview", label: copy.preview }] as const;
  const [source, setSource] = useState<RecordingTranscript | null>(null);
  const [saved, setSaved] = useState<SavedRecordingSummary | null>(null);
  const [draft, setDraft] = useState<RecordingSummaryProposal | null>(null);
  const [modes, setModes] = useState<AiSkillMode[]>([]);
  const [mode, setMode] = useState("");
  const [guidance, setGuidance] = useState("");
  const [view, setView] = useState<"edit" | "preview">("preview");
  const [error, setError] = useState<SummaryIssue>();
  const [message, setMessage] = useState<keyof typeof copy.messages>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [confirm, setConfirm] = useState<"generate" | "close" | null>(null);
  const pending = useRef(false);
  const dirty = Boolean(draft && (draft.markdown !== saved?.markdown || draft.mode !== saved?.mode
    || draft.sourceRevision !== saved?.sourceRevision || draft.skillVersion !== saved?.skillVersion));
  const stale = Boolean(draft && draft.sourceRevision !== source?.sourceRevision);

  useEffect(() => {
    let live = true;
    Promise.all([recordingTranscript(sessionId), getRecordingSummary(sessionId), getAiSkill("neubiki.meeting_summary")])
      .then(([transcript, previous, skill]) => {
        if (!live) return;
        setSource(transcript);
        setSaved(previous);
        setDraft(previous);
        const options = (skill.manifest.modes ?? []).filter(item => item.supportedActions.includes("summarize_meeting"));
        setModes(options);
        setMode(previous && options.some(item => item.id === previous.mode) ? previous.mode : options[0]?.id ?? "");
      })
      .catch(cause => { if (live) setError({ reason: "load", detail: runtimeErrorMessage(cause, "") }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [sessionId]);

  function close() {
    if (pending.current) return;
    if (confirm) setConfirm(null);
    else if (dirty) setConfirm("close");
    else onClose();
  }

  async function run(action: "generate" | "save") {
    if (pending.current) return;
    if (!source || (action === "save" && (!draft || !dirty || stale))) return;
    pending.current = true;
    setConfirm(null);
    setError(undefined);
    setMessage(undefined);
    setBusy(action);
    try {
      if (action === "generate") {
        const result = await generateRecordingSummary(sessionId, source.sourceRevision, mode, guidance.trim());
        if (result.sessionId !== sessionId || result.sourceRevision !== source.sourceRevision
          || result.mode !== mode || result.skillId !== "neubiki.meeting_summary") {
          setError({ reason: "sourceChanged" });
          return;
        }
        setDraft(result);
        setView("preview");
      } else if (draft) {
        const result = await saveRecordingSummary(draft, saved?.revision ?? null);
        setSaved(result);
        setDraft(result);
        setMessage("saved");
      }
    } catch (cause) {
      setError({ reason: action, detail: runtimeErrorMessage(cause, "") });
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function copySavedSummary() {
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(saved.markdown);
      setMessage("copied");
    } catch {
      setError({ reason: "clipboard" });
    }
  }

  return <ModalFrame label={copy.title} onClose={close} className="!z-[170]">
    <section className="proton-confirm-dialog !max-w-3xl !w-full space-y-3 p-4">
      <DialogHeading title={copy.title} onClose={close} closeLabel={copy.close} busy={Boolean(busy)} />
      {loading && <p role="status">{copy.loading}</p>}
      {error && <InlineNotice tone="error" announce="alert">{error.detail || copy.errors[error.reason]}</InlineNotice>}
      {message && <StatusTag tone="success" role="status">{copy.messages[message]}</StatusTag>}
      {source && <>
        <p className="break-words text-sm font-semibold">{source.title}</p>
        {source.unconfirmedCount > 0 && <InlineNotice tone="warning">
          {copy.partial}
        </InlineNotice>}
        <details className="rounded-xl border border-line p-3 text-sm">
          <summary>{copy.sourceFragments}</summary>
          <div className="max-h-48 overflow-auto">
            {source.segments.map(fragment => <p key={fragment.id} className="mt-2 whitespace-pre-wrap break-words">
              <strong>{fragment.id}</strong> · {fragment.text}
            </p>)}
          </div>
        </details>
        <label className="grid gap-1 text-sm">{copy.mode}
          <select className="ui-field" value={mode} disabled={Boolean(busy)} onChange={event => setMode(event.target.value)}>
            {modes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">{copy.guidance}
          <textarea className="ui-field" rows={2} maxLength={900} value={guidance} disabled={Boolean(busy)}
            onChange={event => setGuidance(event.target.value)} placeholder={copy.guidancePlaceholder} />
        </label>
        <Button disabled={!mode || !source.segments.some(fragment => fragment.text.trim()) || Boolean(busy)}
          onClick={() => setConfirm("generate")}>{draft ? copy.generateAgain : copy.generate}</Button>
        {busy === "generate" && <>
          <StatusTag activity="working" role="status">{copy.preparing}</StatusTag>
          <ProgressBar label={copy.progress} />
        </>}
      </>}
      {confirm === "generate" && <InlineNotice tone="warning" action={
        <div className="flex flex-wrap gap-2">
          <Button size="compact" onClick={() => setConfirm(null)}>{copy.cancel}</Button>
          <Button size="compact" variant="primary" onClick={() => void run("generate")}>{copy.submit}</Button>
        </div>
      }>{copy.consent} {dirty && copy.replaceDraft}</InlineNotice>}
      {confirm === "close" && <InlineNotice tone="warning" action={
        <div className="flex flex-wrap gap-2">
          <Button size="compact" onClick={() => setConfirm(null)}>{copy.keepReviewing}</Button>
          <Button size="compact" variant="danger" onClick={onClose}>{copy.discard}</Button>
        </div>
      }>{copy.unsaved}</InlineNotice>}
      {draft && <div className="space-y-2 rounded-xl border border-line p-3">
        <h3 className="text-sm font-semibold">{copy.review}</h3>
        <p className="text-xs text-ink-secondary">{draft.skillId} · v{draft.skillVersion}. {copy.referenceCheck}</p>
        {stale && <InlineNotice tone="warning">{copy.stale}</InlineNotice>}
        <SegmentedControl label={copy.presentation} options={views} value={view} onChange={setView} />
        {view === "edit"
          ? <textarea className="ui-field" aria-label={copy.markdown} rows={8} value={draft.markdown} disabled={Boolean(busy)}
            onChange={event => setDraft({ ...draft, markdown: event.target.value })} />
          : <div className="max-h-64 overflow-auto">
            <ReadonlyMarkdownViewer markdown={draft.markdown} ariaLabel={copy.previewLabel}
              emptyMessage={copy.empty} resolveImageSource={omitExternalImages} />
          </div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!dirty || stale || !draft.markdown.trim() || Boolean(busy)}
            onClick={() => void run("save")}>{busy === "save" ? copy.saving : copy.save}</Button>
          {saved && <Button disabled={Boolean(busy)} onClick={() => void copySavedSummary()}>{copy.copySaved}</Button>}
          {saved && source && onPublish && <Button disabled={dirty || stale || Boolean(busy)} onClick={() => onPublish({
            sessionId, title: source.title, sourceRevision: saved.sourceRevision, summaryRevision: saved.revision,
          })}>{copy.publish}</Button>}
        </div>
      </div>}
    </section>
  </ModalFrame>;
}
