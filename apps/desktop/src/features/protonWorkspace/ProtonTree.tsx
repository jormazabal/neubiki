import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Copy, Download, FilePlus2, FileText, Files, Folder, FolderPlus, MoreHorizontal, MoveRight, Pencil, Settings2, Star, Trash2, Upload } from "lucide-react";
import { listDriveFolder } from "../../lib/api/protonWorkspace";
import type { ProtonNode, ProtonTreeEdit } from "../../types/protonWorkspace";
import { FloatingTreeMenu, type FloatingMenuItem } from "../documents/FloatingTreeMenu";
import { captureProtonFiles, type LoadProtonImport } from "./protonImportSources";
import { useProtonTreeDrop } from "./useProtonTreeDrop";
import { isProtonMarkdown } from "./protonFileKinds";
import { useUiCopy } from "../../lib/i18n/UiLocale";

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
  canWrite: boolean;
  favoriteIds?: ReadonlySet<string>;
  onOpen: (node: ProtonNode, parents: ProtonNode[]) => void;
  onExport: (node: ProtonNode, parents: ProtonNode[]) => void;
};

type Action = ProtonTreeEdit["action"];
type MenuAction = Action | "open" | "export" | "import" | "template" | "capture-template" | "project-trash" | "batch-export" | "resource-catalog" | "favorites" | "toggle-favorite" | "project-packages" | "shared-profiles" | "shared-templates";
export type ProtonTreeTarget = { node: ProtonNode; parents: ProtonNode[] };
type Menu = ProtonTreeTarget & { anchor: HTMLButtonElement; x: number; y: number };
type BranchProps = TreeProps & { menuId?: string; onMenu: (menu: Menu) => void; drag: ReturnType<typeof useProtonTreeDrop> };

export function ProtonTree({ node, onAction, onMove, onImport, onCreateTemplate, onOpenTrash, onBatchExport, onOpenResources,
  onOpenFavorites, onToggleFavorite, onOpenPackages, onOpenProfiles, onOpenSharedTemplates, onCaptureTemplate, onMenuChange, ...props }: TreeProps & {
  node: ProtonNode;
  onReachability: (reachable: boolean) => void;
  onAction: (action: Action, target: ProtonTreeTarget) => void;
  onMove: (source: ProtonTreeTarget, destination: ProtonNode[]) => void;
  onImport?: (destination: ProtonNode[], load: LoadProtonImport) => void;
  onCreateTemplate?: (destination: ProtonNode[]) => void;
  onOpenTrash?: () => void;
  onBatchExport?: () => void;
  onOpenResources?: () => void;
  onOpenFavorites?: () => void;
  onToggleFavorite?: (nodeId: string) => void;
  onOpenPackages?: () => void;
  onOpenProfiles?: () => void;
  onOpenSharedTemplates?: () => void;
  onCaptureTemplate?: (document: ProtonNode) => void;
  onMenuChange?: (open: boolean) => void;
}) {
  const { tree: text, portability } = useUiCopy();
  const createItems: FloatingMenuItem<MenuAction>[] = [
    { action: "create-folder", label: text.createFolder, icon: FolderPlus },
    { action: "create-document", label: text.createDocument, icon: FilePlus2 },
    { action: "create-note", label: text.createNote, icon: FilePlus2 },
  ];
  const root = useDriveFolder(props.accountId, node.nodeId, props.rootId, props.refresh, true, props.onReachability);
  const [menu, setMenu] = useState<Menu | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const importTarget = useRef<ProtonNode[]>([]);
  const drag = useProtonTreeDrop(props.canWrite && !props.disabled, onMove, onImport, () => setMenu(null));
  const visibleMenu = props.disabled ? null : menu;
  useEffect(() => {
    onMenuChange?.(Boolean(visibleMenu));
    return () => onMenuChange?.(false);
  }, [visibleMenu, onMenuChange]);
  useEffect(() => {
    if (!menu) return;
    if (!visibleMenu) { setMenu(null); return; }
    function outside(event: PointerEvent) {
      if (event.target instanceof Element && !event.target.closest(".proton-tree-context")
        && !visibleMenu!.anchor.contains(event.target)) setMenu(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      visibleMenu!.anchor.focus();
      setMenu(null);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu, visibleMenu]);

  const tree: BranchProps = {
    ...props, drag, menuId: visibleMenu?.node.nodeId,
    onMenu: next => setMenu(previous => previous?.anchor === next.anchor && previous?.node.nodeId === next.node.nodeId ? null : next),
  };
  const items: FloatingMenuItem<MenuAction>[] = [];
  if (visibleMenu) {
    const { node: item } = visibleMenu;
    const markdown = item.type === "file" && isProtonMarkdown(item.name);
    if (item.type === "file") items.push({ action: "open", label: text.open, icon: FileText });
    if (item.type === "file" && onToggleFavorite) items.push({ action: "toggle-favorite",
      label: props.favoriteIds?.has(item.nodeId) ? text.removeFavorite : text.addFavorite, icon: Star });
    if (markdown) items.push({ action: "export", label: text.export, icon: Download });
    if (markdown && item.revisionId && onCaptureTemplate) items.push({
      action: "capture-template", label: portability.captureTemplate, icon: Files,
    });
    if (props.canWrite) {
      if (item.type === "folder") {
        items.push(...createItems);
        if (onCreateTemplate) items.push({ action: "template", label: text.template, icon: Files });
        if (onImport) items.push({ action: "import", label: text.import, icon: Upload });
      }
      if (item.nodeId !== props.rootId) {
        items.push({ action: "rename", label: text.rename, icon: Pencil });
        if (markdown) items.push({ action: "duplicate", label: text.duplicate, icon: Copy });
        items.push({ action: "move", label: text.move, icon: MoveRight }, { action: "trash", label: text.trash, icon: Trash2 });
      }
    }
    if (item.nodeId === props.rootId && onOpenTrash) items.push({ action: "project-trash", label: text.projectTrash, icon: Trash2 });
    if (item.nodeId === props.rootId && onBatchExport) items.push({ action: "batch-export", label: text.batchExport, icon: Download });
    if (item.nodeId === props.rootId && onOpenProfiles) items.push({ action: "shared-profiles", label: portability.sharedProfiles, icon: Settings2 });
    if (item.nodeId === props.rootId && onOpenSharedTemplates) items.push({ action: "shared-templates", label: portability.sharedTemplates, icon: Files });
    if (item.nodeId === props.rootId && onOpenResources) items.push({ action: "resource-catalog", label: text.resources, icon: Files });
    if (item.nodeId === props.rootId && onOpenFavorites) items.push({ action: "favorites", label: text.favorites, icon: Star });
    if (item.nodeId === props.rootId && onOpenPackages) items.push({ action: "project-packages", label: text.packages, icon: Download });
  }

  return <>
    <div className="proton-tree-heading" title={`${text.root} · ${node.name}`} {...drag.target([node])}>
      <h2>{text.files}</h2>
      {(props.canWrite || onOpenTrash || onBatchExport || onOpenResources || onOpenFavorites || onOpenPackages || onOpenProfiles || onOpenSharedTemplates) && <OptionsButton target={{ node, parents: [] }} tree={tree} />}
    </div>
    {onImport && <input ref={filePicker} type="file" hidden multiple onChange={event => {
      const input = event.currentTarget;
      if (!props.disabled && props.canWrite && input.files?.length) {
        onImport(importTarget.current, captureProtonFiles(input.files));
      }
      input.value = "";
    }} />}
    <FolderContents folder={root} tree={tree} parents={[node]} />
    {visibleMenu && items.length > 0 && createPortal(<FloatingTreeMenu key={visibleMenu.node.nodeId}
      items={items} x={visibleMenu.x} y={visibleMenu.y} className="proton-tree-context" focusOnOpen
      label={text.options.replace("{name}",visibleMenu.node.name)} onClose={() => setMenu(null)} onSelect={action => {
        visibleMenu.anchor.focus();
        setMenu(null);
        if (action === "open") props.onOpen(visibleMenu.node, visibleMenu.parents);
        else if (action === "export") props.onExport(visibleMenu.node, visibleMenu.parents);
        else if (action === "project-trash") onOpenTrash?.();
        else if (action === "batch-export") onBatchExport?.();
        else if (action === "shared-profiles") onOpenProfiles?.();
        else if (action === "shared-templates") onOpenSharedTemplates?.();
        else if (action === "capture-template") onCaptureTemplate?.(visibleMenu.node);
        else if (action === "resource-catalog") onOpenResources?.();
        else if (action === "favorites") onOpenFavorites?.();
        else if (action === "toggle-favorite") onToggleFavorite?.(visibleMenu.node.nodeId);
        else if (action === "project-packages") onOpenPackages?.();
        else if (action === "template") onCreateTemplate?.([...visibleMenu.parents, visibleMenu.node]);
        else if (action === "import") {
          importTarget.current = [...visibleMenu.parents, visibleMenu.node];
          filePicker.current?.click();
        }
        else onAction(action, visibleMenu);
      }} />, document.body)}
  </>;
}

function FolderContents({ folder, tree, parents }: { folder: FolderState; tree: BranchProps; parents: ProtonNode[] }) {
  const text = useUiCopy().tree;
  return <>
    {folder.loading && !folder.items.length && <p role="status" className="proton-tree-status">{text.loading}</p>}
    {folder.error && <p role="status" className="proton-tree-status">{text.error}</p>}
    {!folder.loading && !folder.error && !folder.items.length && <p className="proton-tree-status">{text.empty}</p>}
    <ul className="space-y-0.5">{folder.items.map(node => <TreeNode key={node.nodeId} node={node} tree={tree} parents={parents} />)}</ul>
  </>;
}

function OptionsButton({ target, tree }: { target: ProtonTreeTarget; tree: BranchProps }) {
  const text = useUiCopy().tree;
  return <button type="button" className="proton-tree-options" aria-label={text.options.replace("{name}",target.node.name)} aria-haspopup="menu"
    aria-expanded={tree.menuId === target.node.nodeId} disabled={tree.disabled} onClick={event => {
      const anchor = event.currentTarget;
      const bounds = anchor.getBoundingClientRect();
      tree.onMenu({ ...target, anchor, x: bounds.right - 244, y: bounds.bottom + 4 });
    }}><MoreHorizontal size={17} /></button>;
}

function TreeNode({ node, tree, parents }: { node: ProtonNode; tree: BranchProps; parents: ProtonNode[] }) {
  const [expanded, setExpanded] = useState(false);
  const isFolder = node.type === "folder";
  const hasOptions = tree.canWrite || !isFolder;
  const folder = useDriveFolder(tree.accountId, node.nodeId, tree.rootId, tree.refresh, isFolder && expanded);
  const target = { node, parents };
  const hovering = tree.drag.hovered === node.nodeId;
  useEffect(() => {
    if (!isFolder || expanded || !hovering) return;
    const timer = window.setTimeout(() => setExpanded(true), 650);
    return () => window.clearTimeout(timer);
  }, [expanded, hovering, isFolder]);
  return <li>
    <div className="proton-tree-row" data-current={tree.selected === node.nodeId || undefined} {...tree.drag.target([...parents, node])}>
      <button type="button" aria-current={!isFolder && tree.selected === node.nodeId || undefined}
        aria-expanded={isFolder ? expanded : undefined} title={node.name} disabled={tree.disabled} className="proton-tree-item"
        draggable={tree.canWrite && !tree.disabled} onDragStart={event => tree.drag.start(event, target)} onDragEnd={tree.drag.clear}
        onClick={() => isFolder ? setExpanded(value => !value) : tree.onOpen(node, parents)}
        onContextMenu={event => {
          if (!hasOptions || tree.disabled) return;
          event.preventDefault();
          const anchor = event.currentTarget;
          const bounds = anchor.getBoundingClientRect();
          tree.onMenu({ ...target, anchor, x: event.clientX || bounds.left, y: event.clientY || bounds.bottom });
        }} onKeyDown={event => {
          if (!hasOptions || !(event.key === "ContextMenu" || event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const anchor = event.currentTarget;
          const bounds = anchor.getBoundingClientRect();
          tree.onMenu({ ...target, anchor, x: bounds.left, y: bounds.bottom });
        }}>
        {isFolder ? <>
          {expanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
          <Folder size={16} className="proton-tree-folder-icon" />
        </> : <FileText size={16} className="proton-tree-file-icon" />}
        <span className="truncate">{node.name}</span>
        {tree.favoriteIds?.has(node.nodeId) && <Star size={13} aria-hidden="true" className="shrink-0 fill-current text-brand-dark" />}
      </button>
      {hasOptions && <OptionsButton target={target} tree={tree} />}
    </div>
    {expanded && <div className="proton-tree-branch"><FolderContents folder={folder} tree={tree} parents={[...parents, node]} /></div>}
  </li>;
}
