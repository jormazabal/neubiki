import { needsOperationCheck, useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { Globe, Mic, Paperclip, Search, Send, Settings2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { StatusTag } from "../../components/ui/StatusTag";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { getAiConfig } from "../../lib/api/config";
import { requestProtonText } from "../../lib/api/protonText";
import type { ProtonTextExchange, ProtonTextExecutionMode, ProtonTextResult } from "../../types/protonText";
import type { ProtonDocumentToolProps, ProtonToolEdit, ProtonToolTarget } from "../protonWorkspace/protonToolTypes";
import { ProtonAiSettingsForm, useProtonAiSettings } from "./ProtonAiSettings";
import { ProtonProposalReview } from "./ProtonProposalReview";
import { AiHistoryRetentionOption } from "./AiHistoryRetentionOption";
import { ProtonAiSourcesDialog, type SelectedAiSource } from "./ProtonAiSourcesDialog";
import { ProtonDictationDialog } from "./ProtonDictationDialog";
import { ProtonResearchDialog } from "./ProtonResearchDialog";
import { ProtonSemanticSearchDialog } from "./ProtonSemanticSearchDialog";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonAssistantCopy } from "./protonAssistantCopy";

type ExchangeScope = Pick<ProtonToolTarget, "address" | "editorKey" | "baseRevisionId">;

function sameExchangeScope(previous: ExchangeScope, current: ProtonToolTarget) {
  return previous.editorKey === current.editorKey && previous.baseRevisionId === current.baseRevisionId
    && previous.address.accountId === current.address.accountId && previous.address.rootId === current.address.rootId
    && previous.address.nodeId === current.address.nodeId;
}

function getEdit(result: ProtonTextResult, target: ProtonToolTarget): ProtonToolEdit | null {
  switch (result.kind) {
    case "replace_document":
      return { kind: result.kind, markdown: result.text };
    case "replace_range":
      if (target.selection && target.selection.to > target.selection.from && target.selection.markdown.trim()) {
        return { kind: result.kind, markdown: result.text };
      }
      return null;
    case "insert_at":
      return target.selection ? { kind: result.kind, markdown: result.text } : null;
    default:
      return null;
  }
}

export function ProtonAssistant({ available, editorKey, sourceScope, capture, apply, aiSettingsRevision, onCheckAiUsage }: ProtonDocumentToolProps) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const copy = protonAssistantCopy[useUiLocale()].assistant;
  const [prompt, setPrompt] = useState("");
  const [executionMode, setExecutionMode] = useState<ProtonTextExecutionMode>("quick");
  const settings = useProtonAiSettings(aiSettingsRevision);
  const { config, setConfig, busy: settingsBusy, error: settingsError } = settings;
  const [settingsChoice, setSettingsChoice] = useState<boolean | null>(null);
  const [requestIssue, setRequestIssue] = useState<"" | Exclude<keyof typeof copy, "earlier"> | { cause: unknown }>("");
  const requestError = typeof requestIssue === "string" ? requestIssue && copy[requestIssue] : runtimeErrorMessage(requestIssue.cause, copy.failed);
  const needsUsageCheck = typeof requestIssue === "object" && needsOperationCheck(requestIssue.cause);
  const [conversation, setConversation] = useState<{ scope: ExchangeScope; exchanges: ProtonTextExchange[] } | null>(null);
  const [attachments, setAttachments] = useState<{ scopeKey: string; items: SelectedAiSource[] } | null>(null);
  const [sourcePicker, setSourcePicker] = useState<string | null>(null);
  const [dictationTarget, setDictationTarget] = useState<ProtonToolTarget | null>(null);
  const [researchTarget, setResearchTarget] = useState<(Pick<ProtonToolTarget, "address" | "baseRevisionId"> & { scopeKey: string; editorKey?: number }) | null>(null);
  const [semanticTarget,setSemanticTarget] = useState<ProtonToolTarget|null>(null);
  const [includePrevious, setIncludePrevious] = useState(false);
  const [proposal, setProposal] = useState<{ target: ProtonToolTarget; edit: ProtonToolEdit } | null>(null);
  const [status, setStatus] = useState("");
  const [retainHistory, setRetainHistory] = useState(false);
  const [historyWarning, setHistoryWarning] = useState(false);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const settingsOpen = settingsChoice ?? Boolean((config && !config.openaiKeyConfigured) || settingsError);
  const promptId = useId();
  const sourceId = useId();
  const scopeKey = sourceScope ? JSON.stringify([sourceScope.address.accountId, sourceScope.address.rootId,
    sourceScope.address.nodeId, sourceScope.revisionId, editorKey]) : "";
  const sources = attachments?.scopeKey === scopeKey ? attachments.items : [];
  const canResearch = Boolean(available && !settingsBusy && config?.agentic?.webResearchEnabled && config.openaiKeyConfigured);
  const activeConversation = conversation && (editorKey === undefined || conversation.scope.editorKey === editorKey)
    && (!sourceScope || conversation.scope.baseRevisionId === sourceScope.revisionId) ? conversation : null;
  const earlier = activeConversation?.exchanges ?? [];
  const visibleAnswer = earlier[earlier.length - 1]?.answer;
  const canContinue = activeConversation && earlier.every(exchange => !exchange.answer.includes("\0")
    && new TextEncoder().encode(exchange.answer).length <= 16 * 1024);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);

  function openResearch() {
    const target = sourceScope ? { address: sourceScope.address, baseRevisionId: sourceScope.revisionId } : capture();
    if (target) setResearchTarget({ address: target.address, baseRevisionId: target.baseRevisionId, scopeKey, editorKey });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!available || !config?.openaiKeyConfigured || !text || pending.current || applying || settingsBusy) return;
    const target = capture();
    if (!target) {
      setRequestIssue("openDocument");
      return;
    }
    if (includePrevious && canContinue && !sameExchangeScope(activeConversation.scope, target)) {
      setIncludePrevious(false);
      setConversation(null);
      setRequestIssue("contextChanged");
      return;
    }
    if (sources.length > 0 && sourceScope && !sameExchangeScope({
      address: sourceScope.address, baseRevisionId: sourceScope.revisionId, editorKey: editorKey ?? target.editorKey,
    }, target)) {
      setAttachments(null);
      setRequestIssue("sourcesChanged");
      return;
    }
    const visionEnabled = config.vision?.enabled === true;
    if (!visionEnabled && sources.some(source => source.kind === "image")) {
      setRequestIssue("visionRequired");
      return;
    }
    const previous = includePrevious && canContinue ? earlier : [];
    const controller = new AbortController();
    pending.current = controller;
    setRunning(true);
    setRequestIssue("");
    setIncludePrevious(false);
    setProposal(null);
    setStatus("");
    setHistoryWarning(false);
    setRetainHistory(false);
    try {
      const selectedMarkdown = target.selection?.markdown.trim() ? target.selection.markdown : undefined;
      const reply = await requestProtonText({
        ...target.address,
        baseRevisionId: target.baseRevisionId,
        kind: "assistant",
        prompt: text,
        markdown: target.markdown,
        selectedMarkdown,
        ...(executionMode === "reasoning" ? { executionMode } : {}),
        ...(previous.length === 1 ? { previousExchange: previous[0] } : {}),
        ...(previous.length > 1 ? { previousExchanges: previous } : {}),
        ...(sources.length ? { sources: sources.map(({ nodeId, revisionId }) => ({ nodeId, revisionId })) } : {}),
        ...(retainHistory ? { retainHistory: true as const } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (typeof reply?.text !== "string" || !reply.text.trim()) {
        setRequestIssue("invalidResult");
        return;
      }
      setHistoryWarning(retainHistory && reply.historySaved !== true);
      if (reply.kind === "answer") {
        const { address, editorKey, baseRevisionId } = target;
        setConversation({ scope: { address, editorKey, baseRevisionId },
          exchanges: [...previous, { prompt: text, answer: reply.text }].slice(-3) });
        return;
      }
      const edit = getEdit(reply, target);
      if (!edit) {
        setRequestIssue("invalidProposal");
        return;
      }
      setConversation(null);
      setProposal({ target, edit });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setRequestIssue({ cause });
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  async function applyProposal() {
    if (!available || !proposal || applying) return;
    setApplying(true);
    setRequestIssue("");
    try {
      const latest = await getAiConfig();
      if (!mounted.current) return;
      setConfig(latest);
      if (!latest.permissions.editDocuments) {
        setRequestIssue("permissionRequired");
      } else if (apply(proposal.target, proposal.edit)) {
        setProposal(null);
        setStatus(copy.proposalApplied);
      } else {
        setRequestIssue("proposalChanged");
      }
    } catch {
      if (mounted.current) setRequestIssue("applyFailed");
    } finally {
      if (mounted.current) setApplying(false);
    }
  }

  function openDictation() {
    const target = capture();
    if (target) {
      setDictationTarget(target);
      setRequestIssue("");
    } else {
      setRequestIssue("openDocument");
    }
  }

  return (
    <section aria-label={copy.label} className="space-y-3 text-sm text-ink-primary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset disabled={running || applying}>
          <legend className="sr-only">{copy.options}</legend>
          <SegmentedControl label={copy.mode} options={[{ value: "quick", label: copy.quick }, { value: "reasoning", label: copy.reasoning }]} value={executionMode}
            onChange={setExecutionMode} />
        </fieldset>
        <Button size="compact" aria-expanded={settingsOpen} onClick={() => setSettingsChoice(!settingsOpen)}>
          <Settings2 size={16} aria-hidden="true" /> {copy.settings}
        </Button>
      </div>
      {settingsOpen && (
        <div className="rounded-xl border border-line p-3" onSubmit={() => setSettingsChoice(true)}>
          <ProtonAiSettingsForm settings={settings} applying={applying} />
        </div>
      )}
      {requestError && <InlineNotice tone="error" announce="alert" action={needsUsageCheck && onCheckAiUsage
        ? <Button size="compact" onClick={onCheckAiUsage}>{copy.checkUsage}</Button> : undefined}>{requestError}</InlineNotice>}
      {historyWarning && <InlineNotice tone="warning" announce="status">{copy.retainingFailed}</InlineNotice>}
      {proposal && (
        <ProtonProposalReview title={copy[proposal.edit.kind]} target={proposal.target} kind={proposal.edit.kind}
          markdown={proposal.edit.markdown} proposalLabel={copy.proposal}
          actions={<>
            <Button disabled={applying} onClick={() => { setProposal(null); setRequestIssue(""); }}>{copy.discard}</Button>
            <Button variant="primary" disabled={!available || applying || settingsBusy}
              onClick={() => { void applyProposal(); }}>{copy.apply}</Button>
          </>} />
      )}
      <form className="space-y-2" onSubmit={submit}>
        {executionMode === "reasoning" && (
          <p className="text-xs text-ink-secondary">{copy.reasoningHelp}</p>
        )}
        <label htmlFor={promptId} className="font-medium">{copy.prompt}</label>
        <div className="proton-prompt">
          <textarea id={promptId} aria-describedby={sourceId} rows={3}
            className="w-full resize-y rounded-xl bg-transparent px-3 py-2"
            value={prompt} onChange={event => setPrompt(event.target.value)} disabled={running || applying} />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <span id={sourceId} className="text-xs leading-4 text-ink-secondary">{copy.outbound}</span>
            <Button type="submit" variant="primary" size="compact"
              disabled={!available || !config?.openaiKeyConfigured || !prompt.trim() || running || applying || settingsBusy}>
              <Send size={15} aria-hidden="true" /> {copy.send}
            </Button>
          </div>
        </div>
        {(sourceScope || config?.transcription?.enabled || config?.agentic?.webResearchEnabled) && <div className="flex flex-wrap items-center gap-2" aria-label={copy.tools}>
          {sourceScope && <Button size="compact" onClick={() => setSourcePicker(scopeKey)} disabled={!available || running || applying || settingsBusy}>
            <Paperclip size={15} aria-hidden="true" /> {copy.sources}
          </Button>}
          {config?.transcription?.enabled && <Button size="compact" onClick={openDictation}
            disabled={!available || !config.openaiKeyConfigured || running || applying || settingsBusy}>
            <Mic size={15} aria-hidden="true" /> {copy.dictation}
          </Button>}
          {(sourceScope || config?.agentic?.webResearchEnabled) && <Button size="compact" onClick={openResearch}
            disabled={(!sourceScope && !canResearch) || running || applying}>
            <Globe size={15} aria-hidden="true" /> {canResearch ? copy.research : copy.researchReceipts}
          </Button>}
          {sourceScope && <Button size="compact" onClick={()=>setSemanticTarget(capture())}
            disabled={!available||!config?.openaiKeyConfigured||running||applying||settingsBusy}>
            <Search size={15} aria-hidden="true"/> {copy.semantic}
          </Button>}
          {sources.map(source => <Button key={source.nodeId} size="compact" aria-label={`${copy.remove} ${source.name}`}
            disabled={running || applying}
            onClick={() => setAttachments({ scopeKey, items: sources.filter(item => item.nodeId !== source.nodeId) })}>
            <span className="break-all">{source.name}</span><X size={14} aria-hidden="true" />
          </Button>)}
        </div>}
        {canContinue && !running && <label className="flex items-start gap-2 text-xs text-ink-secondary">
          <input type="checkbox" className="mt-0.5 accent-primary" checked={includePrevious}
            disabled={!available || running || applying} onChange={event => setIncludePrevious(event.target.checked)} />
          <span>{earlier.length === 1 ? copy.previous : copy.earlier(earlier.length)}</span>
        </label>}
        <AiHistoryRetentionOption checked={retainHistory} onChange={setRetainHistory}
          disabled={!available || running || applying} label={copy.retain} />
      </form>
      {sourceScope && sourcePicker === scopeKey && <ProtonAiSourcesDialog
        root={sourceScope.root} address={sourceScope.address} initial={sources} visionEnabled={config?.vision?.enabled === true}
        onConfirm={items => { setAttachments({ scopeKey, items }); setSourcePicker(null); }} onClose={() => setSourcePicker(null)} />}
      {researchTarget && researchTarget.editorKey === editorKey && researchTarget.scopeKey === scopeKey && <ProtonResearchDialog
        target={researchTarget} canSubmit={canResearch} availableSources={sources.filter(source=>source.kind==="text")} initialQuestion="" onClose={() => setResearchTarget(null)} />}
      {semanticTarget && sourceScope && (editorKey===undefined||editorKey===semanticTarget.editorKey)
        && sourceScope.address.accountId===semanticTarget.address.accountId && sourceScope.address.rootId===semanticTarget.address.rootId
        && sourceScope.address.nodeId===semanticTarget.address.nodeId && sourceScope.revisionId===semanticTarget.baseRevisionId
        && <ProtonSemanticSearchDialog target={semanticTarget} root={sourceScope.root} availableSources={sources.filter(source=>source.kind==="text")}
          onClose={()=>setSemanticTarget(null)}/>}
      {dictationTarget && (editorKey === undefined || editorKey === dictationTarget.editorKey) && <ProtonDictationDialog
        target={dictationTarget} defaultLanguage={config?.transcription?.defaultLanguage ?? "auto"}
        canInsert={Boolean(available && dictationTarget.selection && config?.permissions.editDocuments)}
        onClose={() => setDictationTarget(null)}
        onUsePrompt={text => { setPrompt(current => current.trimEnd() ? `${current.trimEnd()} ${text}` : text); setDictationTarget(null); }}
        onInsert={async text => {
          const latest = await getAiConfig();
          if (!latest.permissions.editDocuments) return false;
          const markdown = text.replace(/[\\`*_{}\[\]()#+.!>|~=-]/g, "\\$&");
          if (!apply(dictationTarget, { kind: "insert_at", markdown })) return false;
          setDictationTarget(null);
          setStatus("Dictado insertado en el documento.");
          return true;
        }} />}
      {running && <div className="space-y-2">
        <StatusTag role="status" activity="working">{copy.processing}</StatusTag>
        <ProgressBar label={copy.progress} />
      </div>}
      {status && <StatusTag tone="success" role="status">{status}</StatusTag>}
      {earlier.length > 1 && !running && <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-xs font-medium">{copy.earlierTitle}</summary>
        <ol className="mt-2 space-y-3">
          {earlier.slice(0, -1).map((exchange, index) => <li key={index} className="space-y-1 whitespace-pre-wrap break-words">
            <p className="font-medium">{exchange.prompt}</p><p className="text-ink-secondary">{exchange.answer}</p>
          </li>)}
        </ol>
      </details>}
      {visibleAnswer && !running && <p role="status" className="whitespace-pre-wrap break-words rounded-xl bg-panel p-3">{visibleAnswer}</p>}
    </section>
  );
}
