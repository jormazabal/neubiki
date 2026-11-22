import { LocalizedNoticeError, useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { FileText, Image } from "lucide-react";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { Button } from "../../components/ui/Button";
import { StatusTag } from "../../components/ui/StatusTag";
import { listProtonIncomingReferences, listProtonReferences, type ProtonIncomingReferences, type ProtonReference, type ProtonReferenceList } from "../../lib/api/protonReferences";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonExplorationCopy } from "./protonExplorationCopy";
import type { ProtonDocumentKey, ProtonNode } from "../../types/protonWorkspace";



export function ProtonReferencesTool({ address, revisionId, connected, onOpen }: {
  address: ProtonDocumentKey;
  revisionId: string;
  connected: boolean;
  onOpen: (node: ProtonNode, location?: { revisionId: string; line: number }) => void;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const t = protonExplorationCopy[useUiLocale()];
  const labels = t.referenceStatuses;
  const [inventory, setInventory] = useState<ProtonReferenceList | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [incoming, setIncoming] = useState<ProtonIncomingReferences | null>(null);
  const [incomingBusy, setIncomingBusy] = useState(false);
  const [incomingError, setIncomingError] = useState("");
  const incomingRequest = useRef<AbortController | null>(null);
  const request = useRef<AbortController | null>(null);
  const { accountId, rootId, nodeId } = address;

  useEffect(() => {
    setInventory(null);
    setError("");
    setBusy(false);
    setIncoming(null);
    setIncomingBusy(false);
    setIncomingError("");
    return () => {
      request.current?.abort();
      request.current = null;
      incomingRequest.current?.abort();
      incomingRequest.current = null;
    };
  }, [accountId, rootId, nodeId, revisionId]);

  async function load() {
    if (!connected || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const next = await listProtonReferences(address, revisionId, controller.signal);
      if (controller.signal.aborted) return;
      if (next.revisionId !== revisionId) throw new LocalizedNoticeError(t.revisionChanged);
      setInventory(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(runtimeErrorMessage(cause, t.referencesFailed));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  async function loadIncoming() {
    if (!connected || incomingRequest.current) return;
    const controller = new AbortController();
    incomingRequest.current = controller;
    setIncomingBusy(true);
    setIncomingError("");
    try {
      const next = await listProtonIncomingReferences(address, revisionId, controller.signal);
      if (controller.signal.aborted) return;
      if (next.revisionId !== revisionId) throw new LocalizedNoticeError(t.revisionChanged);
      setIncoming(next);
    } catch (cause) {
      if (!controller.signal.aborted) setIncomingError(runtimeErrorMessage(cause, t.incomingFailed));
    } finally {
      if (incomingRequest.current === controller) { incomingRequest.current = null; setIncomingBusy(false); }
    }
  }

  function renderReference(reference: ProtonReference) {
    const Icon = reference.image ? Image : FileText;
    const folder = reference.status === "available" && reference.node.type === "folder";
    const warning = reference.status === "missing" || reference.status === "blocked" || reference.status === "unverified";
    return <li key={`${reference.line}:${reference.target}:${reference.image}`} className="flex min-w-0 flex-wrap items-start gap-2 border-b border-line py-3 last:border-b-0">
      <Icon size={16} className="mt-1 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words text-sm font-medium">{reference.target}</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusTag tone={warning ? "warning" : "neutral"}>{folder ? t.folder : labels[reference.status]}</StatusTag>
          <span className="text-xs text-ink-secondary">{t.lineLabel(reference.line)}</span>
        </div>
      </div>
      {reference.status === "available" && reference.node.type === "file" && <Button size="compact" variant="quiet"
        aria-label={t.openNamed(reference.node.name)} disabled={!connected || busy || !!error} onClick={() => onOpen(reference.node)}>{t.open}</Button>}
    </li>;
  }

  return <section aria-label={t.referencesTitle} className="min-w-0 space-y-3">
    <p className="text-sm text-ink-secondary">{t.referencesHelp}</p>
    <Button variant="primary" disabled={!connected || busy} onClick={() => { void load(); }}>
      {busy ? t.checking : inventory ? t.referencesRecheck : t.referencesCheck}
    </Button>
    {!connected && <InlineNotice tone="warning">{t.referencesOffline}</InlineNotice>}
    {busy && <p role="status" className="text-sm text-ink-secondary">{t.referencesLoading}</p>}
    {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
    {inventory?.partial && <InlineNotice tone="warning">{t.referencesPartial}</InlineNotice>}
    {inventory && !inventory.references.length && <p className="text-sm text-ink-secondary">{t.referencesEmpty}</p>}
    {inventory && <ul>{inventory.references.map(renderReference)}</ul>}
    <section aria-label={t.incomingTitle} className="space-y-3 border-t border-line pt-3">
      <h3 className="text-sm font-semibold">{t.incomingTitle}</h3>
      <Button disabled={!connected || incomingBusy} onClick={() => void loadIncoming()}>
        {incomingBusy ? t.incomingBusy : incoming ? t.incomingRefresh : t.incomingSearch}
      </Button>
      {incomingBusy && <p role="status" className="text-xs text-ink-secondary">{t.incomingLoading}</p>}
      {incomingError && <InlineNotice tone="error" announce="alert">{incomingError}</InlineNotice>}
      {incoming?.partial && <InlineNotice tone="warning">{t.incomingPartial(incoming.scannedDocuments, incoming.scannedFolders)}</InlineNotice>}
      {incoming && incoming.references.length === 0 && <p className="text-xs text-ink-secondary">{incoming.partial
        ? t.incomingEmptyPartial : t.incomingEmpty}</p>}
      {incoming && <ul className="space-y-2">{incoming.references.map((reference, index) => <li key={`${reference.node.nodeId}:${reference.line}:${index}`}>
        <Button variant="quiet" className="!h-auto !min-h-12 !w-full !justify-start !whitespace-normal text-left"
          aria-label={t.viewSource(reference.node.name, reference.line)}
          disabled={!connected || incomingBusy} onClick={() => onOpen(reference.node, { revisionId: reference.revisionId, line: reference.line })}>
          <FileText size={16} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 break-words"><span className="block">{reference.node.name}</span>
            <span className="block text-xs text-ink-secondary">{reference.parents.map(parent => parent.name).join(" / ")} · {t.sourceLine(reference.line)}</span>
          </span>
        </Button>
      </li>)}</ul>}
    </section>
  </section>;
}
