import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { transcribeProtonDictation } from "../../lib/api/protonDictation";
import type { AiTranscriptionLanguage } from "../../types/domain";
import type { ProtonToolTarget } from "../protonWorkspace/protonToolTypes";
import { ProtonAudioCapture } from "../transcription/ProtonAudioCapture";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonAssistantCopy } from "./protonAssistantCopy";

const languages: readonly [Exclude<AiTranscriptionLanguage, "auto">, string, string][] = [
  ["es", "Español", "Spanish"], ["eu", "Euskera", "Basque"], ["en", "Inglés", "English"], ["ca", "Catalán", "Catalan"],
  ["gl", "Gallego", "Galician"], ["fr", "Francés", "French"], ["de", "Alemán", "German"], ["it", "Italiano", "Italian"], ["pt", "Portugués", "Portuguese"],
];

export function ProtonDictationDialog({ target, defaultLanguage, canInsert, onInsert, onUsePrompt, onClose }: {
  target: ProtonToolTarget;
  defaultLanguage: AiTranscriptionLanguage;
  canInsert: boolean;
  onInsert: (text: string) => Promise<boolean>;
  onUsePrompt: (text: string) => void;
  onClose: () => void;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const locale = useUiLocale();
  const copy = protonAssistantCopy[locale].dictation;
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState(defaultLanguage);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [usageWarning, setUsageWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const pending = useRef(false);

  function acceptClip(clip: File | null) {
    setFile(clip);
    setTranscript(null);
    setError("");
    setUsageWarning(false);
    setAttempted(false);
  }

  async function transcribe() {
    if (!file || pending.current || attempted) return;
    pending.current = true;
    setBusy(true);
    setAttempted(true);
    setError("");
    try {
      const result = await transcribeProtonDictation(target.address, target.baseRevisionId, file, language);
      setFile(null);
      setUsageWarning(result.usageRecorded !== true);
      setTranscript(result.transcript);
      if (!result.transcript?.trim()) setError(copy.noText);
    } catch (cause) {
      setError(runtimeErrorMessage(cause, copy.uncertain));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function insert() {
    const text = transcript?.trim();
    if (!text || !canInsert || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!await onInsert(text)) setError(copy.stale);
    } catch {
      setError(copy.destinationError);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return createPortal(<ModalFrame label={copy.title} onClose={() => { if (!pending.current) onClose(); }}>
    <section className="proton-confirm-dialog space-y-3 p-4">
      <DialogHeading title={copy.title} closeLabel={copy.close} busy={busy} onClose={onClose} />
      <p className="text-sm text-ink-secondary">{copy.description}</p>
      <ProtonAudioCapture disabled={busy} onClip={acceptClip} />
      <label className="grid gap-1 text-sm">{copy.language}
        <select className="ui-field" value={language} disabled={busy} onChange={event => setLanguage(event.target.value as AiTranscriptionLanguage)}>
          <option value="auto">{copy.detect}</option>
          {languages.map(([code, spanish, english]) => <option key={code} value={code}>{locale === "en" ? english : spanish}</option>)}
        </select>
      </label>
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {usageWarning && <InlineNotice tone="warning" announce="status">{copy.usage}</InlineNotice>}
      {busy && <p role="status" className="text-sm">{copy.processing}</p>}
      {transcript !== null && <label className="grid gap-1 text-sm font-medium">{copy.review}
        <textarea rows={6} className="ui-field resize-y" value={transcript} disabled={busy}
          onChange={event => setTranscript(event.target.value)} />
      </label>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={busy}>{copy.close}</Button>
        {file && !attempted && <Button variant="primary" disabled={busy} onClick={() => void transcribe()}>{copy.send}</Button>}
        {transcript?.trim() && <>
          {canInsert && <Button disabled={busy} onClick={() => void insert()}>{copy.insert}</Button>}
          <Button variant="primary" disabled={busy} onClick={() => onUsePrompt(transcript.trim())}>{copy.add}</Button>
        </>}
      </div>
    </section>
  </ModalFrame>, document.body);
}
