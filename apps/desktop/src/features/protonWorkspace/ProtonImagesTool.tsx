import { needsOperationCheck, useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { StatusTag, type StatusTone } from "../../components/ui/StatusTag";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { generateProtonImage, uploadProtonImageContent, type ProtonGeneratedImage } from "../../lib/api/protonImageAssets";
import type { ProtonDocumentToolProps, ProtonToolTarget } from "./protonToolTypes";
import { AiHistoryRetentionOption } from "../assistant/AiHistoryRetentionOption";
import { useProtonDocumentAiCopy } from "../assistant/protonDocumentAiCopy";

type Preview = { image: ProtonGeneratedImage; target: ProtonToolTarget };
type Notice = { tone: StatusTone; text: string } | { tone: "error"; cause: unknown; step: "generate" | "upload" };

function sameDocumentVersion(target: ProtonToolTarget, current: ProtonToolTarget | null) {
  return current !== null
    && target.address.accountId === current.address.accountId
    && target.address.rootId === current.address.rootId
    && target.address.nodeId === current.address.nodeId
    && target.editorKey === current.editorKey
    && target.baseRevisionId === current.baseRevisionId
    && target.markdown === current.markdown;
}

export function ProtonImagesTool({ available, capture, apply, onCheckAiUsage }: ProtonDocumentToolProps) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const { images: c, historyWarning: historyWarningCopy } = useProtonDocumentAiCopy();
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"generating" | "uploading" | null>(null);
  const [message, setMessage] = useState<Notice | null>(null);
  const [stale, setStale] = useState(false);
  const [retainHistory, setRetainHistory] = useState(false);
  const [historyWarning, setHistoryWarning] = useState(false);
  const pending = useRef(false);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !available || !prompt.trim()) return;
    const target = capture();
    if (!target) return;
    pending.current = true;
    setBusy("generating");
    setMessage(null);
    setHistoryWarning(false);
    setRetainHistory(false);
    try {
      const image = await generateProtonImage(target.address, target.baseRevisionId, prompt.trim(), retainHistory);
      setPreview({ image, target });
      setStale(false);
      setHistoryWarning(retainHistory && image.historySaved !== true);
      if (!image.usageRecorded) setMessage({ tone: "warning", text: c.usage });
    } catch (cause) {
      setMessage({ tone: "error", cause, step: "generate" });
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function insert(useCurrent: boolean) {
    if (pending.current || !available || !preview) return;
    const current = capture();
    const target = useCurrent ? current : preview.target;
    if (!target || !sameDocumentVersion(target, current)) {
      setStale(true);
      setMessage({ tone: "warning", text: c.stale });
      return;
    }
    pending.current = true;
    setBusy("uploading");
    setMessage(null);
    try {
      const path = await uploadProtonImageContent(target.address, preview.image.contentBase64);
      if (!apply(target, { kind: "insert_at", markdown: `![${c.outputAlt}](${path})` })) {
        setStale(true);
        setMessage({ tone: "warning", text: c.uploadStale });
        return;
      }
      setPreview(null);
      setStale(false);
      setMessage({ tone: "success", text: c.inserted });
    } catch (cause) {
      setMessage({ tone: "error", cause, step: "upload" });
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return <div className="space-y-3">
    <form className="space-y-2" onSubmit={event => void generate(event)}>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {c.describe}
        <textarea className="ui-field" value={prompt} rows={3} maxLength={4000} onChange={event => setPrompt(event.target.value)} />
      </label>
      <AiHistoryRetentionOption checked={retainHistory} onChange={setRetainHistory} disabled={!available || busy !== null} />
      <Button variant="primary" type="submit" disabled={!available || !prompt.trim() || busy !== null}>
        {busy === "generating" ? c.generating : c.generate}
      </Button>
    </form>
    {busy && <div className="space-y-2">
      <StatusTag role="status" activity="working">{busy === "generating" ? c.working : c.uploading}</StatusTag>
      <ProgressBar label={busy === "generating" ? c.generationProgress : c.uploadProgress} />
    </div>}
    {preview && <div className="space-y-2">
      <img className="max-h-64 w-full rounded-2xl border border-line object-contain" alt={c.preview}
        src={`data:${preview.image.contentType};base64,${preview.image.contentBase64}`} />
      <Button disabled={!available || busy !== null} onClick={() => void insert(stale)}>
        {busy === "uploading" ? c.uploadingShort : stale ? c.useCurrent : c.upload}
      </Button>
    </div>}
    {message && <InlineNotice tone={message.tone} announce={message.tone === "error" ? "alert" : "status"}
      action={"cause" in message && message.step === "generate" && needsOperationCheck(message.cause) && onCheckAiUsage
        ? <Button size="compact" onClick={onCheckAiUsage}>{c.checkUsage}</Button> : undefined}>
      {"cause" in message ? runtimeErrorMessage(message.cause, message.step === "generate" ? c.failed : c.uploadFailed) : message.text}
    </InlineNotice>}
    {historyWarning && <InlineNotice tone="warning" announce="status">{historyWarningCopy}</InlineNotice>}
  </div>;
}
