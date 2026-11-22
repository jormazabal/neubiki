import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FileText, FolderOpen, Search } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { getProtonErrorMessage } from "../../lib/i18n/protonErrors";
import { searchProtonWorkspace, type ProtonSearchFileType, type ProtonSearchMatch, type ProtonSearchMode, type ProtonSearchResults } from "../../lib/api/protonSearch";
import type { ProtonNode, ProtonWorkspace } from "../../types/protonWorkspace";
import { DrivePicker } from "./DrivePicker";
import { ProtonReplacementDialog } from "./ProtonReplacementDialog";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonExplorationCopy } from "./protonExplorationCopy";
import { isProtonMarkdown } from "./protonFileKinds";
import { ProtonContentIndexControl } from "./ProtonContentIndexControl";
import { ProtonReplacementSuggestion, replacementSuggestionCopy } from "./ProtonReplacementSuggestion";
import type { ProtonReplacementSuggestionAnchor } from "../../lib/api/protonReplacementSuggestion";
import { ProtonBatchEditDialog, batchEditCopy } from "./ProtonBatchEditDialog";
import { prepareProtonBatchEdit, type BatchEditInput, type BatchEditProposal } from "../../lib/api/protonBatchEdit";

type SearchState = { phase: "idle" | "loading" }
  | { phase: "error"; message: string }
  | { phase: "results"; value: ProtonSearchResults; query: string };

export function ProtonSearchDialog({ workspace, connected, onClose, onOpen, fallbackFocus, onBeforeReplaceReview, onReplaced, onReplacePending, suggestionAnchor }: {
  workspace: ProtonWorkspace;
  connected: boolean;
  onClose: () => void;
  onOpen: (result: ProtonSearchMatch, query: string) => void;
  fallbackFocus: () => HTMLElement | null;
  onBeforeReplaceReview?: () => Promise<void>;
  onReplaced?: (nodeIds: string[]) => Promise<void> | void;
  onReplacePending?: (pending: boolean) => void;
  suggestionAnchor?: ProtonReplacementSuggestionAnchor;
}) {
  const language = useUiLocale();
  const t = protonExplorationCopy[language];
  const suggestionCopy = replacementSuggestionCopy[language];
  const field = useId();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ProtonSearchMode>("files");
  const [fileType, setFileType] = useState<ProtonSearchFileType>("all");
  const [scope, setScope] = useState<ProtonNode[]>([workspace.root]);
  const [picker, setPicker] = useState<ProtonNode[] | null>(null);
  const [state, setState] = useState<SearchState>({ phase: "idle" });
  const [selected, setSelected] = useState<string[]>([]);
  const [replacement, setReplacement] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [batchReview, setBatchReview] = useState<{ input: BatchEditInput; proposals: BatchEditProposal[] }>();
  const [preparedIds, setPreparedIds] = useState<string[]>([]);
  const [indexRefresh, setIndexRefresh] = useState(0);
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  const term = query.trim();
  const tooLong = new TextEncoder().encode(term).length > 512;
  const busy = state.phase === "loading";
  const batchFiles = state.phase === "results" && suggestionAnchor
    ? selected.flatMap(id => {
      const node = state.value.results.find(result => result.node.nodeId === id)?.node;
      return node && node.revisionId && isProtonMarkdown(node.name)
        ? [{ nodeId: node.nodeId, revisionId: node.revisionId, name: node.name }] : [];
    })
    : [];
  const sourceNodes = batchFiles.filter(node => node.nodeId !== suggestionAnchor?.nodeId);
  const canSuggest = connected && sourceNodes.length === selected.length && sourceNodes.length >= 2 && sourceNodes.length <= 3;
  const canBatchEdit = connected && batchFiles.length === selected.length && batchFiles.length >= 2 && batchFiles.length <= 3;

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!connected || !term || tooLong || current.current) return;
    const request = new AbortController();
    current.current = request;
    setState({ phase: "loading" });
    setSelected([]);
    try {
      const folder = scope[scope.length - 1];
      const value = await searchProtonWorkspace(workspace, term, mode, request.signal,
        scope.length > 1 ? folder?.nodeId : undefined, fileType);
      const results = scope.length > 2 ? value.results.map(result => ({ ...result,
        parents: [...scope.slice(0, -1), ...result.parents.slice(1)],
      })) : value.results;
      if (!request.signal.aborted) {
        setState({ phase: "results", value: { ...value, results }, query: term });
        if (value.index?.mode === "revision-device") setIndexRefresh(previous => previous + 1);
      }
    } catch (error) {
      if (!request.signal.aborted) setState({ phase: "error", message: getProtonErrorMessage(error, t.searchFailed, language) });
    } finally {
      if (current.current === request) current.current = null;
    }
  }

  return <ModalFrame label={t.searchTitle} onClose={() => picker ? setPicker(null) : onClose()} fallbackFocus={fallbackFocus}>
    <section className="proton-confirm-dialog !w-full !max-w-2xl space-y-4 p-4 sm:p-5">
      <DialogHeading title={t.searchTitle} closeLabel={t.close} onClose={onClose} />
      {picker ? <DrivePicker accountId={workspace.accountId} rootId={workspace.root.nodeId} path={picker} busy={!connected}
        title={t.chooseScope} onOpen={node => setPicker([...picker, node])}
        onBack={() => setPicker(picker.length > 1 ? picker.slice(0, -1) : null)}
        onSelect={() => { setScope(picker); setPicker(null); setState({ phase: "idle" }); }} /> : <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 break-words text-sm text-ink-secondary">{t.scope(scope.map(node => node.name).join(" / "))}</p>
        <Button type="button" size="compact" variant="quiet" disabled={busy || !connected}
          onClick={() => setPicker(scope)}><FolderOpen size={16} aria-hidden="true" /> {t.changeFolder}</Button>
      </div>
      <form onSubmit={event => void search(event)} className="space-y-3">
        <fieldset disabled={busy} className="min-w-0">
          <SegmentedControl label={t.searchType} value={mode} onChange={value => { setMode(value); setState({ phase: "idle" }); }}
            options={[{ value: "files", label: t.fileNames }, { value: "content", label: t.content }]} />
        </fieldset>
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={field} className="min-w-40 flex-1 text-sm">{t.searchText}
            <input id={field} type="search" data-autofocus className="ui-field mt-1 w-full" autoComplete="off" maxLength={200}
              value={query} disabled={busy} aria-invalid={tooLong || undefined}
              onChange={event => { setQuery(event.target.value); setState({ phase: "idle" }); }} />
          </label>
          <Button type="submit" variant="primary" disabled={!connected || !term || tooLong || busy}>
            <Search size={16} aria-hidden="true" /> {t.search}
          </Button>
        </div>
        <label className="grid max-w-xs gap-1 text-xs font-medium">{t.fileType}
          <select className="ui-field" disabled={busy} value={fileType} onChange={event => {
            setFileType(event.target.value as ProtonSearchFileType); setState({ phase: "idle" });
          }}>
            <option value="all">{t.allTypes}</option>
            <option value="markdown">Markdown</option>
            <option value="handwritten">{t.handwritten}</option>
            <option value="pdf">PDF</option>
            <option value="docx">Word</option>
            <option value="xlsx">{t.spreadsheets}</option>
            <option value="text">{t.textData}</option>
          </select>
        </label>
        {tooLong && <p role="alert" className="text-sm">{t.shorten}</p>}
      </form>
      {mode === "content" && <ProtonContentIndexControl accountId={workspace.accountId} rootId={workspace.root.nodeId}
        connected={connected} refreshKey={indexRefresh} />}
      {!connected && <InlineNotice tone="warning">{t.searchOffline}</InlineNotice>}
      {state.phase === "loading" && <div className="space-y-2"><p role="status">{t.searching}</p><ProgressBar label={t.progress} /></div>}
      {state.phase === "error" && <InlineNotice tone="error" announce="alert">{state.message}</InlineNotice>}
      {state.phase === "results" && <div className="space-y-2">
        <p role="status" className="text-sm">{state.value.results.length ? t.found(state.value.results.length) : state.value.partial ? t.noMatchesPartial : t.noMatches}</p>
        {state.value.partial && <InlineNotice tone="warning">{t.partialSearch(state.value.scannedFolders)}
          {state.value.limited && t.searchLimit}
          {state.value.failedReads > 0 && t.failedReads}
          {!!state.value.oversizedFiles && t.oversizedFiles(state.value.oversizedFiles)}
        </InlineNotice>}
        {!!state.value.withoutText && <p className="text-xs text-ink-secondary">{t.withoutText(state.value.withoutText!)}</p>}
        <ul className="max-h-[min(48dvh,25rem)] space-y-1 overflow-auto">
          {state.value.results.map(result => <li key={result.node.nodeId}>
            {(mode === "content" || (suggestionAnchor && result.node.revisionId)) && workspace.canWrite && onBeforeReplaceReview && isProtonMarkdown(result.node.name) && <label className="flex min-h-12 items-center gap-2 px-3 text-xs">
              <input type="checkbox" checked={selected.includes(result.node.nodeId)}
                disabled={selected.length >= 16 && !selected.includes(result.node.nodeId)} onChange={event => setSelected(previous => event.target.checked
                  ? [...previous, result.node.nodeId] : previous.filter(id => id !== result.node.nodeId))} />
              {t.include(result.node.name)}
            </label>}
            <button type="button" className="proton-tree-item !min-h-12 w-full !items-start !whitespace-normal break-words text-left"
              disabled={!connected} onClick={() => onOpen(result, state.query)}>
              <FileText size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <strong className="block text-sm">{result.node.name}</strong>
                <span className="block text-xs text-ink-secondary">{result.parents.map(parent => parent.name).join(" / ")}{result.pageNumber ? t.page(result.pageNumber) : ""}{result.sheetId ? t.cell(result.sheetId, result.row, result.column) : result.line ? t.line(result.line) : ""}</span>
                {result.excerpt && <span className="block text-xs">{result.excerpt}</span>}
              </span>
            </button>
          </li>)}
        </ul>
        {suggestionAnchor && workspace.canWrite && onBeforeReplaceReview && selected.length > 0 && <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!canBatchEdit} onClick={() => { setPreparedIds([]); setEditing(true); }}>{batchEditCopy[language].title}</Button>
          {!canBatchEdit && <p className="text-xs text-ink-secondary">{batchEditCopy[language].selectionHelp}</p>}
        </div>}
        {mode === "content" && workspace.canWrite && onBeforeReplaceReview && <details>
          <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">{t.replaceSummary}</summary>
          <p className="mb-2 text-xs text-ink-secondary">{t.selectDocuments}</p>
          <label className="grid gap-1 text-sm">{t.replaceWith}
            <input className="ui-field" value={replacement} maxLength={4096} onChange={event => setReplacement(event.target.value)} />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={!connected || selected.length === 0 || replacement === state.query} onClick={() => setReplacing(true)}>
              {t.reviewDocuments(selected.length)}
            </Button>
            {suggestionAnchor && <Button disabled={!canSuggest} onClick={() => setSuggesting(true)}>{suggestionCopy.title}</Button>}
          </div>
          {suggestionAnchor && !canSuggest && <p className="mt-2 text-xs text-ink-secondary">{suggestionCopy.chooseSources}</p>}
        </details>}
      </div>}
      </>}
    </section>
    {replacing && state.phase === "results" && onBeforeReplaceReview && <ProtonReplacementDialog workspace={workspace}
      nodeIds={selected} query={state.query} replacement={replacement} onBeforeReview={onBeforeReplaceReview}
      onPrepared={ids => onReplaced?.(ids)} onClose={() => setReplacing(false)} onPending={onReplacePending} />}
    {suggesting && state.phase === "results" && suggestionAnchor && sourceNodes.length >= 2 && <ProtonReplacementSuggestion
      anchor={suggestionAnchor} query={state.query} sources={sourceNodes} connected={connected} onPending={onReplacePending}
      onClose={() => setSuggesting(false)} onUse={phrase => { setReplacement(phrase); setSuggesting(false); }} />}
    {editing && suggestionAnchor && batchFiles.length >= 2 && <ProtonBatchEditDialog
      key={JSON.stringify([suggestionAnchor.nodeId, suggestionAnchor.baseRevisionId, batchFiles.map(file => file.revisionId)])}
      anchor={suggestionAnchor} files={batchFiles} connected={connected} onPending={onReplacePending} preparedIds={preparedIds}
      onClose={() => setEditing(false)} onCompare={(input, proposals) => setBatchReview({ input, proposals })} />}
    {batchReview && onBeforeReplaceReview && <ProtonReplacementDialog workspace={workspace}
      reviewTitle={batchEditCopy[language].comparison}
      loadReview={signal => prepareProtonBatchEdit(batchReview.input, batchReview.proposals, signal)}
      onBeforeReview={onBeforeReplaceReview} onPrepared={ids => {
        setPreparedIds(previous => [...new Set([...previous, ...ids])]);
        return onReplaced?.(ids);
      }}
      onClose={() => setBatchReview(undefined)} onPending={onReplacePending} />}
  </ModalFrame>;
}
