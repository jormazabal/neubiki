import { useEffect, useRef, useState, type FormEvent } from "react";
import { getApiErrorMessage } from "../../lib/api/client";
import { getAiConfig } from "../../lib/api/config";
import { requestProtonText } from "../../lib/api/protonText";
import type { ProtonTextRequest } from "../../types/protonText";
import { ReadonlyMarkdownViewer } from "../editor/ReadonlyMarkdownViewer";
import type {
  ProtonDocumentToolProps,
  ProtonToolEdit,
  ProtonToolTarget,
} from "../protonWorkspace/protonToolTypes";

type Scope = Extract<ProtonTextRequest, { kind: "translate" }>["scope"];
type Proposal = { target: ProtonToolTarget; edit: ProtonToolEdit };
type State =
  | { phase: "idle" | "loading" }
  | { phase: "review" | "stale" | "checking"; proposal: Proposal; message?: string }
  | { phase: "error" | "status"; message: string };

const languages = [
  "Alemán", "Catalán", "Español", "Euskera", "Francés", "Gallego", "Inglés", "Italiano", "Portugués",
];
const fieldClass = "min-h-11 w-full rounded-md border border-line bg-white px-2 text-sm";
const buttonClass = "min-h-11 rounded-md px-3 text-sm font-medium disabled:opacity-50";
const primaryClass = buttonClass + " bg-brand-orange text-white hover:bg-brand-dark";

export function ProtonTranslation({ available, capture, apply }: ProtonDocumentToolProps) {
  const [scope, setScope] = useState<Scope | "">("");
  const [language, setLanguage] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const inFlight = useRef<AbortController | null>(null);
  const currentEditor = useRef({ available, apply });
  currentEditor.current = { available, apply };
  useEffect(() => () => inFlight.current?.abort(), []);

  async function translate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || !scope || !language || inFlight.current) return;

    const target = capture();
    if (!target) {
      setState({ phase: "error", message: "Abre un documento Markdown para traducir." });
      return;
    }

    const selection = target.selection;
    const markdown = scope === "document"
      ? target.markdown
      : selection && selection.from < selection.to ? selection.markdown : "";
    if (!markdown.trim()) {
      setState({
        phase: "error",
        message: scope === "selection"
          ? "Selecciona texto en el editor y vuelve a pulsar Traducir."
          : "El documento está vacío.",
      });
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setState({ phase: "loading" });
    try {
      const result = await requestProtonText({
        ...target.address,
        baseRevisionId: target.baseRevisionId,
        kind: "translate",
        language,
        scope,
        markdown,
      }, controller.signal);
      if (controller.signal.aborted) return;

      const kind = scope === "selection" ? "replace_range" : "replace_document";
      if (result?.kind !== kind || typeof result.text !== "string" || !result.text.trim()) {
        setState({ phase: "error", message: "El runtime no devolvió una traducción válida para el alcance elegido." });
      } else if (result.text === markdown) {
        setState({ phase: "status", message: "La traducción coincide con el original." });
      } else {
        setState({ phase: "review", proposal: { target, edit: { kind, markdown: result.text } } });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({ phase: "error", message: getApiErrorMessage(error, "No se pudo generar la traducción.") });
      }
    } finally {
      inFlight.current = null;
    }
  }

  async function applyProposal() {
    if (!available || state.phase !== "review" || inFlight.current) return;
    const { proposal } = state;
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ phase: "checking", proposal });
    try {
      const { permissions } = await getAiConfig();
      if (controller.signal.aborted) return;
      if (!permissions.editDocuments) {
        setState({ phase: "review", proposal, message: "Activa el permiso de edición de documentos en Ajustes de IA." });
        return;
      }
      const editor = currentEditor.current;
      setState(editor.available && editor.apply(proposal.target, proposal.edit)
        ? { phase: "status", message: "Traducción aplicada al editor." }
        : { phase: "stale", proposal, message: "La propuesta ya no se puede aplicar a su documento o selección. Vuelve a pulsar Traducir." });
    } catch {
      if (!controller.signal.aborted) {
        setState({ phase: "review", proposal, message: "No se pudo comprobar el permiso de edición. Vuelve a intentarlo." });
      }
    } finally {
      inFlight.current = null;
    }
  }

  const loading = state.phase === "loading";
  const reviewing = "proposal" in state ? state : null;

  return <div className="space-y-3 text-sm text-ink-primary">
    {!available && <p className="text-ink-secondary">La traducción requiere un documento Markdown disponible.</p>}
    <form onSubmit={translate}>
      <fieldset className="flex flex-wrap items-end gap-2" disabled={!available || loading || state.phase === "checking"}>
        <label className="grid min-w-32 flex-1 gap-1 text-xs font-medium">
          Alcance
          <select className={fieldClass} value={scope} onChange={event => {
            setScope(event.target.value as Scope);
            setState({ phase: "idle" });
          }}>
            <option value="" disabled>Elige el alcance</option>
            <option value="selection">Selección</option>
            <option value="document">Documento</option>
          </select>
        </label>
        <label className="grid min-w-32 flex-1 gap-1 text-xs font-medium">
          Idioma de destino
          <select className={fieldClass} value={language} onChange={event => {
            setLanguage(event.target.value);
            setState({ phase: "idle" });
          }}>
            <option value="" disabled>Elige un idioma</option>
            {languages.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <button type="submit" className={reviewing ? buttonClass + " border border-line" : primaryClass} disabled={!scope || !language}>
          Traducir
        </button>
      </fieldset>
    </form>
    {loading && <p role="status">Traduciendo…</p>}
    {state.phase === "status" && <p role="status">{state.message}</p>}
    {state.phase === "error" && <p role="alert" className="text-red-800">{state.message}</p>}
    {reviewing && <section className="space-y-2 rounded-md border border-line bg-panel p-2.5">
      <h3 className="font-medium">Vista previa</h3>
      <div className="max-h-[35dvh] overflow-auto overscroll-contain">
        <ReadonlyMarkdownViewer markdown={reviewing.proposal.edit.markdown} ariaLabel="Traducción propuesta" emptyMessage="Traducción vacía" />
      </div>
      {reviewing.message && <p role="alert" className="text-red-800">{reviewing.message}</p>}
      <button type="button" className={primaryClass} onClick={applyProposal} disabled={!available || reviewing.phase !== "review"}>
        {reviewing.phase === "checking" ? "Comprobando permiso…" : reviewing.proposal.edit.kind === "replace_range" ? "Aplicar a la selección" : "Aplicar al documento"}
      </button>
    </section>}
  </div>;
}
