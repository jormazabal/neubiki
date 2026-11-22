import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { listDriveFolder } from "../../lib/api/protonWorkspace";
import type { ProtonNode } from "../../types/protonWorkspace";

export type FolderState = { loading: boolean; items: ProtonNode[]; error?: true };

export function useDriveFolder(accountId: string, parentId: string, rootId: string | undefined, refresh: number, active: boolean, onReachability?: (reachable: boolean) => void): FolderState {
  const [state, setState] = useState<FolderState>({ loading: true, items: [] });
  useEffect(() => {
    if (!active) return;
    const request = new AbortController();
    setState(previous => ({ ...previous, loading: true, error: undefined }));
    void listDriveFolder(accountId, parentId, rootId, request.signal).then(({ items }) => {
      if (!request.signal.aborted) { setState({ items, loading: false }); onReachability?.(true); }
    }, () => {
      if (!request.signal.aborted) { setState(previous => ({ ...previous, loading: false, error: true })); onReachability?.(false); }
    });
    return () => request.abort();
  }, [accountId, parentId, rootId, refresh, active, onReachability]);
  return state;
}

type TreeProps = {
  accountId: string;
  rootId: string;
  refresh: number;
  selected?: string;
  disabled: boolean;
  onOpen: (node: ProtonNode) => void;
};

export function ProtonTree({ node, ...props }: TreeProps & { node: ProtonNode; onReachability: (reachable: boolean) => void }) {
  const root = useDriveFolder(props.accountId, node.nodeId, props.rootId, props.refresh, true, props.onReachability);
  return <FolderContents folder={root} tree={props} />;
}

function FolderContents({ folder, tree }: { folder: FolderState; tree: TreeProps }) {
  return <>
    {folder.loading && !folder.items.length && <p role="status" className="px-2 py-1.5 text-sm text-ink-secondary">Leyendo carpeta…</p>}
    {folder.error && <p role="status" className="px-2 py-1.5 text-sm text-ink-secondary">No se pudo leer la carpeta. Vuelve a comprobar la conexión.</p>}
    {!folder.loading && !folder.error && !folder.items.length && <p className="px-2 py-1.5 text-sm text-ink-secondary">Carpeta vacía.</p>}
    <ul className="space-y-0.5">{folder.items.map(node => <TreeNode key={node.nodeId} node={node} tree={tree} />)}</ul>
  </>;
}

function TreeNode({ node, tree }: { node: ProtonNode; tree: TreeProps }) {
  const [expanded, setExpanded] = useState(false);
  const folder = useDriveFolder(tree.accountId, node.nodeId, tree.rootId, tree.refresh, node.type === "folder" && expanded);
  if (node.type === "file") return <li>
    <button aria-current={tree.selected === node.nodeId || undefined} title={node.name} disabled={tree.disabled}
      className={`flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-brand-hover disabled:opacity-60 ${tree.selected === node.nodeId ? "bg-brand-hover font-medium" : ""}`}
      onClick={() => tree.onOpen(node)}><FileText size={16} className="shrink-0 text-ink-secondary" /><span className="truncate">{node.name}</span></button>
  </li>;
  return <li>
    <button aria-expanded={expanded} title={node.name} disabled={tree.disabled}
      className="flex min-h-9 w-full items-center gap-1.5 rounded px-2 text-left text-sm hover:bg-brand-hover disabled:opacity-60"
      onClick={() => setExpanded(value => !value)}>
      {expanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
      <Folder size={16} className="shrink-0 text-brand-dark" /><span className="truncate">{node.name}</span>
    </button>
    {expanded && <div className="ml-3 border-l border-line pl-1"><FolderContents folder={folder} tree={tree} /></div>}
  </li>;
}
