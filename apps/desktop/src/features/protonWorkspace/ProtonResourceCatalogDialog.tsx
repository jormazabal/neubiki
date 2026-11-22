import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { Button } from "../../components/ui/Button";
import { readProtonResourceCatalog, type ProtonResourceCatalog, type ProtonResourceKind } from "../../lib/api/protonResources";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonExplorationCopy } from "./protonExplorationCopy";
import type { ProtonNode } from "../../types/protonWorkspace";


export function ProtonResourceCatalogDialog({ accountId, root, connected, onClose, onOpen, fallbackFocus }: {
  accountId: string; root: ProtonNode; connected: boolean; onClose: () => void;
  onOpen: (node: ProtonNode, parents: ProtonNode[]) => void; fallbackFocus: () => HTMLElement | null;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const t = protonExplorationCopy[useUiLocale()];
  const labels = t.resourceKinds;
  const [snapshot, setSnapshot] = useState<{ key: string; value: ProtonResourceCatalog }>();
  const scopeKey = JSON.stringify([accountId, root.nodeId]);
  const catalog = snapshot?.key === scopeKey ? snapshot.value : undefined;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ProtonResourceKind | "all">("all");
  useEffect(() => {
    if (!connected) return;
    const request = new AbortController();
    setLoading(true); setError("");
    void readProtonResourceCatalog(accountId, root.nodeId, request.signal).then(next => {
      if (!request.signal.aborted) { setSnapshot({ key: scopeKey, value: next }); setLoading(false); }
    }, cause => { if (!request.signal.aborted) { setError(runtimeErrorMessage(cause, t.catalogFailed)); setLoading(false); } });
    return () => request.abort();
  }, [accountId, root.nodeId, connected, refresh, scopeKey]);
  const resources = catalog?.resources.filter(resource => (kind === "all" || kind === resource.kind)
    && resource.node.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];

  return createPortal(<ModalFrame label={t.catalogTitle} onClose={onClose} fallbackFocus={fallbackFocus} className="proton-rail-dialog">
    <div className="proton-confirm-dialog space-y-3 p-5">
      <DialogHeading title={t.catalogTitle} closeLabel={t.close} onClose={onClose} />
      <p className="text-sm text-ink-secondary">{t.catalogHelp(root.name)}</p>
      <div className="flex flex-wrap gap-2">
        <input type="search" aria-label={t.catalogFilter} placeholder={t.catalogPlaceholder} className="ui-field min-w-0 flex-1" value={query} maxLength={256} onChange={event => setQuery(event.target.value)} />
        <select aria-label={t.resourceType} className="ui-field" value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
          <option value="all">{t.allTypes}</option>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      {!connected && <InlineNotice tone="warning">{t.catalogOffline}</InlineNotice>}
      {loading && <p role="status">{t.catalogLoading}</p>}
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {catalog?.partial && <InlineNotice tone="warning">{t.partialCatalog(catalog.scannedFolders)}</InlineNotice>}
      {catalog && <p role="status" className="text-sm">{resources.length ? t.visibleResources(resources.length) : t.noResources}</p>}
      <ul className="max-h-[min(48dvh,25rem)] space-y-1 overflow-auto">{resources.map(resource => <li key={resource.node.nodeId}>
        <Button variant="quiet" className="!h-auto !min-h-12 !w-full !justify-start !whitespace-normal text-left" disabled={!connected || loading || !!error}
          onClick={() => onOpen(resource.node, resource.parents)}>
          <FileText size={16} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words"><strong className="block">{resource.node.name}</strong>
            <span className="block text-xs text-ink-secondary">{labels[resource.kind]} · {resource.parents.map(node => node.name).join(" / ")}</span></span>
        </Button>
      </li>)}</ul>
      <div className="flex justify-end gap-2"><Button disabled={!connected || loading} onClick={() => setRefresh(value => value + 1)}>{t.refresh}</Button><Button onClick={onClose}>{t.close}</Button></div>
    </div>
  </ModalFrame>, document.body);
}
