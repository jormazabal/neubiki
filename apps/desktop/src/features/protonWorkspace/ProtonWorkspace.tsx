import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, Cloud, FileText, FolderOpen, Minus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCw, Search, Square, X } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { StatusTag } from "../../components/ui/StatusTag";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { APP_VERSION } from "../../lib/appVersion";
import { ApiError } from "../../lib/api/client";
import { LocalizedNoticeError, getProtonErrorMessage } from "../../lib/i18n/protonErrors";
import * as accounts from "../../lib/api/protonDirect";
import * as api from "../../lib/api/protonWorkspace";
import { isMobileDeviceRuntime, isTauriRuntime } from "../../lib/runtime/platform";
import { closeWindow, minimizeWindow, startWindowDrag, toggleMaximizeWindow } from "../../lib/runtime/windowControls";
import { useWorkspaceExit } from "../../app/useWorkspaceExit";
import type { ProtonAccountStatus } from "../../types/protonDirect";
import type { WorkspaceTab } from "../../types/domain";
import type { MeetingPublicationSource } from "../../lib/api/meetingPublication";
import type { ProtonDocumentJump, ProtonDocumentKey, ProtonImportEntry, ProtonNode, ProtonTreeEdit, ProtonWorkspace as Workspace } from "../../types/protonWorkspace";
import { importProtonTree } from "../../lib/api/protonTreeImport";
import { DrivePicker } from "./DrivePicker";
import { ProtonAccountMenu } from "./ProtonAccountMenu";
import { DocumentTabs } from "../documents/DocumentTabs";
import { ProtonPanelDivider } from "./ProtonPanelDivider";
import { ProtonTree, type ProtonTreeTarget } from "./ProtonTree";
import { ProtonTreeEditDialog } from "./ProtonTreeEditDialog";
import { ProtonImportDialog } from "./ProtonImportDialog";
import { hasDroppedFiles, type LoadProtonImport } from "./protonImportSources";
import { hasUnprotectedEdits, relocatedAncestors, useProtonDocument } from "./useProtonDocument";
import { useWorkspaceAppearance } from "./useWorkspaceAppearance";
import { isProtonHandwritten, isProtonImage, isProtonMarkdown } from "./protonFileKinds";
import { isProtonReferenceName, protonReferenceFormat } from "./protonReferenceFormat";
import { useProtonWorkspaceContinuity } from "./useProtonWorkspaceContinuity";
import { useProtonMobileBack } from "./useProtonMobileBack";
import { useProtonFavorites } from "./useProtonFavorites";
import { useProtonBackupTick } from "./useProtonBackupTick";
import { ProtonBackupControl } from "./ProtonBackupControl";
import { UiLocaleProvider, useUiLocale } from "../../lib/i18n/UiLocale";
import { protonShellCopy } from "./protonShellCopy";
import "./ProtonWorkspace.css";

const DocumentPane = lazy(() => import("./ProtonDocumentPane").then(module => ({ default: module.ProtonDocumentPane })));
const Settings = lazy(() => import("./ProtonSettingsView").then(module => ({ default: module.ProtonSettingsView })));
const Usage = lazy(() => import("../projects/ProjectActions").then(module => ({ default: module.ProtonAiUsageDialog })));
const Recordings = lazy(() => import("../recordings/RecordingPanel").then(module => ({ default: module.RecordingPanel })));
const MeetingSummary = lazy(() => import("../meetings/RecordingSummaryDialog").then(module => ({ default: module.RecordingSummaryDialog })));
const MeetingPublication = lazy(() => import("../meetings/MeetingPublicationDialog").then(module => ({ default: module.MeetingPublicationDialog })));
const Recovery = lazy(() => import("./ProtonRecoveryDialog").then(module => ({ default: module.ProtonRecoveryDialog })));
const Conflict = lazy(() => import("./ProtonConflictDialog").then(module => ({ default: module.ProtonConflictDialog })));
const Trash = lazy(() => import("./ProtonTrashDialog").then(module => ({ default: module.ProtonTrashDialog })));
const AiHistory = lazy(() => import("../assistant/ProtonAiHistoryDialog").then(module => ({ default: module.ProtonAiHistoryDialog })));
const WorkspaceSearch = lazy(() => import("./ProtonSearchDialog").then(module => ({ default: module.ProtonSearchDialog })));
const Template = lazy(() => import("./ProtonTemplateDialog").then(module => ({ default: module.ProtonTemplateDialog })));
const TemplateCapture = lazy(() => import("./ProtonTemplateCaptureDialog").then(module => ({ default: module.ProtonTemplateCaptureDialog })));
const SharedProfiles = lazy(() => import("./ProtonSharedExportProfilesDialog").then(module => ({ default: module.ProtonSharedExportProfilesDialog })));
const SharedTemplates = lazy(() => import("./ProtonSharedTemplatesDialog").then(module => ({ default: module.ProtonSharedTemplatesDialog })));
const BatchExport = lazy(() => import("./ProtonBatchExportDialog").then(module => ({ default: module.ProtonBatchExportDialog })));
const Resources = lazy(() => import("./ProtonResourceCatalogDialog").then(module => ({ default: module.ProtonResourceCatalogDialog })));
const Favorites = lazy(() => import("./ProtonFavoritesDialog").then(module => ({ default: module.ProtonFavoritesDialog })));
const Packages = lazy(() => import("./ProtonPackageDialog").then(module => ({ default: module.ProtonPackageDialog })));

export function ProtonWorkspace({ uploadImage }: {
  uploadImage?: (address: ProtonDocumentKey, file: File) => Promise<string>;
} = {}) {
  const appearance = useWorkspaceAppearance();
  const language = appearance.value.language;
  const copy = protonShellCopy[language];
  const [status, setStatus] = useState<ProtonAccountStatus | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [picker, setPicker] = useState<ProtonNode[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const settingsPending = useRef(false);
  const dialogMutationPending = useRef(false);
  const onDialogMutation = useCallback((pending: boolean) => { dialogMutationPending.current = pending; }, []);
  const onSettingsPending = useCallback((pending: boolean) => { settingsPending.current = pending; }, []);
  const isBusy = useCallback(() => busyRef.current, []);
  const editorCheckpoint = useRef<((key: number) => void) | null>(null);
  const flushEditor = useCallback((key: number) => editorCheckpoint.current?.(key), []);
  const [exitFrozen, setExitFrozen] = useState(false);
  type MessageKey = { [K in keyof typeof copy]: (typeof copy)[K] extends string ? K : never }[keyof typeof copy];
  const [issue, setError] = useState<"" | MessageKey | { cause: unknown; fallback: MessageKey }>("");
  const error = typeof issue === "string" ? issue && copy[issue] : getProtonErrorMessage(issue.cause, copy[issue.fallback], language);
  const [reachable, setReachable] = useState(false);
  const [treeRefresh, setTreeRefresh] = useState(0);
  const [showTree, setShowTree] = useState(true);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [batchExportOpen, setBatchExportOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [treeMenuOpen, setTreeMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const [searchJump, setSearchJump] = useState<(ProtonDocumentJump & { nodeId: string }) | null>(null);
  const clearSearchJump = useCallback(() => setSearchJump(null), []);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [summarySessionId, setSummarySessionId] = useState<string | null>(null);
  const [meetingSource, setMeetingSource] = useState<MeetingPublicationSource | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const [aiSettingsRevision, setAiSettingsRevision] = useState(0);
  const [unsupportedFile, setUnsupportedFile] = useState<{ node: ProtonNode; ancestorIds: string[] } | null>(null);
  const [treeEdit, setTreeEdit] = useState<{ action: ProtonTreeEdit["action"]; target: ProtonTreeTarget; initialDestination?: ProtonNode[] } | null>(null);
  const [treeImport, setTreeImport] = useState<{ destination: ProtonNode[]; load: LoadProtonImport } | null>(null);
  const [templateDestination, setTemplateDestination] = useState<ProtonNode[] | null>(null);
  const [templateSource, setTemplateSource] = useState<{ address: ProtonDocumentKey; revision: string; name: string } | null>(null);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [sharedTemplatesOpen, setSharedTemplatesOpen] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [treeNotice, setTreeNotice] = useState("");
  const [continuityNotice, setContinuityNotice] = useState("");
  const [exportNode, setExportNode] = useState<string | null>(null);
  const treeNav = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftPreference, setLeftWidth] = useState(246);
  const [rightPreference, setRightWidth] = useState(342);
  const [resizing, setResizing] = useState(false);
  const leftPanelId = useId();
  const rightPanelId = useId();
  const minLeft = 176;
  const minRight = 240;
  const maxWidth = Math.min(560, Math.floor(viewportWidth * .31));
  const leftWidth = Math.max(minLeft, Math.min(leftPreference, maxWidth));
  const rightWidth = Math.max(minRight, Math.min(rightPreference, maxWidth));
  const leftHidden = viewportWidth >= 768 && !leftOpen;
  const rightHidden = viewportWidth > 1100 && !rightOpen;
  const layoutStyle = {
    "--proton-left-width": `${leftWidth}px`,
    "--proton-right-width": `${rightWidth}px`,
  } as CSSProperties;
  const documentState = useProtonDocument(() => setError("draftFailed"), flushEditor);
  const { opened, tabs, edited, clear, open, select, close, reorder, markRemoteChanged, protect } = documentState;
  const disabled = busy || exitFrozen;
  const native = isTauriRuntime();

  useEffect(() => {
    if (!native) return;
    const open = () => setRecordingsOpen(true);
    window.addEventListener("neubiki-open-recordings", open);
    const bridge = (window as Window & { NeubikiRecordingIntent?: { consumeRecordingIntent: () => boolean } }).NeubikiRecordingIntent;
    if (bridge?.consumeRecordingIntent()) open();
    return () => window.removeEventListener("neubiki-open-recordings", open);
  }, [native]);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (settingsOpen || !settingsOpener.current) return;
    const opener = settingsOpener.current;
    settingsOpener.current = null;
    if (opener.isConnected && !opener.closest("[hidden],[inert]")) opener.focus({ preventScroll: true });
  }, [settingsOpen]);

  useEffect(() => {
    function preventFileNavigation(event: DragEvent) {
      if (event.defaultPrevented || !event.dataTransfer || !hasDroppedFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "none";
    }
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  async function run<T>(action: () => Promise<T>, fallback: MessageKey) {
    if (busyRef.current || exitFrozen || dialogMutationPending.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try { return await action(); }
    catch (cause) { setError({ cause, fallback }); }
    finally { busyRef.current = false; setBusy(false); }
  }

  const updateStatus = useCallback((next: ProtonAccountStatus) => {
    setStatus(next);
    setAccountId(previous => {
      if (next.account?.state === "connected" && !previous) return next.account.id;
      return previous;
    });
  }, []);

  useEffect(() => {
    if (!native) { setLoading(false); return; }
    const request = new AbortController();
    void Promise.allSettled([accounts.getProtonAccount(), api.currentWorkspace(request.signal)]).then(([account, selection]) => {
      if (request.signal.aborted) return;
      if (account.status === "fulfilled") updateStatus(account.value);
      else setError({ cause: account.reason, fallback: "accountFailed" });
      if (selection.status === "fulfilled" && selection.value) {
        setWorkspace(selection.value);
        setAccountId(selection.value.accountId);
      }
      setLoading(false);
    });
    return () => request.abort();
  }, [native, updateStatus]);

  const attempt = status?.attempt;
  const connectionId = attempt?.state === "pending" ? attempt.connectionId : undefined;
  useEffect(() => {
    if (!connectionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const declaredExpiry = attempt?.expiresAt ? Date.parse(attempt.expiresAt) : NaN;
    const expiry = Number.isFinite(declaredExpiry) ? declaredExpiry : Date.now() + 600_000;
    async function poll() {
      if (!active || Date.now() >= expiry || !connectionId) return;
      if (!busyRef.current) {
        try {
          const next = await accounts.pollProtonConnection(connectionId);
          if (active && !busyRef.current) {
            updateStatus(next);
            if (next.attempt?.state !== "pending") return;
          }
        } catch {
          if (active) setError("authorizationRetry");
          return;
        }
      }
      if (active) timer = setTimeout(() => { void poll(); }, 5_000);
    }
    timer = setTimeout(() => { void poll(); }, 5_000);
    return () => { active = false; clearTimeout(timer); };
  }, [attempt?.expiresAt, connectionId, updateStatus]);

  const connectedAccounts = (status?.accounts ?? (status?.account ? [status.account] : [])).filter(account => account.state === "connected");
  const selectedAccount = connectedAccounts.find(account => account.id === accountId) ?? connectedAccounts[0];
  const rootId = workspace?.root.nodeId;
  const bindingAccount = workspace?.accountId;
  const workspaceAccount = connectedAccounts.find(account => account.id === bindingAccount);
  const hasWorkspaceAccount = Boolean(workspaceAccount);
  const showWorkspace = !picker && Boolean(workspace && hasWorkspaceAccount);
  const favoriteScope = { accountId: bindingAccount ?? "", rootId: rootId ?? "" };
  const favorites = useProtonFavorites({ scope: favoriteScope, connected: native && showWorkspace && reachable,
    canWrite: workspace?.canWrite ?? false, language });
  const refreshFavorites = favorites.refresh;
  const favoriteIds = new Set(favorites.ids);
  useProtonBackupTick(bindingAccount, rootId, native && showWorkspace && reachable && !disabled && !packagesOpen && !settingsOpen);
  useProtonWorkspaceContinuity({
    enabled: native, ready: showWorkspace && reachable && !busy && !exitFrozen,
    scope: bindingAccount && rootId ? { accountId: bindingAccount, rootId } : null,
    snapshot: { nodeIds: tabs.map(tab => tab.address.nodeId), activeId: opened?.address.nodeId ?? null,
      showTree, leftOpen, rightOpen, leftWidth: leftPreference, rightWidth: rightPreference },
    supportsFile: isSupportedFile,
    canApply: () => !busyRef.current && !exitFrozen && !picker,
    onRestore: ({ tabs: restored, activeId, layout, unavailableCount }) => {
      for (const tab of restored) open(tab.address, tab.document);
      select(activeId);
      setShowTree(!activeId || layout.showTree);
      setLeftOpen(layout.leftOpen); setRightOpen(layout.rightOpen);
      setLeftWidth(layout.leftWidth); setRightWidth(layout.rightWidth);
      if (unavailableCount) setContinuityNotice(copy.continuityNotice(unavailableCount));
    },
  });
  const updateReachability = useCallback((success: boolean) => setReachable(success && navigator.onLine), []);

  useEffect(() => {
    if (!rootId || !bindingAccount || !hasWorkspaceAccount) return;
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let cursor: string | null = null;
    async function check() {
      if (!rootId || !bindingAccount || request.signal.aborted) return;
      try {
        if (navigator.onLine && !document.hidden) {
          const event = await api.getWorkspaceEvents(bindingAccount, rootId, cursor, request.signal);
          if (request.signal.aborted) return;
          cursor = event.cursor;
          updateReachability(true);
          if (event.changed || event.requiresRefresh) {
            setTreeRefresh(value => value + 1);
            markRemoteChanged();
            refreshFavorites();
          }
        }
      } catch { if (!request.signal.aborted) updateReachability(false); }
      if (!request.signal.aborted) timer = setTimeout(() => { void check(); }, 20_000);
    }
    function offline() { updateReachability(false); }
    function refresh() { setTreeRefresh(value => value + 1); }
    window.addEventListener("offline", offline);
    window.addEventListener("online", refresh);
    timer = setTimeout(() => { void check(); }, 5_000);
    return () => {
      request.abort();
      clearTimeout(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", refresh);
    };
  }, [bindingAccount, rootId, hasWorkspaceAccount, updateReachability, markRemoteChanged, refreshFavorites]);

  useWorkspaceExit({
    freeze: () => setExitFrozen(true),
    unfreeze: () => setExitFrozen(false),
    hasPendingSettings: () => busyRef.current || dialogMutationPending.current || settingsPending.current || appearance.hasPending(),
    protect: async () => { await protect(); return true; },
    failed: () => setError("exitBlocked"),
  });

  function chooseRoot() {
    if (!selectedAccount) return;
    void run(async () => {
      await protect();
      const { root } = await api.readDriveRoot(selectedAccount.id);
      setAccountId(selectedAccount.id);
      setPicker([root]);
      setSettingsOpen(false);
    }, "openRootFailed");
  }

  function selectRoot(node: ProtonNode) {
    if (!selectedAccount) return;
    void run(async () => {
      const selected = await api.selectDriveFolder(selectedAccount.id, node.nodeId);
      clear();
      setUnsupportedFile(null);
      setReachable(false);
      setWorkspace(selected);
      setPicker(null);
      setTreeNotice("");
      setShowTree(true);
      setTreeRefresh(value => value + 1);
    }, "selectRootFailed");
  }

  function selectTab(id: string, onSelected?: () => void) {
    if (documentState.getCurrent()?.address.nodeId === id) {
      setShowTree(false);
      onSelected?.();
      return;
    }
    void run(async () => {
      await protect();
      select(id);
      setUnsupportedFile(null);
      setShowTree(false);
      onSelected?.();
    }, "selectTabFailed");
  }

  function closeTabs(ids: string[]) {
    void run(async () => {
      const active = documentState.getCurrent();
      if (active && ids.includes(active.address.nodeId)) await protect();
      close(ids);
      if (!documentState.getCurrent() && !unsupportedFile) setShowTree(true);
    }, "closeTabFailed");
  }

  function openFile(node: ProtonNode, reload = false, parents?: ProtonNode[], onOpened?: () => void) {
    if (!reload && tabs.some(tab => tab.address.nodeId === node.nodeId && !tab.needsDraftReload)) {
      documentState.updateTreeNode(node, parents?.map(parent => parent.nodeId));
      selectTab(node.nodeId, onOpened);
      return;
    }
    if (!rootId || !bindingAccount || !reachable) return;
    void run(async () => {
      await protect();
      if (!isSupportedFile(node.name)) {
        select(null);
        setUnsupportedFile({ node, ancestorIds: parents?.map(parent => parent.nodeId) ?? [] });
        setShowTree(false);
        return;
      }
      const address = { accountId: bindingAccount, rootId, nodeId: node.nodeId };
      let snapshot;
      try { snapshot = await api.readDocument(address); }
      catch (cause) {
        setError({ cause, fallback: "openFileUnreachable" });
        return;
      }
      open(address, snapshot, parents?.map(parent => parent.nodeId));
      setUnsupportedFile(null);
      setShowTree(false);
      onOpened?.();
    }, "openFileFailed");
  }

  function applyTreeEdit(edit: ProtonTreeEdit, destination: string[]) {
    if (!workspace?.canWrite || !rootId || !bindingAccount) return;
    setTreeError("");
    void run(async () => {
      try { await protect(); }
      catch { setTreeError(copy.protectTreeDraft); return; }
      try {
        const result = await api.editTree(bindingAccount, rootId, edit);
        setTreeRefresh(value => value + 1);
        setTreeEdit(null);
        if ("trashedId" in result) {
          const { trashedId } = result;
          close(tabs.filter(tab => tab.address.nodeId === trashedId || tab.ancestorIds.includes(trashedId)).map(tab => tab.address.nodeId));
          const previewTrashed = unsupportedFile && (unsupportedFile.node.nodeId === trashedId || unsupportedFile.ancestorIds.includes(trashedId));
          if (previewTrashed) setUnsupportedFile(null);
          if (!documentState.getCurrent() && (!unsupportedFile || previewTrashed)) setShowTree(true);
          setTreeNotice(copy.movedToTrash(edit.action === "trash" ? edit.expectedName : undefined));
        } else if (edit.action === "rename" || edit.action === "move") {
          const movedTo = edit.action === "move" ? destination : undefined;
          documentState.updateTreeNode(result.node, movedTo);
          setUnsupportedFile(previous => previous && {
            node: previous.node.nodeId === result.node.nodeId ? result.node : previous.node,
            ancestorIds: movedTo ? relocatedAncestors(previous.ancestorIds, previous.node.nodeId, result.node.nodeId, movedTo) : previous.ancestorIds,
          });
          setTreeNotice(edit.action === "rename" ? copy.renamed(result.node.name) : copy.moved(result.node.name));
        } else {
          setTreeNotice(copy.created(result.node.name));
        }
      } catch (cause) {
        setTreeRefresh(value => value + 1);
        if (cause instanceof ApiError && (cause.operationOutcome === "not-started" || cause.operationOutcome === "not-applied")) {
          setTreeError(getProtonErrorMessage(cause, copy.operationFailed, language));
        } else {
          setTreeEdit(null);
          setError("treeUnconfirmed");
        }
      }
    }, "treeFailed");
  }

  function applyTreeImport(entries: ProtonImportEntry[], onProgress: (confirmed: number) => void) {
    const path = treeImport?.destination ?? [];
    const destinationId = path[path.length - 1]?.nodeId;
    if (!destinationId || !rootId || !bindingAccount || !workspace?.canWrite || !reachable) return Promise.resolve(undefined);
    return run(async () => {
      await protect();
      const result = await importProtonTree(bindingAccount, rootId, destinationId, entries, onProgress);
      setTreeRefresh(value => value + 1);
      return result;
    }, "protectImportDraft");
  }

  function disconnect() {
    const target = (workspaceAccount ?? selectedAccount)?.id;
    if (!target) return;
    void run(async () => {
      await protect();
      updateStatus(await accounts.disconnectProtonAccount(target));
      clear();
      setUnsupportedFile(null);
      setWorkspace(null);
      setReachable(false);
      setShowTree(true);
      setConfirmDisconnect(false);
    }, "signOutFailed");
  }

  function connect() {
    void run(async () => updateStatus(await accounts.startProtonConnection()), "startConnectionFailed");
  }

  function openSettings() {
    const opener = document.activeElement;
    void run(async () => {
      await protect();
      settingsOpener.current = opener instanceof HTMLElement ? opener : null;
      setSettingsOpen(true);
    }, "settingsFailed");
  }

  const canSearch = native && showWorkspace && reachable && !disabled && !settingsOpen && !picker;
  function toggleFavorite(nodeId: string) {
    if (favorites.canToggle) void run(async () => {
      await protect();
      await favorites.toggle(nodeId);
    }, "protectFavoritesFailed");
  }
  useProtonMobileBack(Boolean(treeMenuOpen || accountMenuOpen || picker || settingsOpen || recoveryOpen || conflictOpen || trashOpen || batchExportOpen || resourcesOpen || favoritesOpen || packagesOpen || profilesOpen || sharedTemplatesOpen || aiHistoryOpen
    || usageOpen || recordingsOpen || meetingSource || searchOpen || treeEdit || treeImport || templateDestination || templateSource || confirmDisconnect || (showWorkspace && !showTree)), () => {
    if (disabled || dialogMutationPending.current) return;
    if (meetingSource) setMeetingSource(null);
    else if (searchOpen) setSearchOpen(false);
    else if (templateDestination) setTemplateDestination(null);
    else if (templateSource) setTemplateSource(null);
    else if (aiHistoryOpen) setAiHistoryOpen(false);
    else if (trashOpen) setTrashOpen(false);
    else if (batchExportOpen) setBatchExportOpen(false);
    else if (profilesOpen) setProfilesOpen(false);
    else if (sharedTemplatesOpen) setSharedTemplatesOpen(false);
    else if (resourcesOpen) setResourcesOpen(false);
    else if (favoritesOpen) setFavoritesOpen(false);
    else if (packagesOpen) setPackagesOpen(false);
    else if (conflictOpen) setConflictOpen(false);
    else if (recoveryOpen) setRecoveryOpen(false);
    else if (usageOpen) setUsageOpen(false);
    else if (settingsOpen) setSettingsOpen(false);
    else if (picker) setPicker(picker.length > 1 ? picker.slice(0, -1) : null);
    else if (showWorkspace) setShowTree(true);
  });
  const mobileView = showWorkspace ? showTree ? "tree" : "file" : "setup";
  const documentTabs = showWorkspace && tabs.length > 0 ? <nav className="proton-document-tabs" aria-label={copy.tabs}>
    <DocumentTabs tabs={tabs.map(({ address, document }): WorkspaceTab => document.handwritten
      ? { kind: "handwritten-note", id: address.nodeId, name: document.node.name }
      : document.markdown === null
      ? isProtonImage(document.node.name)
        ? { kind: "image", id: address.nodeId, name: document.node.name, path: document.node.name }
        : { kind: "reference-document", id: address.nodeId, name: document.node.name, path: document.node.name,
          format: protonReferenceFormat(document.node.name) ?? "text", readonly: true }
      : { kind: "document", id: address.nodeId, name: document.node.name })}
      activeTabId={opened?.address.nodeId ?? ""}
      dirtyDocumentIds={tabs.filter(tab => tab.draft || tab.uncertain || hasUnprotectedEdits(tab)).map(tab => tab.address.nodeId)}
      onSelectTab={selectTab} onCloseTab={id => closeTabs([id])} onCloseTabs={closeTabs}
      onReorderDocumentTabs={(dragged, target, placement) => { if (!disabled) reorder(dragged, target, placement); }} />
  </nav> : null;

  return <UiLocaleProvider language={language}><div className="proton-workspace flex h-dvh min-h-0 flex-col text-ink-primary" style={layoutStyle}
    data-left-open={leftOpen} data-right-open={rightOpen} data-resizing={resizing} onKeyDown={event => {
      if (!canSearch || searchOpen || event.defaultPrevented || event.nativeEvent.isComposing || !event.shiftKey
        || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f" || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setSearchOpen(true);
    }}>
    <header className="proton-workspace-chrome flex min-h-14 shrink-0 items-center gap-2 px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2" onPointerDown={event => { if (native && !isMobileDeviceRuntime() && event.button === 0) void startWindowDrag(); }}>
        <span className="proton-workspace-brand size-7 shrink-0 rounded-lg" aria-hidden="true" />
        <span className="text-base font-semibold">Neubiki</span>
        <span className="proton-workspace-version text-xs">{APP_VERSION}</span>
      </div>
      {!settingsOpen && <>
        <button type="button" className="proton-panel-toggle" data-side="left" aria-controls={leftPanelId} aria-expanded={leftOpen}
          aria-label={leftOpen ? copy.hideFiles : copy.showFiles} title={leftOpen ? copy.hideFiles : copy.showFiles}
          onClick={() => setLeftOpen(value => !value)}>{leftOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>
        <button type="button" className="proton-panel-toggle" data-side="right" aria-controls={rightPanelId} aria-expanded={rightOpen}
          aria-label={rightOpen ? copy.hideTools : copy.showTools} title={rightOpen ? copy.hideTools : copy.showTools}
          onClick={() => setRightOpen(value => !value)}>{rightOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button>
      </>}
      {native && !isMobileDeviceRuntime() && <div className="flex">
        <button aria-label={copy.minimize} className="rounded p-2 hover:bg-brand-hover" onClick={() => void minimizeWindow()}><Minus size={16} /></button>
        <button aria-label={copy.maximize} className="rounded p-2 hover:bg-white/10" onClick={() => void toggleMaximizeWindow()}><Square size={14} /></button>
        <button aria-label={copy.close} className="rounded p-2 hover:bg-white/10" onClick={() => void closeWindow()}><X size={17} /></button>
      </div>}
    </header>
    {error && !confirmDisconnect && <div className="proton-workspace-notice">
      <InlineNotice tone="error" announce="alert" action={<Button variant="quiet" size="icon" aria-label={copy.dismiss} onClick={() => setError("")}>
        <X size={17} aria-hidden="true" />
      </Button>}>{error}</InlineNotice>
    </div>}
    {continuityNotice && <div className="proton-workspace-notice">
      <InlineNotice tone="warning" announce="status" action={<Button variant="quiet" size="icon" aria-label={copy.dismissSession}
        onClick={() => setContinuityNotice("")}><X size={17} aria-hidden="true" /></Button>}>{continuityNotice}</InlineNotice>
    </div>}
    <div className="proton-workspace-grid" data-mobile-view={mobileView} hidden={settingsOpen}>
      <aside id={leftPanelId} className="proton-workspace-rail" aria-label={copy.navigation}
        aria-hidden={leftHidden || undefined} ref={element => { if (element) element.inert = leftHidden; }}>
        {showWorkspace && tabs.length > 0 && <button type="button" className="proton-mobile-back"
          onClick={() => { if (!opened) selectTab(tabs[0].address.nodeId); else setShowTree(false); }}>
          <FileText size={16} /> {copy.openDocuments}
        </button>}
        {showWorkspace && workspace && <>
          <div className="proton-workspace-folder">
            <div className="proton-workspace-folder-heading">
              <button type="button" className="proton-workspace-folder-control" aria-label={copy.chooseWorkspace} title={copy.chooseWorkspace}
                onClick={chooseRoot} disabled={disabled}>
                <FolderOpen size={17} /><span title={workspace.root.name}>{workspace.root.name}</span>
              </button>
              <button type="button" className="proton-rail-icon" aria-label={copy.refreshConnection} title={copy.refreshFiles}
                onClick={() => setTreeRefresh(value => value + 1)} disabled={disabled}><RefreshCw size={16} /></button>
            </div>
            <StatusTag role="status" tone={reachable ? "connection" : "warning"} className="proton-workspace-connection">
              {reachable ? copy.online : copy.unconfirmed}
            </StatusTag>
          </div>
          {native && <button ref={searchTrigger} type="button" className="proton-tree-item" disabled={!canSearch}
            aria-keyshortcuts="Control+Shift+F" onClick={() => setSearchOpen(true)}><Search size={16} aria-hidden="true" /> {copy.search}</button>}
          <nav ref={treeNav} aria-label={copy.tree} className="proton-workspace-tree">
            <ProtonTree key={`${workspace.accountId}:${workspace.root.nodeId}`} node={workspace.root} accountId={workspace.accountId} rootId={workspace.root.nodeId} refresh={treeRefresh}
              selected={opened?.address.nodeId ?? unsupportedFile?.node.nodeId} disabled={disabled || !reachable} canWrite={workspace.canWrite}
              onOpenTrash={native ? () => setTrashOpen(true) : undefined}
              onBatchExport={native ? () => setBatchExportOpen(true) : undefined}
              onOpenProfiles={native ? () => setProfilesOpen(true) : undefined}
              onOpenSharedTemplates={native ? () => setSharedTemplatesOpen(true) : undefined}
              onOpenResources={native ? () => setResourcesOpen(true) : undefined}
              favoriteIds={favoriteIds}
              onOpenFavorites={native ? () => setFavoritesOpen(true) : undefined}
              onToggleFavorite={favorites.canToggle ? toggleFavorite : undefined}
              onOpenPackages={native ? () => setPackagesOpen(true) : undefined}
              onMenuChange={setTreeMenuOpen}
              onOpen={(node, parents) => openFile(node, false, parents)}
              onExport={(node, parents) => openFile(node, false, parents, () => setExportNode(node.nodeId))}
              onMove={(target, destination) => {
                setTreeNotice(""); setTreeError(""); setTreeEdit({ action: "move", target, initialDestination: destination });
              }}
              onImport={native ? (destination, load) => {
                setTreeNotice(""); setTreeImport({ destination, load });
              } : undefined}
              onCreateTemplate={native && reachable ? destination => {
                setTreeNotice(""); setTemplateDestination(destination);
              } : undefined}
              onCaptureTemplate={native && reachable ? node => {
                const revision = node.revisionId;
                if (!revision) return;
                const address = { accountId: workspace.accountId, rootId: workspace.root.nodeId, nodeId: node.nodeId };
                void run(async () => {
                  await protect();
                  setTemplateSource({ address, revision, name: node.name });
                }, "templateCaptureProtection");
              } : undefined}
              onReachability={updateReachability} onAction={(action, target) => {
                setTreeNotice(""); setTreeError(""); setTreeEdit({ action, target });
              }} />
            {treeNotice && <StatusTag role="status" tone="success" className="proton-tree-status">{treeNotice}</StatusTag>}
          </nav>
        </>}
        <div className="proton-rail-footer">
          {connectionId && <div className="proton-auth-pending">
            <p role="status">{copy.awaitingAuth}</p>
            <div>
              <button type="button" disabled={disabled} onClick={() => { void run(async () => updateStatus(await accounts.pollProtonConnection(connectionId)), "authorizationFailed"); }}>{copy.check}</button>
              <button type="button" disabled={disabled} onClick={() => { void run(async () => updateStatus(await accounts.cancelProtonConnection(connectionId)), "cancelConnectionFailed"); }}>{copy.cancel}</button>
            </div>
          </div>}
          <ProtonAccountMenu account={workspaceAccount ?? selectedAccount} canConnect={Boolean(native && status?.available)}
            onMenuChange={setAccountMenuOpen}
            pending={Boolean(connectionId)} disabled={disabled || loading} onConnect={connect}
            onDisconnect={() => { setError(""); setConfirmDisconnect(true); }}
            onSettings={openSettings} onUsage={() => setUsageOpen(true)} onRecordings={native ? () => setRecordingsOpen(true) : undefined}
            onRecovery={native ? () => { void run(async () => { await protect(); setRecoveryOpen(true); }, "protectOpenDraftFailed"); } : undefined}
            onAiHistory={native ? () => setAiHistoryOpen(true) : undefined} />
        </div>
      </aside>
      {viewportWidth >= 768 && leftOpen && <ProtonPanelDivider side="left" controls={leftPanelId} width={leftWidth}
        min={minLeft} max={maxWidth} onWidthChange={setLeftWidth} onDragChange={setResizing} />}
      <main className="proton-workspace-content">
        {showWorkspace && <button type="button" className="proton-mobile-back" onClick={() => setShowTree(true)}><ArrowLeft size={16} /> {copy.files}</button>}
        {showWorkspace && workspace && opened ? <Suspense fallback={<EmptyWorkspace toolsId={rightPanelId} toolsHidden={rightHidden} tabs={documentTabs}><p role="status" className="p-6">{copy.loadingEditor}</p></EmptyWorkspace>}>
              <DocumentPane document={opened} workspaceRoot={workspace.root} getCurrent={documentState.getCurrent} isBusy={isBusy} uploadImage={uploadImage}
                aiSettingsRevision={aiSettingsRevision} onCheckAiUsage={() => setUsageOpen(true)}
                editorCheckpoint={editorCheckpoint} edited={edited} connected={reachable} busy={disabled} canWrite={workspace.canWrite}
                tabs={documentTabs} toolsId={rightPanelId} toolsHidden={rightHidden} compact={viewportWidth < 768} onShowTools={() => setRightOpen(true)}
                onCollapseTools={viewportWidth > 1100 ? () => setRightOpen(false) : undefined}
                onEdit={documentState.edit} onEditHandwritten={documentState.editHandwritten} onReload={() => openFile(opened.document.node, true)}
                onProtectNote={documentState.protect} onNoteAiApplied={documentState.acceptHandwrittenAiDraft}
                exportRequested={opened.address.nodeId === exportNode} onExportRequestHandled={() => setExportNode(null)}
                onProtect={() => { void run(protect, "draftFailed"); }}
                onSave={() => { if (reachable && workspace.canWrite) void run(documentState.save, "saveUnconfirmed"); }}
                onReconcile={() => { void run(documentState.reconcile, "revisionCheckFailed"); }}
                onReviewConflict={() => setConflictOpen(true)}
                onOpenReference={(node, location) => openFile(node, false, undefined, () => setSearchJump(location
                  ? { nodeId: node.nodeId, revisionId: location.revisionId, line: location.line, query: "" } : null))}
                searchJump={searchJump?.nodeId === opened.address.nodeId ? searchJump : null} onSearchJumpHandled={clearSearchJump}
                onDiscard={() => { void run(documentState.discard, "discardFailed"); }} />
          </Suspense> : <EmptyWorkspace toolsId={rightPanelId} toolsHidden={rightHidden} tabs={documentTabs}>
          {loading ? <p role="status" className="p-6">{copy.preparing}</p>
            : picker && selectedAccount ? <DrivePicker key={picker[picker.length - 1].nodeId} accountId={selectedAccount.id} path={picker} busy={disabled}
              onBack={() => setPicker(picker.length > 1 ? picker.slice(0, -1) : null)}
              onOpen={node => setPicker([...picker, node])} onSelect={selectRoot} />
            : showWorkspace ? <section className="proton-workspace-start">
              <FileText size={32} className="text-brand-dark" />
              <h1>{unsupportedFile?.node.name ?? copy.openDocument}</h1>
              <p>{unsupportedFile ? copy.supported : copy.selectFile}</p>
            </section> : <section className="proton-workspace-start" aria-labelledby="proton-welcome">
              <Cloud size={32} className="text-brand-dark" />
              <h1 id="proton-welcome">{copy.welcome}</h1>
              {!native || !status?.available ? <p role="status">{native ? copy.nativeUnavailable : copy.nativeOnly}</p>
                : selectedAccount ? <>
                  <p>{copy.chooseHelp}</p>
                  <Button variant="primary" onClick={chooseRoot} disabled={disabled}>{copy.choose}</Button>
                </> : <>
                  <p>{copy.connectHelp}</p>
                  {!connectionId && <Button variant="primary" onClick={connect} disabled={disabled}>{copy.connect}</Button>}
                </>}
            </section>}
        </EmptyWorkspace>}
        {viewportWidth > 1100 && rightOpen && <ProtonPanelDivider side="right" controls={rightPanelId} width={rightWidth}
          min={minRight} max={maxWidth} onWidthChange={setRightWidth} onDragChange={setResizing} />}
      </main>
    </div>
    {treeEdit && workspace && <ProtonTreeEditDialog accountId={workspace.accountId} root={workspace.root} {...treeEdit}
      busy={disabled} error={treeError} onClose={() => { if (!busyRef.current) setTreeEdit(null); }} onApply={applyTreeEdit}
      fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />}
    {treeImport && workspace && <ProtonImportDialog {...treeImport} disabled={disabled || !reachable}
      onClose={() => setTreeImport(null)} onApply={applyTreeImport}
      fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />}
    {templateDestination && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingTemplates}</p>}>
      <Template accountId={workspace.accountId} root={workspace.root} destination={templateDestination}
        connected={reachable} canWrite={workspace.canWrite}
        beforeCreate={async () => {
          if (busyRef.current || exitFrozen || !reachable || !workspace.canWrite) {
            throw new LocalizedNoticeError(copy.connectionBeforeCreate);
          }
          await protect();
        }}
        onCreatePending={onDialogMutation}
        onCreated={node => {
          setTreeRefresh(value => value + 1);
          setTreeNotice(copy.created(node.name));
        }}
        onClose={() => setTemplateDestination(null)}
        fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />
    </Suspense>}
    {templateSource && workspace && templateSource.address.accountId === workspace.accountId
      && templateSource.address.rootId === workspace.root.nodeId
      && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingTemplateCapture}</p>}>
        <TemplateCapture workspace={workspace} documentKey={templateSource.address} revisionId={templateSource.revision}
          documentName={templateSource.name} connected={reachable} onPendingChange={onDialogMutation}
          onClose={() => setTemplateSource(null)}
          fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />
      </Suspense>}
    {profilesOpen && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingProfiles}</p>}>
      <SharedProfiles key={JSON.stringify([workspace.accountId, workspace.root.nodeId])}
        scope={{ accountId: workspace.accountId, rootId: workspace.root.nodeId }}
        connected={reachable} canWrite={workspace.canWrite} onPending={onDialogMutation}
        onClose={() => setProfilesOpen(false)}
        fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />
    </Suspense>}
    {sharedTemplatesOpen && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingSharedTemplates}</p>}>
      <SharedTemplates key={JSON.stringify([workspace.accountId, workspace.root.nodeId])}
        workspace={workspace} connected={reachable} onPendingChange={onDialogMutation}
        onClose={() => setSharedTemplatesOpen(false)}
        fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />
    </Suspense>}
    {settingsOpen && <Suspense fallback={<p role="status" className="px-4 py-3 text-white">{copy.loadingSettings}</p>}>
      <Settings appearance={appearance} accounts={connectedAccounts} selectedAccountId={selectedAccount?.id} native={native}
        workspaceBusy={disabled} folderPickerOpen={Boolean(picker)} onChooseAccount={setAccountId} onChooseFolder={chooseRoot}
        onPendingChange={onSettingsPending}
        freezeForUpdate={() => flushSync(() => setExitFrozen(true))} unfreezeAfterUpdate={() => setExitFrozen(false)}
        protectForUpdate={async () => { if (busyRef.current) return false; await protect(); return true; }}
        onOpenAiHistory={native ? () => setAiHistoryOpen(true) : undefined}
        onAiSaved={() => setAiSettingsRevision(revision => revision + 1)} onBack={() => setSettingsOpen(false)} />
    </Suspense>}
    {confirmDisconnect && <ModalFrame label={copy.signOutLabel} onClose={() => { if (!disabled) setConfirmDisconnect(false); }}>
      <section className="proton-confirm-dialog p-5">
        <h2 className="text-lg font-semibold">{copy.signOutTitle}</h2>
        <p className="mt-2 text-sm text-ink-secondary">{copy.signOutHelp}</p>
        {error && <div className="mt-3"><InlineNotice tone="error" announce="alert">{error}</InlineNotice></div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button data-autofocus disabled={disabled} onClick={() => setConfirmDisconnect(false)}>Cancelar</Button>
          <Button variant="danger" disabled={disabled} onClick={disconnect}>{copy.signOut}</Button>
        </div>
      </section>
    </ModalFrame>}
    {usageOpen && <Suspense fallback={<p role="status" className="proton-account-loading">Cargando…</p>}>
      <Usage onClose={() => setUsageOpen(false)} />
    </Suspense>}
    {recoveryOpen && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingRecovery}</p>}>
      <Recovery workspace={workspace} onClose={() => setRecoveryOpen(false)} />
    </Suspense>}
    {conflictOpen && opened && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingReview}</p>}>
      <Conflict key={opened.editorKey} address={opened.address} name={opened.document.node.name}
        onClose={() => setConflictOpen(false)} onResolved={resolved => {
          const current = documentState.getCurrent();
          if (current?.editorKey === opened.editorKey) open(opened.address, resolved);
          setConflictOpen(false);
        }} />
    </Suspense>}
    {trashOpen && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">Abriendo papelera…</p>}>
      <Trash accountId={workspace.accountId} rootId={workspace.root.nodeId} canRestore={workspace.canWrite && reachable}
        onRestored={() => setTreeRefresh(value => value + 1)} onClose={() => setTrashOpen(false)}
        fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />
    </Suspense>}
    {batchExportOpen && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingBatch}</p>}>
      <BatchExport workspace={workspace} connected={reachable}
        beforePrepare={async () => {
          if (busyRef.current || exitFrozen || !reachable) throw new LocalizedNoticeError(copy.connectionBeforeExport);
          await protect();
        }}
        onPendingChange={onDialogMutation} onClose={() => setBatchExportOpen(false)}
        fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />
    </Suspense>}
    {resourcesOpen && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingResources}</p>}>
      <Resources accountId={workspace.accountId} root={workspace.root} connected={reachable}
        onOpen={(node, parents) => { setResourcesOpen(false); openFile(node, false, parents); }}
        onClose={() => setResourcesOpen(false)}
        fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />
    </Suspense>}
    {favoritesOpen && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingFavorites}</p>}>
      <Favorites key={JSON.stringify([bindingAccount, rootId])} scope={favoriteScope} connected={reachable} canToggle={favorites.canToggle}
        pending={disabled || favorites.busy || favorites.phase === "checking"} unknown={favorites.phase === "unknown"}
        mutationError={favorites.error} updatedAt={favorites.updatedAt} onCheck={() => { void favorites.check(); }}
        pendingReview={favorites.pendingReview} closedWithoutConfirmation={favorites.closedWithoutConfirmation}
        onClosePending={reviewKey => { void favorites.check(reviewKey); }}
        onOpen={node => { setFavoritesOpen(false); openFile(node); }} onToggle={toggleFavorite}
        onClose={() => setFavoritesOpen(false)}
        fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />
    </Suspense>}
    {packagesOpen && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingPackages}</p>}>
      <Packages workspace={workspace} connected={reachable} beforePrepare={protect} onPendingChange={onDialogMutation}
        backupControl={<ProtonBackupControl scope={{ accountId: workspace.accountId, rootId: workspace.root.nodeId }} disabled={disabled} />}
        onRestored={() => setTreeRefresh(value => value + 1)}
        onClose={() => setPackagesOpen(false)}
        fallbackFocus={() => treeNav.current?.querySelector("button:not(:disabled)") ?? null} />
    </Suspense>}
    {aiHistoryOpen && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingHistory}</p>}>
      <AiHistory onClose={() => setAiHistoryOpen(false)} />
    </Suspense>}
    {searchOpen && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingSearch}</p>}>
      <WorkspaceSearch key={`${workspace.accountId}:${workspace.root.nodeId}`} workspace={workspace} connected={reachable}
        suggestionAnchor={opened && opened.document.markdown !== null
          ? { ...opened.address, baseRevisionId: opened.document.revisionId } : undefined}
        onBeforeReplaceReview={protect}
        onReplacePending={onDialogMutation}
        onReplaced={async nodeIds => {
          if (!await documentState.refreshPreparedDrafts(nodeIds)) {
            setError("reloadPreparedDrafts");
          }
        }}
        onClose={() => setSearchOpen(false)} fallbackFocus={() => searchTrigger.current} onOpen={(result, query) => {
          setSearchOpen(false);
          setSearchJump(null);
          openFile(result.node, false, result.parents, (result.line || result.pageId || result.pageNumber || result.sheetId) ? () => {
            setSearchJump({ nodeId: result.node.nodeId, revisionId: result.node.revisionId, query,
              pageId: result.pageId, pageNumber: result.pageNumber,
              sheetId: result.sheetId, row: result.row, column: result.column });
          } : undefined);
        }} />
    </Suspense>}
    {recordingsOpen && <ModalFrame label={copy.meetingRecordings} onClose={() => setRecordingsOpen(false)}>
      <div className="proton-confirm-dialog proton-meeting-recorder">
        <Suspense fallback={<p role="status" className="p-4">{copy.loadingRecorder}</p>}>
          <Recordings meetingMode embedded onClose={() => setRecordingsOpen(false)}
            onOpenSummary={session => setSummarySessionId(session.id)}
            onPublish={workspace?.canWrite && reachable ? setMeetingSource : undefined} />
        </Suspense>
      </div>
      {summarySessionId && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingReview}</p>}>
        <MeetingSummary key={summarySessionId} sessionId={summarySessionId} onClose={() => setSummarySessionId(null)}
          onPublish={workspace?.canWrite && reachable ? setMeetingSource : undefined} />
      </Suspense>}
    </ModalFrame>}
    {meetingSource && workspace && <Suspense fallback={<p role="status" className="proton-account-loading">{copy.loadingMeetingDestination}</p>}>
      <MeetingPublication source={meetingSource} workspace={workspace} onClose={() => setMeetingSource(null)}
        onPublished={(node, parents) => {
          setMeetingSource(null);
          setSummarySessionId(null);
          setRecordingsOpen(false);
          setTreeRefresh(value => value + 1);
          openFile(node, false, parents);
        }} />
    </Suspense>}
  </div></UiLocaleProvider>;
}

function isSupportedFile(name: string) {
  return isProtonMarkdown(name) || isProtonImage(name) || isProtonReferenceName(name) || isProtonHandwritten(name);
}

function EmptyWorkspace({ children, tabs, toolsId, toolsHidden }: {
  children: ReactNode; tabs: ReactNode; toolsId: string; toolsHidden: boolean;
}) {
  const copy = protonShellCopy[useUiLocale()];
  return <div className="proton-workspace-empty">
    <div className="proton-workspace-empty-center">{tabs}<div className="proton-workspace-empty-body">{children}</div></div>
    <aside id={toolsId} className="proton-workspace-empty-side" aria-label={copy.toolsLabel}
      aria-hidden={toolsHidden || undefined} ref={element => { if (element) element.inert = toolsHidden; }}>
      <h2>{copy.tools}</h2>
      <p>{copy.toolsHelp}</p>
    </aside>
  </div>;
}
