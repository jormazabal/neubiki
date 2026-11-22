import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useRef, useState } from "react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { Button } from "../../components/ui/Button";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import {
  reviewProtonReplacementSuggestion, runProtonReplacementSuggestion,
  type ProtonReplacementSuggestionAnchor, type ProtonReplacementSuggestionSource, type ProtonReplacementSuggestionQuote,
} from "../../lib/api/protonReplacementSuggestion";
import { useUiLocale } from "../../lib/i18n/UiLocale";

export const replacementSuggestionCopy = {
  es: {
    title: "Sugerir reemplazo con IA", close: "Cerrar",
    chooseSources: "Para una sugerencia con IA, marca dos o tres documentos guardados distintos del activo.",
    help: "Elige dos o tres resultados Markdown guardados distintos del documento activo. OpenAI recibirá el texto buscado, tu indicación y hasta tres fragmentos por archivo para proponer una frase común.",
    applies: "La frase se copia al campo de reemplazo. Puedes editarla y revisar cada borrador antes de prepararlo.",
    label: "Qué quieres conseguir con el reemplazo", review: "Revisar coste", send: "Confirmar y solicitar propuesta",
    reviewing: "Comprobando revisiones y presupuesto…", waiting: "Solicitando propuesta…",
    failed: "No se pudo revisar la propuesta.", uncertain: "La propuesta quedó sin confirmar. Comprueba el consumo antes de solicitar otra.",
    estimate: "Estimación", model: "Modelo", result: "Frase propuesta", use: "Usar en el campo de reemplazo",
    usage: "El consumo de esta solicitud no se pudo registrar.",
    offline: "Conecta con Proton para comprobar las revisiones guardadas.",
  },
  en: {
    title: "Suggest a replacement with AI", close: "Close",
    chooseSources: "For an AI suggestion, select two or three saved documents other than the active one.",
    help: "Select two or three saved Markdown results other than the active document. OpenAI will receive the search term, your instructions and up to three excerpts per file to suggest a shared phrase.",
    applies: "The phrase goes into the replacement field. You can edit it and review each draft before preparing it.",
    label: "What should the replacement achieve?", review: "Review cost", send: "Confirm and request suggestion",
    reviewing: "Checking revisions and budget…", waiting: "Requesting suggestion…",
    failed: "The suggestion could not be reviewed.", uncertain: "The suggestion is unconfirmed. Check AI usage before requesting another one.",
    estimate: "Estimate", model: "Model", result: "Suggested phrase", use: "Use in replacement field",
    usage: "Usage for this request could not be recorded.",
    offline: "Connect to Proton to verify the saved revisions.",
  },
} as const;

export function ProtonReplacementSuggestion({ anchor, query, sources, connected = true, onUse, onClose, onPending }: {
  anchor: ProtonReplacementSuggestionAnchor; query: string; sources: ProtonReplacementSuggestionSource[];
  connected?: boolean;
  onUse: (replacement: string) => void; onClose: () => void; onPending?: (pending: boolean) => void;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const language = useUiLocale();
  const t = replacementSuggestionCopy[language];
  const [intent, setIntent] = useState("");
  const [quote, setQuote] = useState<ProtonReplacementSuggestionQuote>();
  const [reply, setReply] = useState<{ replacement: string; usageRecorded: boolean }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const active = useRef(false);
  const input = { ...anchor, query, intent: intent.trim(), sources: sources.map(({ nodeId, revisionId }) => ({ nodeId, revisionId })) };
  const canReview = input.intent.length > 0 && new TextEncoder().encode(input.intent).length <= 1024;

  async function review() {
    if (!connected || active.current || !canReview || sent) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await reviewProtonReplacementSuggestion(input);
      if (!result.quoteId || !result.model || !Number.isFinite(result.estimatedEur) || result.estimatedEur < 0
        || result.sourceNames.length !== sources.length
        || result.sourceNames.some((name, index) => name !== sources[index].name)) throw new Error(t.failed);
      setQuote(result);
    } catch (cause) { setError(runtimeErrorMessage(cause, t.failed)); }
    finally { active.current = false; setBusy(false); }
  }

  async function run() {
    if (!connected || active.current || !quote || sent) return;
    active.current = true;
    onPending?.(true);
    setBusy(true);
    setSent(true);
    setError("");
    try {
      const result = await runProtonReplacementSuggestion(input, quote.quoteId);
      if (!result.replacement.trim() || typeof result.usageRecorded !== "boolean") throw new Error(t.uncertain);
      setReply(result);
    } catch (cause) { setError(runtimeErrorMessage(cause, t.uncertain)); }
    finally { active.current = false; onPending?.(false); setBusy(false); }
  }
  const close = () => { if (!active.current) onClose(); };

  return <ModalFrame label={t.title} onClose={close} className="!z-[90]">
    <section className="proton-confirm-dialog space-y-3 p-4">
      <DialogHeading title={t.title} busy={busy} closeLabel={t.close} onClose={close} />
      <p className="text-sm text-ink-secondary">{t.help}</p>
      <ul className="space-y-1 text-sm">{sources.map(source => <li key={source.nodeId} className="break-words">{source.name}</li>)}</ul>
      <label className="grid gap-1 text-sm font-medium">{t.label}
        <input className="ui-field" data-autofocus value={intent} maxLength={1024} disabled={busy || sent}
          onChange={event => { setIntent(event.target.value); setQuote(undefined); setError(""); }} />
      </label>
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {!connected && <InlineNotice tone="warning">{t.offline}</InlineNotice>}
      {busy && <p role="status" className="text-sm">{sent ? t.waiting : t.reviewing}</p>}
      {quote && !reply && <dl className="grid grid-cols-[auto_1fr] gap-2 rounded-xl bg-panel p-3 text-sm">
        <dt>{t.model}</dt><dd>{quote.model}</dd>
        <dt>{t.estimate}</dt><dd>{new Intl.NumberFormat(language, { style: "currency", currency: "EUR", maximumFractionDigits: 4 }).format(quote.estimatedEur)}</dd>
      </dl>}
      {reply && <>
        {!reply.usageRecorded && <InlineNotice tone="warning">{t.usage}</InlineNotice>}
        <div className="rounded-xl border border-line p-3 text-sm"><h3 className="font-medium">{t.result}</h3>
          <p className="break-words">{reply.replacement}</p>
        </div>
        <p className="text-xs text-ink-secondary">{t.applies}</p>
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={busy} onClick={close}>{t.close}</Button>
        {!quote && !sent && <Button variant="primary" disabled={!connected || !canReview || busy} onClick={() => void review()}>{t.review}</Button>}
        {quote && !sent && <Button variant="primary" disabled={!connected || busy} onClick={() => void run()}>{t.send}</Button>}
        {reply && <Button variant="primary" onClick={() => onUse(reply.replacement)}>{t.use}</Button>}
      </div>
    </section>
  </ModalFrame>;
}
