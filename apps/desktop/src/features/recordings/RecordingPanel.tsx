import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Pause,
  Play,
  Square,
  X,
  FolderOpen,
  Trash2,
  Volume2,
} from "lucide-react";
import "./RecordingPanel.css";
import { openRecordingWorkspace, useCompactRecordingWindow } from "../../lib/runtime/useCompactRecordingWindow";
import { useRecordings } from "./useRecordings";
import { recordingRequest } from "../../lib/api/recordings";
import { getProjectTree, listProjects } from "../../lib/api/projects";
import type { DocumentTreeNode, Project } from "../../types/domain";
import type {
  RecordingDestination,
  RecordingDevice,
  RecordingSession,
  RecordingSettings,
} from "../../types/recording";
import {
  isTauriMobileRuntime,
  isTauriRuntime,
} from "../../lib/runtime/platform";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {RecordingAudioPlayer} from "./RecordingAudioPlayer";
import {ModalFrame} from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { StatusTag } from "../../components/ui/StatusTag";
import { ProgressBar } from "../../components/ui/ProgressBar";
import {RecordingTranscriptPanel} from "./RecordingTranscriptPanel";
import type { MeetingPublicationSource } from "../../lib/api/meetingPublication";
import { useRecordingCopy } from "../../lib/i18n/recordingCopy";
import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";

const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm hover:bg-brand-hover disabled:opacity-40";
export function recordingTime(samples: number) {
  const seconds = Math.floor(samples / 24000);
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(
      2,
      "0",
    )}:${Math.floor(seconds / 60) % 60 < 10 ? "0" : ""}${Math.floor(seconds / 60) % 60}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export function RecordingPanel({
  compact = false,
  embedded = false,
  initialDestination = null,
  onClose,
  onOpenDocument,
  onOpenSettings,
  onOpenMinutes,
  meetingMode = false,
  onOpenSummary,
  onPublish,
}: {
  compact?: boolean;
  embedded?: boolean;
  initialDestination?: RecordingDestination | null;
  onClose?: () => void;
  onOpenDocument?: (id: string) => void;
  onOpenSettings?: () => void;
  onOpenMinutes?: (sessionId:string,projectId:string) => void;
  meetingMode?: boolean;
  onOpenSummary?: (session: RecordingSession) => void;
  onPublish?: (source: MeetingPublicationSource) => void;
}) {
  const { locale, copy } = useRecordingCopy();
  const { snapshot, error, busy, command } = useRecordings();
  const [startingName, setStartingName] = useState(
    meetingMode ? copy.meeting : initialDestination?.name ?? "",
  );
  const [draft, setDraft] = useState<RecordingSettings | null>(null);
  const [devices, setDevices] = useState<RecordingDevice[]>([]);
  const [destination, setDestination] = useState<RecordingSession | null>(null);
  const [list, setList] = useState(!compact);
  const [detailsOpen,setDetailsOpen]=useState(false);
  useCompactRecordingWindow(compact, list||detailsOpen);
  const [playing, setPlaying] = useState<RecordingSession | null>(null);
  const [playRange,setPlayRange]=useState<{start:number;samples:number}|undefined>();
  const [sourceSession,setSourceSession]=useState<string|null>(null);
  const [confirm, setConfirm] = useState<{
    session: RecordingSession;
    action: "delete-audio" | "queue" | "discard";
  } | null>(null);
  const [confirming,setConfirming]=useState(false);
  const confirmationPending=useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const capture = snapshot?.sessions.find((s) => s.id === snapshot.captureOwner);
  const active = capture && Boolean(capture.meeting) === meetingMode ? capture : undefined;
  const sessions = snapshot?.sessions.filter(session => Boolean(session.meeting) === meetingMode && session.id !== active?.id) ?? [];
  if (meetingMode) sessions.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const settings = active?.settings ?? draft ?? snapshot?.settings;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!embedded) titleRef.current?.focus();
    void recordingRequest<RecordingDevice[]>("devices")
      .then(setDevices)
      .catch(() => undefined);
    return () => {
      if (!embedded) previousFocus?.focus();
      void recordingRequest("preview-stop").catch(() => undefined);
    };
  }, []);
  async function update(next: RecordingSettings) {
    if (active) await command("inputs", { id: active.id, settings: next });
    else {
      setDraft(next);
      if (snapshot?.preview) await command("preview", { settings: next });
    }
  }
  async function stop() {
    if (!active) return;
    const next = await command("stop", { id: active.id });
    const session = next?.sessions.find((s) => s.id === active.id);
    if (session && !session.meeting && !session.destination) setDestination(session);
    setList(true);
  }
  async function openDocument(id: string) {
    if (onOpenDocument) onOpenDocument(id);
    else if (isTauriRuntime()) {
      await emit("recording-open-document", { id });
      const main = await WebviewWindow.getByLabel("main");
      await main?.show();
      await main?.setFocus();
    }
  }
  async function openMinutes(session:RecordingSession){
    if(onOpenMinutes&&session.destination){onOpenMinutes(session.id,session.destination.projectId);return;}
    if(isTauriRuntime()&&session.destination){await emit("recording-open-workspace",{view:"minutes",sessionId:session.id,projectId:session.destination.projectId});const main=await WebviewWindow.getByLabel("main");await main?.show();await main?.setFocus();}
  }
  const footer=(<div className={compact ? "recording-footer" : ""}>
        <button
          className={`${button} recording-history-toggle`}
          aria-controls="recording-session-list"
          aria-expanded={list}
          onClick={() => setList(!list)}
        >
          {compact ? copy.sessions : list ? copy.hideHistory : copy.showHistory} (
          {sessions.length + (snapshot?.unavailableSessions ?? 0)})
        </button>
        {compact && <>
          <button className={button} onClick={() => {if(onOpenSettings)onOpenSettings();else void openRecordingWorkspace("settings");}}>{copy.settings}</button>
          {!embedded&&<button className={button} onClick={() => void openRecordingWorkspace("recordings")}>{copy.openManager}</button>}
        </>}
        </div>);
  return (
    <section
      ref={panelRef}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (confirm) setConfirm(null);
          else if (destination) setDestination(null);
          else if (playing) setPlaying(null);
          else onClose?.();
        }
        if (e.key === "Tab") {
          const dialogs = panelRef.current?.querySelectorAll<HTMLElement>(
            '[role="dialog"],[role="alertdialog"]',
          );
          const root = dialogs?.length
            ? dialogs[dialogs.length - 1]
            : panelRef.current;
          const items = Array.from(
            root?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
            ) ?? [],
          ).filter((el) => el.getClientRects().length > 0);
          const first = items[0],
            last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
      data-compact={compact}
      data-embedded={embedded}
      className="recording-panel flex h-full max-h-[100dvh] flex-col bg-white text-ink-primary"
      aria-label={copy.title}
    >
      <header className={compact && !embedded ? "sr-only" : "flex shrink-0 items-center justify-between px-3 py-2"}>
        <h2
          ref={titleRef}
          data-autofocus={embedded || undefined}
          tabIndex={-1}
          className="flex items-center gap-2 text-lg font-semibold"
        >
          <Mic className="text-brand-orange" size={20} />
          {copy.title}
        </h2>
        {onClose && (
          <button
            className={button}
            aria-label={copy.closePanel}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        )}
      </header>
      <div className={compact ? "recording-body" : "min-h-0 flex-1 space-y-4 overflow-auto p-4"}>
        {compact && !settings && error && <p role="alert" className="text-xs leading-5">{error}</p>}
        {!compact&&<>
        {error && (
          <p role="alert" className="rounded-md bg-orange-50 p-3 text-sm">
            {error}
          </p>
        )}
        {snapshot?.warning && (
          <p role="status" className="text-sm">
            {snapshot.warning}
          </p>
        )}
        {snapshot?.settingsError&&<p role="alert" className="text-xs leading-5">{copy.settingsUnavailable}</p>}
        {!!snapshot?.unavailableSessions&&<p role="status" className="text-xs leading-5">{copy.unavailableSessions(snapshot.unavailableSessions)}</p>}
        </>}
        {settings && (
          <section
            className={compact ? "recording-controls" : "recording-controls space-y-4 rounded-lg border border-line p-4"}
            aria-label={copy.controls}
          >
            {meetingMode && !active && <label className="block text-sm font-semibold">
              {copy.meetingTitle}
              <input className="ui-field mt-1" value={startingName} maxLength={150}
                onChange={event => setStartingName(event.target.value)} disabled={!!busy || Boolean(capture)} />
            </label>}
            {meetingMode && capture && !active && <p role="status">{copy.otherCapture}</p>}
            <div className="recording-command-row flex items-center justify-between">
              <span className="text-sm font-semibold" role="status">
                {busy === "pause"
                  ? copy.pausing
                  : busy === "stop"
                    ? copy.stopping
                    : active
                      ? copy.statuses[active.status]
                      : snapshot?.preview
                        ? copy.preview
                        : snapshot?.settingsError?copy.settingsReview:copy.ready}
              </span>
              <span className="font-mono text-xl tabular-nums">
                {recordingTime(active?.samples ?? 0)}
              </span>
            <div className="recording-actions flex flex-wrap gap-2">
              {!active ? (
                <>
                  <Button variant="primary"
                    disabled={
                      !!busy ||
                      !!snapshot?.settingsError ||
                      (!settings.microphone && !settings.systemAudio) ||
                      snapshot?.captureOwner === "dictation" || Boolean(capture) ||
                      (meetingMode && !startingName.trim())
                    }
                    aria-label={copy.startRecording}
                    onClick={() =>
                      void command("start", meetingMode ? { settings, meetingTitle: startingName.trim() } : {
                        settings, destination: initialDestination ? { ...initialDestination, name: startingName } : null,
                      })
                    }
                  >
                    <Mic size={16} />
                    {compact ? copy.start : copy.startRecording}
                  </Button>

                </>
              ) : (
                <>
                  <button
                    disabled={
                      !!busy || (active.status !== "recording" && !settings.microphone && !settings.systemAudio)
                    }
                    className={button}
                    onClick={() =>
                      void command(
                        active.status === "recording" ? "pause" : "resume",
                        { id: active.id },
                      )
                    }
                  >
                    {active.status === "recording" ? (
                      <Pause size={16} />
                    ) : (
                      <Play size={16} />
                    )}{" "}
                    {active.status === "recording" ? copy.pause : copy.resume}
                  </button>
                  <button
                    disabled={!!busy}
                    className={`${button} bg-brand-orange text-white`}
                    onClick={() => void stop()}
                  >
                    <Square size={16} />
                    {copy.stop}
                  </button>
                </>
              )}
            </div>
            </div>
            <AudioInputs
              compact={compact}
              signalState={active?.status === "recording" || snapshot?.preview ? "live" : active ? "paused" : "untested"}
              settings={settings}
              devices={devices}
              levels={snapshot?.levels ?? [0, 0]}
              disabled={!!busy||(!active&&!!snapshot?.settingsError)}
              recording={active?.status === "recording"}
              onChange={(next) => void update(next)}
            />
            {!active && <div className="recording-preview">                  <button
                    disabled={!!busy||!!snapshot?.settingsError}
                    className={button}
                    onClick={() =>
                      void command(
                        snapshot?.preview ? "preview-stop" : "preview",
                        { settings },
                      )
                    }
                  >
                    {snapshot?.preview ? copy.stopPreview : copy.testLevels}
                  </button></div>}
            {!isTauriMobileRuntime() && active?.status!=="recording" && <button className="recording-refresh min-h-11 text-xs text-ink-secondary" onClick={()=>{void recordingRequest<RecordingDevice[]>("devices").then(setDevices).catch(()=>undefined);}}>{copy.refreshDevices}</button>}
            {!meetingMode && <p className="recording-destination flex items-center gap-2 text-xs text-ink-secondary">
              <FolderOpen size={15} />
              {(active?.destination ?? initialDestination)?.name ??
                copy.chooseOnStop}
            </p>}
            {!active && initialDestination && (
              <label className="block text-sm">
                {copy.documentName}
                <input
                  className="mt-1 min-h-11 w-full rounded border border-line px-2"
                  value={startingName}
                  onChange={(e) => setStartingName(e.target.value)}
                />
              </label>
            )}
            {active?.error && (
              <p role="alert" className="text-sm">
                {active.error}
              </p>
            )}
            <details className="recording-details text-xs text-ink-secondary" onToggle={event=>setDetailsOpen(event.currentTarget.open)}>
              <summary>{compact&&(error||snapshot?.warning||snapshot?.settingsError||snapshot?.unavailableSessions)?<span role="status">{snapshot?.settingsError?copy.settingsReview:copy.recordingWarning} · {copy.details}</span>:meetingMode ? copy.privateDetails : copy.localDetails}</summary>
              {compact&&<>
                {error&&<p role="alert">{error}</p>}
                {snapshot?.warning&&<p role="status">{snapshot.warning}</p>}
                {snapshot?.settingsError&&<p>{copy.settingsUnavailable}</p>}
                {!!snapshot?.unavailableSessions&&<p>{copy.unavailableSessions(snapshot.unavailableSessions)}</p>}
              </>}
            <p className="text-xs text-ink-secondary">
              {meetingMode ? copy.privateAudio : copy.audioPolicy}
            </p>
            {active && (
              <button
                className="recording-discard min-h-11 text-sm text-ink-secondary"
                disabled={!!busy}
                onClick={() =>
                  setConfirm({ session: active, action: "discard" })
                }
              >
                {copy.discard}
              </button>
            )}
              {active?.status === "recording" && <p>{copy.pauseToChange}</p>}
            </details>
          </section>
        )}
        {!compact&&footer}
        <div id="recording-session-list" className={compact ? "recording-session-list" : ""} hidden={!list}>
        {list&&!!snapshot?.unavailableSessions&&<p role="status" className="py-2 text-xs leading-5">{copy.unavailableSessions(snapshot.unavailableSessions)}</p>}
        {list &&
          sessions
            .map((s) => (
              <article
                key={s.id}
                className="space-y-3 rounded-lg border border-line p-4"
              >
                <div>
                  <h3 className="font-semibold">
                    {s.destination?.name ?? copy.untitled}
                  </h3>
                  <p className="text-xs text-ink-secondary">
                    {new Date(s.createdAt).toLocaleString(locale)} ·{" "}
                    {recordingTime(s.samples)} ·{" "}
                    {(s.bytes / 1024 / 1024).toFixed(1)} MiB
                  </p>
                </div>
                <StatusTag role="status" tone={s.status === "completed" ? "success" : s.status === "attention" ? "warning" : "neutral"}
                  activity={s.status === "transcribing" ? "working" : s.status === "queued" ? "waiting" : undefined}>
                  {copy.statuses[s.status]}
                  {s.portableOrigin && ` · ${copy.portable}`}
                  {s.status === "transcribing" && ` · ${copy.chunk(
                    Math.min(s.chunks.filter((c) => c.status === "completed").length + 1, s.chunks.length), s.chunks.length
                  )}`}
                </StatusTag>
                {meetingMode && s.status === "transcribing" && <ProgressBar label={copy.transcriptionProgress}
                  value={s.chunks.length ? 100 * s.chunks.filter(chunk => chunk.status === "completed").length / s.chunks.length : undefined} />}
                {s.error && (
                  <p className="text-sm text-orange-800">{s.error}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {!s.audioDeleted && (
                    <button className={button} onClick={() => {setPlayRange(undefined);setPlaying(s);}}>
                      <Volume2 size={16} />
                      {copy.listen}
                    </button>
                  )}
                  {s.documentId ? (
                    <button
                      className={button}
                      onClick={() => void openDocument(s.documentId!)}
                    >
                      {copy.openDocument}
                    </button>
                  ) : (
                    <>
                      {!meetingMode && !["transcribing", "queued"].includes(s.status) && (
                        <button
                          className={button}
                          onClick={() => setDestination(s)}
                        >
                          {copy.chooseFolder}
                        </button>
                      )}
                      {s.destination &&
                        !s.audioDeleted &&
                        !["transcribing", "queued"].includes(s.status) && (!meetingMode || s.status !== "completed") && (
                          <Button
                            disabled={!!busy}
                            onClick={() =>
                              meetingMode || s.chunks.some((c) => c.status === "unknown")
                                ? setConfirm({ session: s, action: "queue" })
                                : void command("queue", { id: s.id })
                            }
                          >
                            {meetingMode && s.status !== "attention" ? copy.transcribe : copy.retry}
                          </Button>
                        )}
                      {["transcribing", "queued"].includes(s.status) && (
                        <button
                          className={button}
                          onClick={() =>
                            void command("cancel-job", { id: s.id })
                          }
                        >
                          {copy.cancelJob}
                        </button>
                      )}
                    </>
                  )}
                  {!s.audioDeleted && (
                    <>
                      {!meetingMode && <button
                        className={button}
                        aria-pressed={s.keep}
                        onClick={() =>
                          void command("keep", { id: s.id, keep: !s.keep })
                        }
                      >
                        {s.keep ? copy.kept : copy.keep}
                      </button>}
                      <button
                        disabled={["transcribing", "queued"].includes(s.status)}
                        className={button}
                        aria-label={copy.deleteAudio}
                        onClick={() =>
                          setConfirm({ session: s, action: "delete-audio" })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
                {!["recording","paused","queued","transcribing"].includes(s.status)&&s.chunks.some(c=>c.status==="completed")&&<div className="flex flex-wrap gap-2"><button className={button} aria-expanded={sourceSession===s.id} onClick={()=>setSourceSession(current=>current===s.id?null:s.id)}>{copy.transcript}</button>{meetingMode
                  ? <Button variant="primary" onClick={() => onOpenSummary?.(s)}>{copy.meetingSummary}</Button>
                  : (s.destination&&(onOpenMinutes||isTauriRuntime()))&&<button className={button} onClick={()=>void openMinutes(s)}>{copy.minutes}</button>}</div>}
                {sourceSession===s.id&&<RecordingTranscriptPanel key={s.id} sessionId={s.id} onPublish={meetingMode ? onPublish : undefined}
                  onListen={segment=>{setPlayRange({start:segment.start,samples:segment.samples});setPlaying(s);}}/>}
                {s.documentId && (
                  <p className="break-all text-xs">
                    {copy.document} · {s.documentId.split("::").pop()}
                  </p>
                )}
                {s.cost && (
                  <details className="text-xs text-ink-secondary">
                    <summary>
                      {copy.estimate} ·{" "}
                      {s.cost.estimatedCostEur === null
                        ? `${s.cost.estimatedCostUsd.toFixed(4)} USD · ${copy.eurUnavailable}`
                        : `${s.cost.estimatedCostEur.toFixed(4)} €`}
                    </summary>
                    <p>
                      {s.cost.estimatedCostUsd.toFixed(4)} USD · 1 EUR ={" "}
                      {s.cost.exchangeRate.usdPerEur ?? "—"} USD · {copy.reference}{" "}
                      {s.cost.exchangeRate.date ?? copy.unavailable}.{" "}
                      {s.cost.exchangeRate.date &&
                      Date.now() - Date.parse(s.cost.exchangeRate.date) >
                        7 * 86400000
                        ? copy.staleRate
                        : ""}{" "}
                      {copy.retryCost}
                    </p>
                  </details>
                )}
                <p className="text-xs text-ink-secondary">
                  {s.audioDeleted
                    ? meetingMode ? copy.meetingDeleted : copy.documentRetained
                    : meetingMode || s.keep ||
                        !s.completedAt ||
                        s.settings.retentionDays === null
                      ? copy.noDeletion
                      : copy.deletion(new Date((s.completedAt + s.settings.retentionDays * 86400) * 1000).toLocaleString(locale))}
                </p>
              </article>
            ))}
        </div>
      </div>
      {compact&&footer}
      {destination && (
        <DestinationDialog
          session={destination}
          operationError={error}
          fallbackFocus={()=>titleRef.current}
          onCancel={() => setDestination(null)}
          onSave={async (d) => {
            const next = await command("destination", {
              id: destination.id,
              destination: d,
            });
            if (next) {
              await command("queue", { id: destination.id });
              setDestination(null);
            }
          }}
        />
      )}
      {playing && (
        <RecordingAudioPlayer session={playing} range={playRange} onClose={() => setPlaying(null)} />
      )}
      {confirm && (
        <ModalFrame label={copy.confirmAction} role="alertdialog" className="!z-[150] [&_button]:!min-h-11 [&_select]:!min-h-11 [&_input]:!min-h-11" fallbackFocus={()=>titleRef.current} onClose={()=>{if(!confirmationPending.current)setConfirm(null);}}>
          <section
            className="max-h-[calc(100dvh-24px)] w-full max-w-md space-y-4 overflow-y-auto rounded-lg bg-white p-4 text-sm [overflow-wrap:anywhere]"
          >
            <p>
              {confirm.action === "queue" && (confirm.session.chunks.some(chunk => chunk.status === "unknown")
                ? copy.confirmRetry
                : copy.confirmSend)}
              {confirm.action !== "queue" && (meetingMode ? copy.confirmMeetingDeletion : copy.confirmDeletion)}
            </p>
            <div className="flex gap-2">
              <button
                data-autofocus
                disabled={confirming}
                className={button}
                onClick={() => {if(!confirmationPending.current)setConfirm(null);}}
              >
                {copy.cancel}
              </button>
              <button
                className={button}
                disabled={confirming}
                onClick={async (event) => {
                  if(confirmationPending.current)return;
                  (event.currentTarget.closest('[role="alertdialog"]') as HTMLElement|null)?.focus({preventScroll:true});
                  confirmationPending.current=true;setConfirming(true);
                  try {
                    await command(confirm.action, {id:confirm.session.id,confirmUnknown:true,confirmed:true});
                    setConfirm(null);
                  } finally {confirmationPending.current=false;setConfirming(false);}
                }}
              >
                {copy.confirm}
              </button>
            </div>
          </section>
        </ModalFrame>
      )}
    </section>
  );
}
export function AudioInputs({
  compact = false,
  signalState = "live",
  settings,
  devices,
  levels,
  disabled,
  recording,
  onChange,
}: {
  compact?: boolean;
  signalState?: "live" | "paused" | "untested";
  settings: RecordingSettings;
  devices: RecordingDevice[];
  levels: [number, number];
  disabled: boolean;
  recording: boolean;
  onChange: (s: RecordingSettings) => void;
}) {
  const { copy } = useRecordingCopy();
  return (
      <div className={compact ? "recording-inputs" : "space-y-3"}>
      {([0, 1] as const)
        .filter((i) => i === 0 || !isTauriMobileRuntime())
        .map((index) => {
          const enabled =
            index === 0 ? settings.microphone : settings.systemAudio;
          const name = index === 0 ? copy.microphone : copy.systemAudio;
          const field = index === 0 ? "microphoneDevice" : "outputDevice";
          const level = signalState === "live" && enabled ? Math.max(0, Math.min(100, Math.round(levels[index] * 100))) : 0;
          return (
            <div key={index} className={compact ? "recording-source" : "rounded-md border border-line p-3"}>
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
                <span className={compact ? "sr-only" : ""}>{name}</span>
                {compact && <span aria-hidden="true">{index === 0 ? <Mic size={16}/> : <Volume2 size={16}/>}</span>}
                <input
                  type="checkbox"
                  role="switch"
                  checked={enabled}
                  disabled={disabled}
                  className={compact ? "" : "h-5 w-5 accent-brand-orange"}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      [index === 0 ? "microphone" : "systemAudio"]:
                        e.target.checked,
                    })
                  }
                />
              </label>
              <select
                aria-label={copy.device(name)}
                value={settings[field] ?? ""}
                disabled={disabled || recording}
                className="min-h-11 w-full rounded border border-line bg-white px-2 text-sm"
                onChange={(e) =>
                  onChange({ ...settings, [field]: e.target.value || null })
                }
              >
                <option value="">{copy.defaultDevice}</option>
                {devices
                  .filter(
                    (d) => d.kind === (index === 0 ? "microphone" : "system"),
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
              <div
                className="recording-meter mt-2 flex items-center gap-2"
                role="meter"
                aria-label={copy.level(name)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={level}
                aria-valuetext={!enabled ? copy.disabled : signalState === "paused" ? copy.statuses.paused : signalState === "untested" ? copy.untested : `${level} %`}
              >
                <div aria-hidden="true" className="flex flex-1 gap-1">
                  {Array.from({ length: compact ? 8 : 16 }, (_, i) => (
                    <span
                      key={i}
                      className={`h-3 flex-1 rounded-sm ${enabled && level > i * (compact ? 12.5 : 6) ? "bg-brand-orange" : "bg-gray-200"}`}
                    />
                  ))}
                </div>
                <span className="min-w-16 text-xs text-ink-secondary">
                  {!enabled
                    ? copy.disabled
                    : signalState !== "live" ? (compact ? "—" : signalState === "paused" ? copy.statuses.paused : copy.untested)
                    : level
                      ? `${level} %`
                      : copy.noSignal}
                </span>
              </div>
            </div>
          );
        })}
    </div>
  );
}
function folders(
  nodes: DocumentTreeNode[],
  prefix = "",
): { id: string; label: string }[] {
  return nodes.flatMap((n) =>
    n.type === "folder"
      ? [
          { id: n.id, label: prefix + n.name },
          ...folders(n.children ?? [], prefix + n.name + " / "),
        ]
      : [],
  );
}
function DestinationDialog({
  session,
  onSave,
  onCancel,
  operationError,
  fallbackFocus,
}: {
  session: RecordingSession;
  onSave: (d: RecordingDestination) => Promise<void>;
  onCancel: () => void;
  operationError?:string|null;
  fallbackFocus?:()=>HTMLElement|null;
}) {
  const { copy } = useRecordingCopy();
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tree, setTree] = useState<DocumentTreeNode[]>([]);
  const [project, setProject] = useState(session.destination?.projectId ?? "");
  const [folder, setFolder] = useState(session.destination?.folderId ?? "");
  const [name, setName] = useState(
    session.destination?.name ??
      `${copy.meeting} ${session.createdAt.slice(0, 16).replace(/:/g, "-")}.md`,
  );
  const [issue, setIssue] = useState<{ cause: unknown } | null>(null);
  const error = issue ? runtimeErrorMessage(issue.cause, copy.destinationFailed) : null;
  const [saving, setSaving] = useState(false);
  const savePending=useRef(false);
  useEffect(() => {
    void listProjects()
      .then(setProjects)
      .catch((cause) => setIssue({ cause }));
  }, []);
  useEffect(() => {
    let live = true;
    setTree([]);
    if (project)
      void getProjectTree(project)
        .then((t) => {
          if (live) setTree(t);
        })
        .catch((cause) => {if(live)setIssue({ cause });});
    return () => {
      live = false;
    };
  }, [project]);
  return (
    <ModalFrame label={copy.destination} className="!z-[150] [&_button]:!min-h-11 [&_select]:!min-h-11 [&_input]:!min-h-11" fallbackFocus={fallbackFocus} onClose={()=>{if(!savePending.current)onCancel();}}>
      <form
        className="flex max-h-[calc(100dvh-24px)] w-full min-w-0 max-w-md flex-col overflow-hidden rounded-lg bg-white"
        onSubmit={async (e) => {
          e.preventDefault();
          if(savePending.current)return;
          (e.currentTarget.closest('[role="dialog"]') as HTMLElement|null)?.focus({preventScroll:true});
          savePending.current=true;setSaving(true);setIssue(null);
          try {
            await onSave({
              projectId: project,
              folderId: folder || null,
              name,
            });
          } catch(cause) {setIssue({ cause });} finally {
            savePending.current=false;setSaving(false);
          }
        }}
      >
        <header className="shrink-0 px-4 pt-4 pb-2"><h3 className="font-semibold">{copy.saveTranscript}</h3>
        <p className="mt-1 text-sm">{copy.recordingSaved}</p></header>
        <div className="min-h-0 space-y-3 overflow-y-auto px-4 py-2 [overflow-wrap:anywhere]">
        {(error||operationError) && <p role="alert" className="text-sm text-red-700">{error||operationError}</p>}
        <label className="block text-sm">
          {copy.project}
          <select
            data-autofocus
            disabled={saving}
            required
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setFolder("");
            }}
            className="mt-1 min-h-11 w-full rounded border border-line bg-white px-2"
          >
            <option value="">{copy.chooseProject}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!projects.length && (
          <p className="text-sm">
            {copy.audioRetained}
            <button
              type="button"
              disabled={saving}
              className={button}
              onClick={async () => {
                await emit("recording-create-project");
                const main = await WebviewWindow.getByLabel("main");
                await main?.show();
                await main?.setFocus();
                onCancel();
              }}
            >
              {copy.createProject}
            </button>
          </p>
        )}
        <label className="block text-sm">
          {copy.folder}
          <select
            disabled={saving}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-line bg-white px-2"
          >
            <option value="">{copy.projectRoot}</option>
            {folders(tree).map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {copy.name}
          <input
            required
            maxLength={150}
            disabled={saving}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-line px-2"
          />
        </label>
        </div>
        <footer className="flex shrink-0 flex-wrap gap-2 px-4 py-3 [&>button]:min-w-0 [&>button]:flex-1">
          <button type="button" disabled={saving} className={button} onClick={()=>{if(!savePending.current)onCancel();}}>
            {copy.cancel}
          </button>
          <button
            disabled={saving || !project}
            className={`${button} bg-brand-orange text-white`}
          >
            {saving ? copy.saving : copy.transcribeSave}
          </button>
        </footer>
      </form>
    </ModalFrame>
  );
}
