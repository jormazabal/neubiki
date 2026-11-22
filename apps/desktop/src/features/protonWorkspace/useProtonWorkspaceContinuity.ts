import { useEffect, useMemo, useRef, useState } from "react";
import { readDocument } from "../../lib/api/protonWorkspace";
import type { ProtonDocument, ProtonDocumentKey } from "../../types/protonWorkspace";

export const protonContinuityStorageKey = "neubiki.proton-workspace.continuity.v1";
const maxScopes = 10;
const maxTabs = 8;
const maxContentBytes = 24 * 1024 * 1024;
const maxSettingsLength = 196_608;

type Scope = Omit<ProtonDocumentKey, "nodeId">;
type Layout = {
  showTree: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
};

export type ProtonContinuitySnapshot = Layout & { nodeIds: string[]; activeId: string | null };
export type ProtonContinuityRestoration = {
  tabs: Array<{ address: ProtonDocumentKey; document: ProtonDocument }>;
  layout: Layout;
  activeId: string | null;
  unavailableCount: number;
};

type Record = { scopeKey: string; snapshot: ProtonContinuitySnapshot };

function token(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\s\p{Cc}]/u.test(value);
}

function validWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 176 && value <= 560;
}

function snapshotOf(value: unknown): ProtonContinuitySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<ProtonContinuitySnapshot>;
  if (!Array.isArray(snapshot.nodeIds) || !snapshot.nodeIds.every(token) || snapshot.nodeIds.length > maxTabs
    || (snapshot.activeId !== null && !snapshot.nodeIds.includes(snapshot.activeId ?? ""))
    || typeof snapshot.showTree !== "boolean" || typeof snapshot.leftOpen !== "boolean" || typeof snapshot.rightOpen !== "boolean"
    || !validWidth(snapshot.leftWidth) || !validWidth(snapshot.rightWidth)) return null;
  return {
    nodeIds: [...new Set(snapshot.nodeIds)], activeId: snapshot.activeId ?? null, showTree: snapshot.showTree,
    leftOpen: snapshot.leftOpen, rightOpen: snapshot.rightOpen, leftWidth: snapshot.leftWidth, rightWidth: snapshot.rightWidth,
  };
}

function scopeKeyOf(scope: Scope) {
  return JSON.stringify([scope.accountId, scope.rootId]);
}

function loadRecords(): Record[] {
  try {
    const raw = window.localStorage.getItem(protonContinuityStorageKey);
    if (!raw || raw.length > maxSettingsLength) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, maxScopes).flatMap((record: Partial<Record> | null) => {
      const snapshot = snapshotOf(record?.snapshot);
      if (!snapshot || typeof record?.scopeKey !== "string" || record.scopeKey.length > 4096) return [];
      return [{ scopeKey: record.scopeKey, snapshot }];
    });
  } catch {
    return [];
  }
}

function saveRecord(scopeKey: string, snapshot: ProtonContinuitySnapshot) {
  try {
    const stored = loadRecords().filter(record => record.scopeKey !== scopeKey);
    window.localStorage.setItem(protonContinuityStorageKey, JSON.stringify([{ scopeKey, snapshot }, ...stored].slice(0, maxScopes)));
  } catch {
    // This optional view preference must never interrupt a document action.
  }
}

function boundSnapshot(snapshot: ProtonContinuitySnapshot): ProtonContinuitySnapshot | null {
  const nodeIds = [...new Set(snapshot.nodeIds.filter(token))];
  const activeId = snapshot.activeId && nodeIds.includes(snapshot.activeId) ? snapshot.activeId : null;
  const kept = nodeIds.slice(0, maxTabs);
  if (activeId && !kept.includes(activeId)) kept[maxTabs - 1] = activeId;
  return snapshotOf({ ...snapshot, nodeIds: kept, activeId });
}

function bytesOf(document: ProtonDocument) {
  // A safe upper bound for strings retained in the WebView across tabs.
  const handwrittenAllowance = document.handwritten ? 16 * 1024 * 1024 : 0;
  return handwrittenAllowance + 2 * ((document.contentBase64?.length ?? 0) + (document.markdown?.length ?? 0) + (document.draft?.markdown.length ?? 0));
}

export function useProtonWorkspaceContinuity({ enabled, ready, scope, snapshot, supportsFile, canApply, onRestore }: {
  enabled: boolean;
  ready: boolean;
  scope: Scope | null;
  snapshot: ProtonContinuitySnapshot;
  supportsFile: (name: string) => boolean;
  canApply: () => boolean;
  onRestore: (restoration: ProtonContinuityRestoration) => void;
}) {
  const scopeKey = enabled && scope && token(scope.accountId) && token(scope.rootId) ? scopeKeyOf(scope) : null;
  const lifetime = useMemo(() => ({ scopeKey }), [scopeKey]);
  const [completed, setCompleted] = useState<typeof lifetime | null>(null);
  const preserveUnread = useRef<typeof lifetime | null>(null);
  const latest = useRef({ lifetime, scope, ready, snapshot, supportsFile, canApply, onRestore });
  latest.current = { lifetime, scope, ready, snapshot, supportsFile, canApply, onRestore };
  const serialized = JSON.stringify(boundSnapshot(snapshot));

  useEffect(() => {
    const activeScope = latest.current.scope;
    if (!activeScope || !scopeKey || !ready || lifetime === completed) return;
    const saved = loadRecords().find(record => record.scopeKey === scopeKey)?.snapshot;
    if (!saved || latest.current.snapshot.nodeIds.length > 0) {
      setCompleted(lifetime);
      return;
    }
    const request = new AbortController();
    const active = () => !request.signal.aborted && latest.current.lifetime === lifetime && latest.current.ready;

    async function restore() {
      if (!saved || !activeScope) return;
      const { nodeIds, activeId, ...layout } = saved;
      const byId = new Map<string, ProtonContinuityRestoration["tabs"][number]>();
      const priority = activeId ? [activeId, ...nodeIds.filter(id => id !== activeId)] : nodeIds;
      let retainedBytes = 0;
      for (const nodeId of priority) {
        if (!active() || latest.current.snapshot.nodeIds.length > 0) break;
        if (retainedBytes >= maxContentBytes) break;
        const address = { ...activeScope, nodeId };
        try {
          const document = await readDocument(address, request.signal);
          if (document.node.nodeId !== nodeId || document.node.type !== "file" || !token(document.revisionId)
            || !latest.current.supportsFile(document.node.name)) continue;
          const bytes = bytesOf(document);
          if (retainedBytes + bytes > maxContentBytes) continue;
          retainedBytes += bytes;
          byId.set(nodeId, { address, document });
        } catch {
          // Each remaining tab can still be restored independently.
        }
      }
      if (!active()) return;
      if (latest.current.snapshot.nodeIds.length === 0) {
        if (!latest.current.canApply()) return;
        const tabs = nodeIds.flatMap(id => byId.get(id) ?? []);
        if (nodeIds.length && tabs.length === 0) preserveUnread.current = lifetime;
        latest.current.onRestore({
          tabs, layout,
          activeId: activeId && byId.has(activeId) ? activeId : tabs[0]?.address.nodeId ?? null,
          unavailableCount: nodeIds.length - tabs.length,
        });
      }
      setCompleted(lifetime);
    }
    void restore();
    return () => request.abort();
  }, [scopeKey, ready, lifetime, completed]);

  useEffect(() => {
    if (!scopeKey || completed !== lifetime || serialized === "null") return;
    const value = JSON.parse(serialized) as ProtonContinuitySnapshot;
    if (preserveUnread.current === lifetime) {
      if (!value.nodeIds.length) return;
      preserveUnread.current = null;
    }
    saveRecord(scopeKey, value);
  }, [scopeKey, completed, lifetime, serialized]);
}
