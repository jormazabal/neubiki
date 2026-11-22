import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { quoteProtonBatchEdit, runProtonBatchEdit, type BatchEditFile, type BatchEditInput, type BatchEditProposal, type BatchEditQuote, type BatchEditTask } from "../../lib/api/protonBatchEdit";
import type { ProtonReplacementSuggestionAnchor } from "../../lib/api/protonReplacementSuggestion";
import { useUiLocale } from "../../lib/i18n/UiLocale";

export const batchEditCopy = {
  es: {
    title: "Editar documentos con IA", choice: "Operación", clarity: "Mejorar la redacción", translate: "Traducir",
    language: "Idioma de destino", files: "Documentos seleccionados", close: "Cerrar",
    help: "OpenAI recibirá el texto guardado de dos o tres documentos Markdown de hasta 4 KiB cada uno. Revisa el coste antes de confirmar el envío.",
    review: "Revisar coste", confirm: "Confirmar y pedir propuestas", estimate: "Estimación",
    loading: "Comprobando revisiones y presupuesto…", working: "Preparando propuestas…",
    reviewFailed: "No se pudo revisar el lote.", unknown: "Comprueba el consumo antes de volver a enviar este lote.",
    proposed: "Propuesta disponible", unchanged: "El documento sigue igual", unavailable: "Sin propuesta compatible",
    prepared: "Borrador preparado", comparison: "Revisar propuestas de IA",
    choose: "Elige las propuestas que quieres comparar", compare: "Comparar propuestas", offline: "Conecta con Proton para comprobar las revisiones.",
    ledger: "No se pudo confirmar el registro de consumo.",
    selectionHelp: "Selecciona dos o tres documentos Markdown guardados.",
  },
  en: {
    title: "Edit documents with AI", choice: "Operation", clarity: "Improve wording", translate: "Translate",
    language: "Target language", files: "Selected documents", close: "Close",
    help: "OpenAI receives the saved text of two or three Markdown documents, up to 4 KiB each. Review the estimate before confirming.",
    review: "Review cost", confirm: "Confirm and request proposals", estimate: "Estimate",
    loading: "Checking revisions and budget…", working: "Preparing proposals…",
    reviewFailed: "The batch could not be reviewed.", unknown: "Check usage before submitting this batch again.",
    proposed: "Proposal available", unchanged: "Document unchanged", unavailable: "No compatible proposal",
    prepared: "Draft prepared", comparison: "Review AI proposals",
    choose: "Select the proposals to compare", compare: "Compare proposals", offline: "Connect to Proton to check saved revisions.",
    ledger: "Usage recording could not be confirmed.",
    selectionHelp: "Select two or three saved Markdown documents.",
  },
} as const;

const languages = { en: "English", es: "Español", eu: "Euskara", fr: "Français" } as const;

function sameFiles(reply: BatchEditFile[], expected: BatchEditFile[]) {
  return Array.isArray(reply) && reply.length === expected.length && reply.every((file, index) =>
    file.nodeId === expected[index].nodeId && file.revisionId === expected[index].revisionId && file.name === expected[index].name);
}

export function ProtonBatchEditDialog({ anchor, files, connected, onClose, onPending, onCompare, preparedIds = [] }: {
  anchor: ProtonReplacementSuggestionAnchor;
  files: BatchEditFile[];
  connected: boolean;
  onClose: () => void;
  onPending?: (pending: boolean) => void;
  onCompare: (input: BatchEditInput, proposals: BatchEditProposal[]) => void;
  preparedIds?: string[];
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const locale = useUiLocale();
  const t = batchEditCopy[locale];
  const [task, setTask] = useState<BatchEditTask>({ task: "clarity" });
  const [quote, setQuote] = useState<BatchEditQuote>();
  const [result, setResult] = useState<Awaited<ReturnType<typeof runProtonBatchEdit>>>();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const active = useRef(false);
  const input: BatchEditInput = { ...anchor, ...task, documents: files };
  const pendingSelection = selected.filter(id => !preparedIds.includes(id));

  function change(next: BatchEditTask) {
    setTask(next);
    setQuote(undefined);
    setError("");
  }

  async function requestQuote() {
    if (!connected || active.current || sent) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await quoteProtonBatchEdit(input);
      if (!sameFiles(response.documents, files) || !/^[a-f0-9]{64}$/.test(response.quoteId)
        || !response.model || !Number.isFinite(response.estimatedEur) || response.estimatedEur < 0
        || !Number.isSafeInteger(response.issuedAt) || !Number.isSafeInteger(response.expiresAt)) throw new Error(t.reviewFailed);
      setQuote(response);
    } catch (cause) {
      setError(runtimeErrorMessage(cause, t.reviewFailed));
    } finally { active.current = false; setBusy(false); }
  }

  async function run() {
    if (!connected || !quote || active.current || sent) return;
    active.current = true;
    onPending?.(true);
    setBusy(true);
    setSent(true);
    setError("");
    try {
      const response = await runProtonBatchEdit(input, quote);
      if (!sameFiles(response.documents, files) || typeof response.usageRecorded !== "boolean"
        || response.documents.some(item => !["proposed", "unchanged", "unavailable"].includes(item.status)
          || (item.status === "proposed" && (typeof item.after !== "string" || !/^[a-f0-9]{64}$/.test(item.baseDigest))))) throw new Error(t.unknown);
      setResult(response);
    } catch (cause) {
      setError(runtimeErrorMessage(cause, t.unknown));
    } finally { active.current = false; onPending?.(false); setBusy(false); }
  }

  const close = () => { if (!active.current) onClose(); };
  return <ModalFrame label={t.title} onClose={close} className="!z-[90]">
    <section className="proton-confirm-dialog space-y-3 p-4">
      <DialogHeading title={t.title} closeLabel={t.close} onClose={close} busy={busy} />
      <p className="text-sm text-ink-secondary">{t.help}</p>
      {!result && <ul aria-label={t.files} className="space-y-1 text-sm">{files.map(file => <li key={file.nodeId} className="break-words">{file.name}</li>)}</ul>}
      <fieldset disabled={busy || sent} className="flex flex-wrap gap-3">
        <label className="grid flex-1 gap-1 text-sm">{t.choice}
          <select className="ui-field" data-autofocus value={task.task}
            onChange={event => change(event.target.value === "translate" ? { task: "translate", language: locale === "es" ? "en" : "es" } : { task: "clarity" })}>
            <option value="clarity">{t.clarity}</option><option value="translate">{t.translate}</option>
          </select>
        </label>
        {task.task === "translate" && <label className="grid flex-1 gap-1 text-sm">{t.language}
          <select className="ui-field" value={task.language} onChange={event => change({ task: "translate", language: event.target.value as keyof typeof languages })}>
            {Object.entries(languages).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>}
      </fieldset>
      {!connected && <InlineNotice tone="warning">{t.offline}</InlineNotice>}
      {error && <InlineNotice tone="error" announce="alert">{error}{sent && error !== t.unknown && <p>{t.unknown}</p>}</InlineNotice>}
      {busy && <p role="status" className="text-sm">{sent ? t.working : t.loading}</p>}
      {quote && !sent && <p className="rounded-xl bg-panel p-3 text-sm">{quote.model} · {t.estimate} {new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 4 }).format(quote.estimatedEur)}</p>}
      {result && <>
        {!result.usageRecorded && <InlineNotice tone="warning">{t.ledger}</InlineNotice>}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t.choose}</legend>
          {result.documents.map(item => <label key={item.nodeId} className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" disabled={item.status !== "proposed" || preparedIds.includes(item.nodeId)} checked={pendingSelection.includes(item.nodeId)}
              onChange={event => setSelected(previous => event.target.checked ? [...previous, item.nodeId] : previous.filter(id => id !== item.nodeId))} />
            <span className="break-words">{item.name} · {preparedIds.includes(item.nodeId) ? t.prepared : t[item.status]}</span>
          </label>)}
        </fieldset>
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={busy} onClick={close}>{t.close}</Button>
        {!quote && !sent && <Button variant="primary" disabled={!connected || busy} onClick={() => void requestQuote()}>{t.review}</Button>}
        {quote && !sent && <Button variant="primary" disabled={!connected || busy} onClick={() => void run()}>{t.confirm}</Button>}
        {result && <Button variant="primary" disabled={!connected || !pendingSelection.length}
          onClick={() => onCompare(input, result.documents.filter(item => pendingSelection.includes(item.nodeId) && item.status === "proposed"))}>{t.compare}</Button>}
      </div>
    </section>
  </ModalFrame>;
}
