import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { ArrowLeft, ChevronRight, FileText, Folder, Image, Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import type { ProtonDocumentKey, ProtonNode } from "../../types/protonWorkspace";
import type { ProtonTextSource } from "../../types/protonText";
import { searchProtonWorkspace, type ProtonSearchResults } from "../../lib/api/protonSearch";
import { useDriveFolder } from "../protonWorkspace/ProtonTree";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonAssistantCopy } from "./protonAssistantCopy";
import { useSemanticCopy } from "../../lib/i18n/semanticCopy";

export type SelectedAiSource = ProtonTextSource & { name: string; kind: "text" | "image" };

function kind(name: string): SelectedAiSource["kind"] | null {
  if (/\.(?:png|jpe?g|webp)$/i.test(name)) return "image";
  return /\.(?:md|markdown|mdown|txt|csv|tsv|log|json|docx|xlsx|pdf|nbnote|knote)$/i.test(name) ? "text" : null;
}

export function ProtonAiSourcesDialog({ root, address, initial, visionEnabled, textOnly = false, onConfirm, onClose }: {
  root: ProtonNode;
  address: ProtonDocumentKey;
  initial: SelectedAiSource[];
  visionEnabled: boolean;
  textOnly?:boolean;
  onConfirm: (selected: SelectedAiSource[]) => void;
  onClose: () => void;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const copy = protonAssistantCopy[useUiLocale()].sources;
  const semanticCopy = useSemanticCopy();
  const [parents, setParents] = useState([root]);
  const [selection, setSelection] = useState(()=>textOnly?initial.filter(source=>source.kind==="text"):initial);
  const [filter, setFilter] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [mode, setMode] = useState<"folder" | "search">("folder");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ProtonSearchResults | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const folder = parents[parents.length - 1];
  const { items, loading, error } = useDriveFolder(address.accountId, folder.nodeId, address.rootId, refresh, mode === "folder");
  const term = filter.trim().toLocaleLowerCase();
  const entries = items.filter(node => (node.type === "folder"
    || (node.nodeId !== address.nodeId && node.revisionId && kind(node.name) && (!textOnly||kind(node.name)==="text")))
    && (!term || node.name.toLocaleLowerCase().includes(term)));
  const indexedEntries = result?.results.filter(match => match.node.nodeId !== address.nodeId
    && match.node.revisionId && kind(match.node.name) && (!textOnly||kind(match.node.name)==="text")) ?? [];

  function changeFolder(path: ProtonNode[]) {
    setFilter("");
    setParents(path);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term || pending.current || new TextEncoder().encode(term).length > 512) return;
    const request = new AbortController();
    pending.current = request;
    setSearching(true);
    setResult(null);
    setSearchError("");
    try {
      const value = await searchProtonWorkspace({ accountId: address.accountId, root, canWrite: false }, term, "content", request.signal);
      if (!request.signal.aborted) setResult(value);
    } catch (cause) {
      if (!request.signal.aborted) setSearchError(runtimeErrorMessage(cause, copy.searchError));
    } finally {
      if (pending.current === request) pending.current = null;
      if (!request.signal.aborted) setSearching(false);
    }
  }

  function toggle(item: SelectedAiSource) {
    if(textOnly&&item.kind!=="text")return;
    setSelection(current => {
      if (current.some(source => source.nodeId === item.nodeId)) {
        return current.filter(source => source.nodeId !== item.nodeId);
      }
      if (current.length === 3 || (item.kind === "image" && (!visionEnabled || current.some(source => source.kind === "image")))) {
        return current;
      }
      return [...current, item];
    });
  }

  function sourceEntry(node: ProtonNode, detail?: string) {
    const sourceKind = kind(node.name);
    const revisionId = node.revisionId;
    if (!sourceKind || !revisionId || node.nodeId === address.nodeId || textOnly&&sourceKind!=="text") return null;
    const checked = selection.some(source => source.nodeId === node.nodeId);
    const disabled = !checked && (selection.length === 3 || (sourceKind === "image"
      && (!visionEnabled || selection.some(source => source.kind === "image"))));
    const Icon = sourceKind === "image" ? Image : FileText;
    return <li key={node.nodeId}>
      <label className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm">
        <input type="checkbox" checked={checked} disabled={disabled}
          onChange={() => toggle({ nodeId: node.nodeId, revisionId, name: node.name, kind: sourceKind })} />
        <Icon size={17} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-all">{node.name}{detail && <span className="block text-xs text-ink-secondary">{detail}</span>}</span>
      </label>
    </li>;
  }

  return createPortal(<ModalFrame label={copy.title} onClose={onClose} className={textOnly?"!z-[140]":undefined}>
    <section className="proton-confirm-dialog space-y-3 p-4">
      <DialogHeading title={copy.title} closeLabel={copy.cancel} onClose={onClose} />
      <p className="text-sm text-ink-secondary">{textOnly?semanticCopy.textOnly:copy.description}</p>
      <SegmentedControl label={copy.mode} value={mode} onChange={setMode}
        options={[{ value: "folder", label: copy.folders }, { value: "search", label: copy.content }]} />
      {mode === "folder" ? <>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {parents.length > 1 && <Button variant="quiet" size="icon" aria-label={copy.previous}
          onClick={() => changeFolder(parents.slice(0, -1))}><ArrowLeft size={17} aria-hidden="true" /></Button>}
        <span className="break-all">{parents.map(parent => parent.name).join(" / ")}</span>
      </div>
      <label className="flex items-center gap-2">
        <Search size={16} aria-hidden="true" />
        <input type="search" aria-label={copy.filter} className="ui-field w-full" value={filter}
          onChange={event => setFilter(event.target.value)} data-autofocus />
      </label>
      {loading ? <p role="status" className="text-sm">{copy.reading}</p> : error ? <InlineNotice tone="error" announce="alert"
        action={<Button size="compact" onClick={() => setRefresh(value => value + 1)}>{copy.retry}</Button>}>
        {copy.readError}
      </InlineNotice> : entries.length === 0 ? <p className="text-sm text-ink-secondary">{copy.empty}</p> :
        <ul className="max-h-[32dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {entries.map(node => {
            if (node.type === "folder") return <li key={node.nodeId}>
              <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-hover"
                onClick={() => changeFolder([...parents, node])}>
                <Folder size={17} aria-hidden="true" /><span className="flex-1 break-all">{node.name}</span><ChevronRight size={15} aria-hidden="true" />
              </button>
            </li>;
            return sourceEntry(node);
          })}
        </ul>}
      </> : <>
        <form className="flex gap-2" onSubmit={search}>
          <input type="search" aria-label={copy.searchLabel} className="ui-field min-w-0 flex-1"
            maxLength={512} value={query} onChange={event => { setQuery(event.target.value); setResult(null); }}
            disabled={searching} />
          <Button type="submit" disabled={searching || !query.trim() || new TextEncoder().encode(query.trim()).length > 512}>{copy.search}</Button>
        </form>
        {searching && <p role="status" className="text-sm">{copy.searching}</p>}
        {searchError && <InlineNotice tone="error" announce="alert">{searchError}</InlineNotice>}
        {result && <div className="space-y-2">
          {result.partial && <InlineNotice tone="warning" announce="status">{copy.partial}</InlineNotice>}
          {indexedEntries.length === 0 && <p className="text-sm text-ink-secondary">{copy.emptyIndex}</p>}
          <ul className="max-h-[32dvh] divide-y divide-line overflow-y-auto">
            {indexedEntries.map(match => sourceEntry(match.node, match.parents.map(parent => parent.name).join(" / ")))}
          </ul>
        </div>}
      </>}
      {selection.length > 0 && <div className="flex flex-wrap gap-2" aria-label={copy.selected}>
        {selection.map(source => <Button key={source.nodeId} size="compact" onClick={() => toggle(source)}>
          {copy.remove} {source.name}
        </Button>)}
      </div>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>{copy.cancel}</Button>
        <Button variant="primary" onClick={() => onConfirm(selection)}>{copy.confirm} ({selection.length})</Button>
      </div>
    </section>
  </ModalFrame>, document.body);
}
