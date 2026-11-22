import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Play } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { ReadonlyMarkdownViewer } from "../editor/ReadonlyMarkdownViewer";
import { RecordingAudioPlayer } from "../recordings/RecordingAudioPlayer";
import { reviewMeetingMinutes, createMeetingMinutes, getMeetingMinutesReceipt, getMeetingMinutesCatalog } from "../../lib/api/meetingMinutes";
import { getApiErrorMessage } from "../../lib/api/client";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import type { MeetingMinutesDraft, MeetingMinutesReview, MeetingMinutesReceipt } from "../../types/meetingMinutes";
import type { StateTransitionAuthority } from "../../types/stateMigrations";
import { meetingMinutesCopy } from "./meetingMinutesCopy";

const button = "min-h-11 rounded px-3 text-xs font-medium hover:bg-panel disabled:opacity-50";
const input = "mt-1 min-h-11 w-full rounded border border-line bg-white px-2 text-sm";
type Notice = "catalogPartial" | "catalogFailed" | "created" | "createdUnconfirmed" | "checked" | "checkedUnconfirmed";
type MinutesIssue = { reason: "reviewFailed" | "resultFailed" | "protectedWorkspace"; detail?: string };

export function MeetingMinutesDialog({ projectId, sessionId, onClose, onPublished, onBeforeChange, onSettled }: {
  projectId: string; sessionId: string; onClose: () => void; onPublished?: (documentId: string) => void;
} & StateTransitionAuthority) {
  const copy = meetingMinutesCopy[useUiLocale()];
  const [base, setBase] = useState<MeetingMinutesReview | null>(null);
  const [draft, setDraft] = useState<MeetingMinutesDraft | null>(null);
  const [review, setReview] = useState<MeetingMinutesReview | null>(null);
  const [catalog, setCatalog] = useState<MeetingMinutesReceipt[]>([]);
  const [receipt, setReceipt] = useState<MeetingMinutesReceipt | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [audio, setAudio] = useState<{ start: number; samples: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<MinutesIssue>();
  const [notice, setNotice] = useState<Notice>();
  const [dirty, setDirty] = useState(false);
  const [closeReview, setCloseReview] = useState(false);
  const gate = useRef(false);
  const alive = useRef(true);
  const scope = useRef("");
  const expectedScope = projectId + "|" + sessionId;
  scope.current = expectedScope;
  const stillHere = () => alive.current && scope.current === expectedScope;

  useEffect(() => {
    alive.current = true;
    void reviewMeetingMinutes(projectId, sessionId).then(value => {
      if (!stillHere()) return;
      setBase(value);
      setDraft(value.draft);
      setSourceId(value.source.segments[0]?.id ?? "");
    }).catch(cause => {
      if (stillHere()) setError({ reason: "reviewFailed", detail: getApiErrorMessage(cause, "") });
    });
    void getMeetingMinutesCatalog(projectId).then(value => {
      if (!stillHere()) return;
      setCatalog(value.items);
      if (value.limited || value.unavailable) setNotice("catalogPartial");
    }).catch(() => {
      if (stillHere()) setNotice("catalogFailed");
    });
    return () => { alive.current = false; };
  }, [projectId, sessionId]);

  function change(next: MeetingMinutesDraft) {
    setDraft(next);
    setReview(null);
    setAck(false);
    setDirty(true);
    setError(undefined);
  }

  function close() {
    if (busy) return;
    if (dirty && !receipt) {
      setCloseReview(true);
      return;
    }
    onClose();
  }

  async function run(kind: "review" | "apply" | "check", id?: string) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError(undefined);
    let protectedState = false;
    let outcome = { confirmed: false, message: copy.unknown };
    try {
      if (kind === "review" && draft) {
        const value = await reviewMeetingMinutes(projectId, sessionId, draft);
        if (stillHere()) { setReview(value); setAck(false); }
        return;
      }
      if (!onBeforeChange || !onSettled) {
        if (stillHere()) setError({ reason: "protectedWorkspace" });
        return;
      }
      await onBeforeChange();
      protectedState = true;
      if (!stillHere()) {
        outcome.message = copy.scopeChanged;
        return;
      }

      let result: MeetingMinutesReceipt;
      let resultNotice: Notice;
      if (kind === "apply" && review && ack) {
        const attempt = "minutes-" + crypto.randomUUID();
        setPending(attempt);
        result = await createMeetingMinutes(review, attempt);
        resultNotice = result.confirmed ? "created" : "createdUnconfirmed";
      } else if (kind === "check" && (id ?? pending)) {
        result = await getMeetingMinutesReceipt(projectId, (id ?? pending)!);
        resultNotice = result.confirmed ? "checked" : "checkedUnconfirmed";
      } else {
        return;
      }

      outcome = { confirmed: result.confirmed, message: copy[resultNotice] };
      if (!stillHere()) return;
      setReceipt(result);
      setReview(null);
      setPending(null);
      setDirty(false);
      setNotice(resultNotice);
      if (result.confirmed) onPublished?.(result.documentId);
    } catch (cause) {
      if (stillHere()) setError({ reason: "resultFailed", detail: getApiErrorMessage(cause, "") });
    } finally {
      if (protectedState) onSettled?.(outcome);
      gate.current = false;
      if (stillHere()) setBusy(false);
    }
  }

  const selected = base?.source.segments.find(segment => segment.id === sourceId);
  return <ModalFrame label={copy.title} onClose={close}>
    <section aria-busy={busy} className="flex max-h-[calc(100dvh-24px)] w-full max-w-[960px] flex-col overflow-hidden rounded-lg bg-white shadow-menu">
      <div className="shrink-0 px-5 py-2"><DialogHeading title={copy.title} onClose={close} closeLabel={copy.close} busy={busy} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 text-xs leading-5 [overflow-wrap:anywhere]">
        <p>{copy.intro}</p>
        {catalog.length > 0 && <details className="my-2 rounded bg-panel p-2">
          <summary className="min-h-11 cursor-pointer">{copy.attempts(catalog.length)}</summary>
          {catalog.map(item => <button className={button + " block w-full text-left"} disabled={busy || dirty && !pending}
            key={item.id} onClick={() => void run("check", item.id)}>
            {item.documentId.split("::")[1]} · {item.phase === "completed" ? copy.confirmed : copy.unconfirmed}
          </button>)}
        </details>}
        {base && <details open className="my-3 rounded bg-panel p-3">
          <summary className="min-h-11 cursor-pointer font-medium">{copy.originalSources(base.source.segments.length)}</summary>
          <p className="my-2 text-ink-secondary">{copy.timing} {base.source.unconfirmedCount > 0 && copy.partial(base.source.unconfirmedCount)}</p>
          <label>{copy.sourceSegment}
            <select className={input} value={sourceId} disabled={busy} onChange={event => setSourceId(event.target.value)}>
              {base.source.segments.map(segment => <option key={segment.id} value={segment.id}>
                {segment.id} · {Math.floor(segment.start / 24000 / 60)}:{String(Math.floor(segment.start / 24000) % 60).padStart(2, "0")}
              </option>)}
            </select>
          </label>
          {selected && <>
            <p className="my-2 whitespace-pre-wrap">{selected.text}</p>
            <button className={button + " flex items-center gap-2"} disabled={busy || !base.source.audioAvailable}
              onClick={() => setAudio({ start: selected.start, samples: selected.samples })}>
              <Play size={14} aria-hidden="true" />{copy.listen}
            </button>
            {!base.source.audioAvailable && <p>{copy.textAvailable}</p>}
          </>}
          {audio && <RecordingAudioPlayer key={sessionId + ":" + audio.start} session={{ id: sessionId, samples: base.source.samples }}
            range={audio} onClose={() => setAudio(null)} />}
        </details>}
        {draft && !pending && !receipt && <fieldset disabled={busy}>
          <label className="block">{copy.minutesTitle}
            <input className={input} value={draft.title} maxLength={300} onChange={event => change({ ...draft, title: event.target.value })} />
          </label>
          <label className="my-2 block">{copy.documentName}
            <input className={input} value={draft.name} maxLength={150} onChange={event => change({ ...draft, name: event.target.value })} />
            <span className="text-ink-secondary">{copy.nameHelp}</span>
          </label>
          <label className="my-2 block">{copy.summary}
            <textarea className={input + " min-h-28 p-2"} value={draft.summary} maxLength={16000}
              onChange={event => change({ ...draft, summary: event.target.value })} />
          </label>
          <h3 className="mt-3 font-medium">{copy.decisions}</h3>
          {draft.decisions.map((row, index) => <div key={index} className="my-2 rounded bg-panel p-2">
            <label>{copy.decision(index + 1)}
              <textarea className={input + " min-h-20 p-2"} maxLength={8000} value={row.text} onChange={event => change({
                ...draft, decisions: draft.decisions.map((item, position) => position === index ? { ...item, text: event.target.value } : item),
              })} />
            </label>
            <p>{copy.sources} · {row.sourceIds.join(", ")}</p>
            <button className={button} aria-label={copy.removeDecision(index + 1)}
              onClick={() => change({ ...draft, decisions: draft.decisions.filter((_, position) => position !== index) })}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>)}
          <button className={button + " inline-flex items-center gap-2"} disabled={!sourceId || draft.decisions.length >= 64}
            onClick={() => change({ ...draft, decisions: [...draft.decisions, { text: "", sourceIds: [sourceId] }] })}>
            <Plus size={14} aria-hidden="true" />{copy.addDecision}
          </button>
          <h3 className="mt-3 font-medium">{copy.actions}</h3>
          {draft.actions.map((row, index) => <div key={index} className="my-2 rounded bg-panel p-2">
            <label>{copy.action(index + 1)}
              <textarea className={input + " min-h-20 p-2"} maxLength={8000} value={row.text} onChange={event => change({
                ...draft, actions: draft.actions.map((item, position) => position === index ? { ...item, text: event.target.value } : item),
              })} />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label>{copy.owner}
                <input className={input} value={row.owner ?? ""} maxLength={200} placeholder={copy.pendingConfirmation}
                  onChange={event => change({
                    ...draft, actions: draft.actions.map((item, position) => position === index ? { ...item, owner: event.target.value || null } : item),
                  })} />
              </label>
              <label>{copy.date}
                <input className={input} value={row.dueDate ?? ""} maxLength={80} placeholder={copy.pendingConfirmation}
                  onChange={event => change({
                    ...draft, actions: draft.actions.map((item, position) => position === index ? { ...item, dueDate: event.target.value || null } : item),
                  })} />
              </label>
            </div>
            <p>{copy.sources} · {row.sourceIds.join(", ")}</p>
            <button className={button} aria-label={copy.removeAction(index + 1)}
              onClick={() => change({ ...draft, actions: draft.actions.filter((_, position) => position !== index) })}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>)}
          <button className={button + " inline-flex items-center gap-2"} disabled={!sourceId || draft.actions.length >= 64}
            onClick={() => change({ ...draft, actions: [...draft.actions, { text: "", owner: null, dueDate: null, sourceIds: [sourceId] }] })}>
            <Plus size={14} aria-hidden="true" />{copy.addAction}
          </button>
        </fieldset>}
        {review && <details open className="my-3 rounded bg-panel p-3">
          <summary className="min-h-11 cursor-pointer font-medium">{copy.documentPreview}</summary>
          <ReadonlyMarkdownViewer markdown={review.markdown} ariaLabel={copy.minutesPreview} emptyMessage={copy.empty} />
          <label className="my-2 flex min-h-11 items-start gap-2">
            <input className="mt-1 accent-[#F37021]" type="checkbox" disabled={busy} checked={ack} onChange={event => setAck(event.target.checked)} />
            <span>{copy.acknowledge}</span>
          </label>
        </details>}
        {pending && <p role="status" className="my-2">{copy.pending}</p>}
        {receipt && <p role="status" className="my-2">
          {receipt.confirmed ? copy.confirmedReceipt : copy.unconfirmedReceipt} · {receipt.documentId.split("::")[1]}
        </p>}
        {closeReview && <div className="my-3 rounded bg-panel p-3" role="alert">
          <p>{copy.unsaved}</p>
          <button className={button} onClick={() => setCloseReview(false)}>{copy.keepEditing}</button>
          <button className={button} onClick={onClose}>{copy.discard}</button>
        </div>}
        {notice && <p role="status" className="my-2">{copy[notice]}</p>}
        {error && <p role="alert" className="my-2 text-red-800">{error.detail || copy[error.reason]}</p>}
        {!base && !error && <p role="status">{copy.loading}</p>}
        {busy && <p role="status">{copy.working}</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-2 px-5 py-3">
        <button className={button + " mr-auto"} disabled={busy} onClick={close}>{copy.back}</button>
        {pending ? <button className={button + " bg-brand-orange text-white"} disabled={busy}
          onClick={() => void run("check")}>{copy.check}</button> : !receipt && <>
          <button className={button} disabled={busy || !draft} onClick={() => void run("review")}>{copy.review}</button>
          {review && <button className={button + " bg-brand-orange text-white"} disabled={busy || !ack || !onBeforeChange || !onSettled}
            onClick={() => void run("apply")}>{copy.create}</button>}
        </>}
      </footer>
    </section>
  </ModalFrame>;
}
