import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { readProtonReferenceImpact, type ProtonReferenceImpact } from "../../lib/api/protonResources";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonExplorationCopy } from "./protonExplorationCopy";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";

export function ProtonReferenceImpactPanel({ address, name, revisionId, parentId, action, disabled, folder = false }: {
  address: ProtonDocumentKey; name: string; revisionId?: string | null; parentId: string; action: "rename" | "move"; disabled: boolean; folder?: boolean;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const t = protonExplorationCopy[useUiLocale()];
  const [result, setResult] = useState<ProtonReferenceImpact>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController>();
  const canReview = folder || !!revisionId;
  const identity = JSON.stringify([address.accountId, address.rootId, address.nodeId, revisionId, name, parentId, action, folder]);
  useEffect(() => { setResult(undefined); setError(""); setLoading(false); return () => request.current?.abort(); }, [identity]);

  async function review() {
    const target = folder ? { nodeKind: "folder" as const } : revisionId ? { revisionId } : null;
    if (!target || loading) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError("");
    try {
      const next = await readProtonReferenceImpact(address, { ...target, expectedName: name, parentId, action }, controller.signal);
      if (!controller.signal.aborted) {
        if (next.revisionId !== (folder ? null : revisionId) || next.node.nodeId !== address.nodeId
          || next.node.type !== (folder ? "folder" : "file") || next.node.name !== name || next.action !== action) throw new Error(t.impactChanged);
        setResult(next);
      }
    } catch (cause) { if (!controller.signal.aborted) { setResult(undefined); setError(runtimeErrorMessage(cause, t.impactFailed)); } }
    finally { if (request.current === controller) { request.current = undefined; setLoading(false); } }
  }

  return <section aria-label={t.impactTitle} className="mt-4 space-y-2 rounded-xl border border-line p-3">
    <h3 className="text-sm font-medium">{t.impactTitle}</h3>
    <p className="text-xs text-ink-secondary">{t.impactHelp}</p>
    <Button size="compact" disabled={disabled || loading || !canReview} onClick={() => void review()}>
      {loading ? t.impactLoading : result ? t.impactRecheck : t.impactReview}
    </Button>
    {!canReview && <p className="text-xs text-ink-secondary">{t.impactNeedsRevision}</p>}
    {loading && <p role="status" className="text-xs">{t.impactQuerying}</p>}
    {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
    {result && <>
      {result.partial && <InlineNotice tone="warning">{t.impactPartial}</InlineNotice>}
      <p role="status" className="text-sm">{t.impactCount(result.references.length, result.partial)}</p>
      <p className="text-xs text-ink-secondary">{t.impactScope(result.scannedDocuments, result.scannedFolders)}</p>
      {!!result.references.length && <ul className="max-h-40 space-y-2 overflow-auto text-xs">{result.references.map((reference, index) => <li key={index}>
        <strong>{reference.node.name}</strong> · {t.lineLabel(reference.line)}<span className="block break-words text-ink-secondary">{reference.parents.map(node => node.name).join(" / ")}</span><span className="block break-words">{reference.target}</span>
      </li>)}</ul>}
      {!!result.outgoing.length && <><p className="text-sm">{folder ? t.folderOutgoingImpact(result.outgoing.length) : t.outgoingImpact(result.outgoing.length)}</p>
        <ul className="max-h-28 overflow-auto text-xs">{result.outgoing.map((reference, index) => <li key={index} className="break-words">
          {reference.sourceName && <><strong>{reference.sourceName}</strong> · </>}{t.lineLabel(reference.line)} · {reference.target}
        </li>)}</ul></>}
    </>}
  </section>;
}
