import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useRef, useState, type FormEvent } from "react";
import { FolderOpen } from "lucide-react";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { ApiError } from "../../lib/api/client";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import {
  checkMeetingPublication, publishMeeting, reviewMeetingPublication,
  type MeetingPublicationReview, type MeetingPublicationSource, type MeetingPublicationTarget,
} from "../../lib/api/meetingPublication";
import type { ProtonNode, ProtonWorkspace } from "../../types/protonWorkspace";
import { ReadonlyMarkdownViewer } from "../editor/ReadonlyMarkdownViewer";
import { DrivePicker } from "../protonWorkspace/DrivePicker";
import { meetingPublicationCopy } from "./meetingPublicationCopy";

const omitImages = () => "";

export function MeetingPublicationDialog({ source, workspace, onClose, onPublished }: {
  source: MeetingPublicationSource;
  workspace: ProtonWorkspace;
  onClose: () => void;
  onPublished: (node: ProtonNode, parents: ProtonNode[]) => void;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const copy = meetingPublicationCopy[useUiLocale()];
  const { title, suffix } = source.summaryRevision ? copy.summary : copy.transcript;
  const [name, setName] = useState(() => {
    const label = source.title.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, " ").replace(/^\.+/, "").trim().slice(0, 90);
    return `${label || copy.fallbackName} - ${suffix}`;
  });
  const [folder, setFolder] = useState<ProtonNode[]>([workspace.root]);
  const [picker, setPicker] = useState<ProtonNode[] | null>(null);
  const [step, setStep] = useState<MeetingPublicationReview | null>(null);
  const [busy, setBusy] = useState<"review" | "publish" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const fileName = `${name.trim()}.md`;
  const nameValid = !!name.trim() && !name.trim().startsWith(".") && !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(name);
  const path = folder.map(node => node.name).join(" / ");

  function target(): MeetingPublicationTarget {
    return {
      sessionId: source.sessionId, sourceRevision: source.sourceRevision, summaryRevision: source.summaryRevision,
      accountId: workspace.accountId, rootId: workspace.root.nodeId, parentId: folder[folder.length - 1].nodeId,
      name: fileName,
    };
  }

  function close() {
    if (active.current) return;
    if (picker) setPicker(null);
    else onClose();
  }

  async function run(action: NonNullable<typeof busy>) {
    if (active.current || !nameValid) return;
    active.current = true;
    setBusy(action);
    setError(null);
    try {
      const body = target();
      if (action === "review") setStep(await reviewMeetingPublication(body));
      if (action === "publish" && step?.state === "review") setStep(await publishMeeting(body, step.digest));
      if (action === "check") setStep(await checkMeetingPublication(body));
    } catch (cause) {
      if (action === "publish" && (!(cause instanceof ApiError) || cause.operationOutcome === "unknown")) {
        setStep({ state: "unknown" });
      }
      setError(runtimeErrorMessage(cause, ""));
    } finally {
      active.current = false;
      setBusy(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!step) void run("review");
  }

  return <ModalFrame label={title} onClose={close} className="!z-[180]">
    <section className="proton-confirm-dialog !w-full !max-w-2xl space-y-3 p-4 md:p-5">
      <DialogHeading title={title} onClose={close} closeLabel={copy.close} busy={Boolean(busy)} />
      {picker ? <DrivePicker accountId={workspace.accountId} rootId={workspace.root.nodeId}
        title={copy.chooseFolder} path={picker} busy={Boolean(busy)}
        onBack={() => setPicker(picker.length > 1 ? picker.slice(0, -1) : null)}
        onOpen={node => setPicker([...picker, node])}
        onSelect={() => { setFolder(picker); setPicker(null); }} /> : <>
        <p className="break-words text-sm text-ink-secondary">{source.title}</p>
        {error !== null && <InlineNotice tone="error" announce="alert">{error || copy.failure}</InlineNotice>}
        {!step ? <form className="space-y-3" onSubmit={submit}>
          <label className="grid gap-1 text-sm font-medium">{copy.documentName}
            <div className="flex items-center gap-2">
              <input className="ui-field min-w-0 grow" data-autofocus value={name} maxLength={120} disabled={Boolean(busy)}
                onChange={event => setName(event.target.value)} />
              <span className="text-xs text-ink-secondary">.md</span>
            </div>
          </label>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3">
            <FolderOpen size={18} aria-hidden="true" />
            <div className="min-w-0 flex-1 break-words text-sm"><strong>{copy.destination}</strong><p className="text-ink-secondary">{path}</p></div>
            <Button variant="quiet" size="compact" disabled={Boolean(busy)} onClick={() => setPicker(folder)}>{copy.changeFolder}</Button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={Boolean(busy)} onClick={close}>{copy.cancel}</Button>
            <Button variant="primary" type="submit" disabled={!nameValid || !!busy}>
              {busy === "review" ? copy.preparing : copy.review}
            </Button>
          </div>
        </form> : <>
          <div className="break-words text-sm"><strong>{fileName}</strong><p className="text-ink-secondary">{path}</p></div>
          {step.state === "review" && <>
            {step.partial && <InlineNotice tone="warning">{copy.confirmedParts}</InlineNotice>}
            <div className="max-h-[42vh] overflow-auto rounded-xl border border-line">
              <ReadonlyMarkdownViewer markdown={step.markdown} ariaLabel={copy.preview}
                emptyMessage={copy.empty} resolveImageSource={omitImages} />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button disabled={Boolean(busy)} onClick={() => { setStep(null); setError(null); }}>{copy.editTarget}</Button>
              <Button variant="primary" disabled={Boolean(busy)} onClick={() => { void run("publish"); }}>
                {busy === "publish" ? copy.publishing : copy.publish}
              </Button>
            </div>
          </>}
          {step.state === "unknown" && <>
            <InlineNotice tone="warning" announce="status">{copy.pending}</InlineNotice>
            <Button variant="primary" disabled={Boolean(busy)} onClick={() => { void run("check"); }}>
              {busy === "check" ? copy.checking : copy.check}
            </Button>
          </>}
          {step.state === "conflict" && <>
            <InlineNotice tone="warning" announce="alert">{copy.conflict}</InlineNotice>
            <Button onClick={() => { setStep(null); setError(null); }}>{copy.editTarget}</Button>
          </>}
          {step.state === "confirmed" && <>
            <InlineNotice tone="success" announce="status">{copy.saved}</InlineNotice>
            <Button variant="primary" onClick={() => onPublished(step.node, folder)}>{copy.open}</Button>
          </>}
        </>}
      </>}
    </section>
  </ModalFrame>;
}
