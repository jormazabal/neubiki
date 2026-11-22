import { needsOperationCheck, useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { StatusTag } from "../../components/ui/StatusTag";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { getAiConfig } from "../../lib/api/config";
import { requestProtonText } from "../../lib/api/protonText";
import type { ProtonTextRequest } from "../../types/protonText";
import { ProtonProposalReview } from "./ProtonProposalReview";
import { AiHistoryRetentionOption } from "./AiHistoryRetentionOption";
import { translationLanguages, useProtonDocumentAiCopy, type TranslationLanguage } from "./protonDocumentAiCopy";
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
  | { phase: "request-error"; cause: unknown }
  | { phase: "error" | "status"; message: string };


export function ProtonTranslation({ available, capture, apply, onCheckAiUsage }: ProtonDocumentToolProps) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const { translation: c, historyWarning: historyWarningCopy } = useProtonDocumentAiCopy();
  const [scope, setScope] = useState<Scope | "">("");
  const [language, setLanguage] = useState<TranslationLanguage | "">("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const [retainHistory, setRetainHistory] = useState(false);
  const [historyWarning, setHistoryWarning] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const currentEditor = useRef({ available, apply });
  currentEditor.current = { available, apply };
  useEffect(() => () => inFlight.current?.abort(), []);

  async function translate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || !scope || !language || inFlight.current) return;

    const target = capture();
    if (!target) {
      setState({ phase: "error", message: c.open });
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
          ? c.select
          : c.empty,
      });
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setState({ phase: "loading" });
    setHistoryWarning(false);
    setRetainHistory(false);
    try {
      const result = await requestProtonText({
        ...target.address,
        baseRevisionId: target.baseRevisionId,
        kind: "translate",
        language,
        scope,
        markdown,
        ...(retainHistory ? { retainHistory: true as const } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return;

      const kind = scope === "selection" ? "replace_range" : "replace_document";
      if (result?.kind !== kind || typeof result.text !== "string" || !result.text.trim()) {
        setState({ phase: "error", message: c.invalid });
      } else if (result.text === markdown) {
        setHistoryWarning(retainHistory && result.historySaved !== true);
        setState({ phase: "status", message: c.same });
      } else {
        setHistoryWarning(retainHistory && result.historySaved !== true);
        setState({ phase: "review", proposal: { target, edit: { kind, markdown: result.text } } });
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setState({ phase: "request-error", cause });
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
        setState({ phase: "review", proposal, message: c.permission });
        return;
      }
      const editor = currentEditor.current;
      setState(editor.available && editor.apply(proposal.target, proposal.edit)
        ? { phase: "status", message: c.applied }
        : { phase: "stale", proposal, message: c.stale });
    } catch {
      if (!controller.signal.aborted) {
        setState({ phase: "review", proposal, message: c.permissionFailed });
      }
    } finally {
      inFlight.current = null;
    }
  }

  const loading = state.phase === "loading";
  const reviewing = "proposal" in state ? state : null;

  return <div className="space-y-3 text-sm text-ink-primary">
    {!available && <p className="text-ink-secondary">{c.unavailable}</p>}
    <form onSubmit={translate}>
      <fieldset className="flex flex-wrap items-end gap-2" disabled={!available || loading || state.phase === "checking"}>
        <label className="grid min-w-32 flex-1 gap-1 text-xs font-medium">
          {c.scope}
          <select className="ui-field" value={scope} onChange={event => {
            setScope(event.target.value as Scope);
            setState({ phase: "idle" });
          }}>
            <option value="" disabled>{c.chooseScope}</option>
            <option value="selection">{c.selection}</option>
            <option value="document">{c.document}</option>
          </select>
        </label>
        <label className="grid min-w-32 flex-1 gap-1 text-xs font-medium">
          {c.language}
          <select className="ui-field" value={language} onChange={event => {
            setLanguage(event.target.value as TranslationLanguage);
            setState({ phase: "idle" });
          }}>
            <option value="" disabled>{c.chooseLanguage}</option>
            {translationLanguages.map(item => <option key={item} value={item}>{c.labelLanguage(item)}</option>)}
          </select>
        </label>
        <Button type="submit" variant={reviewing ? "secondary" : "primary"} disabled={!scope || !language}>
          {c.translate}
        </Button>
      </fieldset>
      <AiHistoryRetentionOption checked={retainHistory} onChange={setRetainHistory}
        disabled={!available || loading || state.phase === "checking"} />
    </form>
    {historyWarning && <InlineNotice tone="warning" announce="status">{historyWarningCopy}</InlineNotice>}
    {loading && <div className="space-y-2">
      <StatusTag role="status" activity="working">{c.translating}</StatusTag>
      <ProgressBar label={c.progress} />
    </div>}
    {state.phase === "status" && <StatusTag tone="success" role="status">{state.message}</StatusTag>}
    {state.phase === "error" && <InlineNotice tone="error" announce="alert">{state.message}</InlineNotice>}
    {state.phase === "request-error" && <InlineNotice tone="error" announce="alert"
      action={needsOperationCheck(state.cause) && onCheckAiUsage
        ? <Button size="compact" onClick={onCheckAiUsage}>{c.checkUsage}</Button> : undefined}>
      {runtimeErrorMessage(state.cause, c.failed)}
    </InlineNotice>}
    {reviewing && <>
      {reviewing.message && <InlineNotice tone="warning" announce="alert">{reviewing.message}</InlineNotice>}
      <ProtonProposalReview title={c.review} target={reviewing.proposal.target} kind={reviewing.proposal.edit.kind}
        markdown={reviewing.proposal.edit.markdown} proposalLabel={c.proposal}
        actions={<>
          <Button disabled={reviewing.phase === "checking"} onClick={() => setState({ phase: "idle" })}>{c.discard}</Button>
          <Button variant="primary" onClick={applyProposal} disabled={!available || reviewing.phase !== "review"}>
            {reviewing.phase === "checking" ? c.checking : reviewing.proposal.edit.kind === "replace_range" ? c.applySelection : c.applyDocument}
          </Button>
        </>} />
    </>}
  </div>;
}
