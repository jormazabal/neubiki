import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Cloud, Folder, LogOut, Minus, RefreshCw, Square, X } from "lucide-react";
import { APP_VERSION } from "../../lib/appVersion";
import * as accounts from "../../lib/api/protonDirect";
import * as api from "../../lib/api/protonWorkspace";
import { isMobileDeviceRuntime, isTauriRuntime } from "../../lib/runtime/platform";
import { closeWindow, minimizeWindow, startWindowDrag, toggleMaximizeWindow } from "../../lib/runtime/windowControls";
import { useWorkspaceExit } from "../../app/useWorkspaceExit";
import type { ProtonAccountStatus } from "../../types/protonDirect";
import type { ProtonDocumentKey, ProtonNode, ProtonWorkspace as Workspace } from "../../types/protonWorkspace";
import { DrivePicker } from "./DrivePicker";
import { ProtonTree } from "./ProtonTree";
import { useProtonDocument } from "./useProtonDocument";
import "./ProtonWorkspace.css";

const DocumentPane = lazy(() => import("./ProtonDocumentPane").then(module => ({ default: module.ProtonDocumentPane })));
const control = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-line px-3 text-sm hover:bg-brand-hover disabled:opacity-50";
const primary = "inline-flex min-h-10 items-center justify-center rounded-md bg-brand-orange px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50";

export function ProtonWorkspace({ uploadImage }: {
  uploadImage?: (address: ProtonDocumentKey, file: File) => Promise<string>;
} = {}) {
  const [status, setStatus] = useState<ProtonAccountStatus | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [picker, setPicker] = useState<ProtonNode[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const isBusy = useCallback(() => busyRef.current, []);
  const editorCheckpoint = useRef<((key: number) => void) | null>(null);
  const flushEditor = useCallback((key: number) => editorCheckpoint.current?.(key), []);
  const [exitFrozen, setExitFrozen] = useState(false);
  const [error, setError] = useState("");
  const [reachable, setReachable] = useState(false);
  const [treeRefresh, setTreeRefresh] = useState(0);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [showTree, setShowTree] = useState(true);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [unsupportedFile, setUnsupportedFile] = useState<ProtonNode | null>(null);
  const [loading, setLoading] = useState(true);
  const documentState = useProtonDocument(() => setError("No se ha podido guardar el borrador en este dispositivo. No cierres el documento; vuelve a guardar el borrador."), flushEditor);
  const { opened, edited, clear, open, protect } = documentState;
  const disabled = busy || exitFrozen;
  const native = isTauriRuntime();

  async function run(action: () => Promise<void>, errorMessage: string) {
    if (busyRef.current || exitFrozen) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try { await action(); }
    catch { setError(errorMessage); }
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
      else setError("No se pudo consultar la cuenta de Proton.");
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
          if (active) setError("No se pudo comprobar la autorización de Proton. Puedes consultarla de nuevo.");
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
  const hasWorkspaceAccount = connectedAccounts.some(account => account.id === bindingAccount);
  const showWorkspace = !picker && Boolean(workspace && hasWorkspaceAccount);
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
            setRemoteChanged(true);
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
  }, [bindingAccount, rootId, hasWorkspaceAccount, updateReachability]);

  useWorkspaceExit({
    freeze: () => setExitFrozen(true),
    unfreeze: () => setExitFrozen(false),
    hasPendingSettings: () => busyRef.current,
    protect: async () => { await protect(); return true; },
    failed: () => setError("No se ha cerrado Neubiki porque queda trabajo en curso o un borrador sin proteger."),
  });

  function chooseRoot() {
    if (!selectedAccount) return;
    void run(async () => {
      await protect();
      const { root } = await api.readDriveRoot(selectedAccount.id);
      setAccountId(selectedAccount.id);
      setPicker([root]);
    }, "No se pudo abrir la raíz de Proton Drive. Comprueba la conexión y el borrador abierto.");
  }

  function selectRoot(node: ProtonNode) {
    if (!selectedAccount) return;
    void run(async () => {
      const selected = await api.selectDriveFolder(selectedAccount.id, node.nodeId);
      clear();
      setUnsupportedFile(null);
      setReachable(false);
      setRemoteChanged(false);
      setWorkspace(selected);
      setPicker(null);
      setShowTree(true);
      setTreeRefresh(value => value + 1);
    }, "No se pudo seleccionar esta carpeta de Proton Drive.");
  }

  function openFile(node: ProtonNode) {
    if (!rootId || !bindingAccount || !reachable) return;
    void run(async () => {
      await protect();
      if (!/\.(md|markdown|mdown|png|jpe?g|webp|gif)$/i.test(node.name)) {
        clear();
        setUnsupportedFile(node);
        setShowTree(false);
        return;
      }
      const address = { accountId: bindingAccount, rootId, nodeId: node.nodeId };
      const snapshot = await api.readDocument(address);
      open(address, snapshot);
      setUnsupportedFile(null);
      setRemoteChanged(false);
      setShowTree(false);
    }, "No se pudo abrir el archivo. Comprueba la conexión y el borrador abierto.");
  }

  function disconnect() {
    const target = bindingAccount ?? selectedAccount?.id;
    if (!target) return;
    void run(async () => {
      await protect();
      updateStatus(await accounts.disconnectProtonAccount(target));
      clear();
      setUnsupportedFile(null);
      setWorkspace(null);
      setReachable(false);
      setConfirmDisconnect(false);
    }, "No se pudo cerrar la sesión. Comprueba el borrador y vuelve a intentarlo.");
  }

  return <div className="proton-workspace flex h-dvh min-h-0 flex-col bg-white text-ink-primary">
    <header className="proton-workspace-chrome flex min-h-11 shrink-0 items-center gap-2 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2" onPointerDown={event => { if (native && !isMobileDeviceRuntime() && event.button === 0) void startWindowDrag(); }}>
        <img src="/brand/neubiki-logo.png" alt="" className="size-6 shrink-0 rounded" />
        <span className="text-sm font-semibold">Neubiki</span>
        <span className="proton-workspace-version text-xs">{APP_VERSION}</span>
      </div>
      {native && !isMobileDeviceRuntime() && <div className="flex">
        <button aria-label="Minimizar ventana" className="rounded p-2 hover:bg-white/10" onClick={() => void minimizeWindow()}><Minus size={16} /></button>
        <button aria-label="Maximizar o restaurar ventana" className="rounded p-2 hover:bg-white/10" onClick={() => void toggleMaximizeWindow()}><Square size={14} /></button>
        <button aria-label="Cerrar Neubiki" className="rounded p-2 hover:bg-white/10" onClick={() => void closeWindow()}><X size={17} /></button>
      </div>}
    </header>
    {error && <div role="alert" className="flex items-start gap-2 border-b border-line bg-brand-hover px-4 py-2 text-sm">
      <p className="flex-1">{error}</p>
      <button type="button" aria-label="Cerrar aviso" onClick={() => setError("")}><X size={17} /></button>
    </div>}
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {loading ? <p role="status" className="p-6">Preparando Proton Drive…</p>
        : picker && selectedAccount ? <div className="overflow-y-auto"><DrivePicker key={picker[picker.length - 1].nodeId} accountId={selectedAccount.id} path={picker} busy={disabled}
          onBack={() => setPicker(picker.length > 1 ? picker.slice(0, -1) : null)}
          onOpen={node => setPicker([...picker, node])} onSelect={selectRoot} /></div>
        : showWorkspace && workspace ? <div className="flex min-h-0 flex-1">
          <aside className={`w-full shrink-0 flex-col overflow-y-auto border-r border-line bg-panel p-3 md:flex md:w-56 xl:w-64 ${showTree ? "flex" : "hidden"}`}>
            <div className="min-w-0 border-b border-line pb-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs text-ink-secondary"><Cloud size={15} /> Proton Drive</p>
              <h1 className="break-words text-sm font-semibold">{workspace.root.name}</h1>
              <p role="status" className="proton-workspace-connection mt-1 text-xs text-ink-secondary" data-connected={reachable}>{reachable ? "Conexión disponible" : "Conexión sin confirmar"}</p>
              <p className="mt-1 break-words text-xs text-ink-secondary">{connectedAccounts.find(account => account.id === bindingAccount)?.label}</p>
              <div className="proton-workspace-rail-actions mt-3">
                <button type="button" className={control} onClick={chooseRoot} disabled={disabled}><Folder size={15} /> Cambiar carpeta</button>
                <button type="button" className={control} aria-label="Comprobar conexión y actualizar árbol" title="Actualizar árbol" onClick={() => setTreeRefresh(value => value + 1)} disabled={disabled}><RefreshCw size={15} /></button>
                <button type="button" className={control} aria-label="Desconectar cuenta Proton" title="Desconectar cuenta" onClick={() => setConfirmDisconnect(true)} disabled={disabled}><LogOut size={15} /></button>
              </div>
              {confirmDisconnect && <div className="mt-3 space-y-2 rounded-md border border-line bg-white p-2 text-xs">
                <p>Los borradores de esta cuenta se conservan en este dispositivo.</p>
                <div className="flex flex-wrap gap-2"><button type="button" className={control} onClick={() => setConfirmDisconnect(false)}>Cancelar</button>
                <button type="button" className={control} onClick={disconnect} disabled={disabled}>Desconectar</button></div>
              </div>}
            </div>
            <nav aria-label="Árbol de Proton Drive" className="pt-3">
              <ProtonTree key={workspace.root.nodeId} node={workspace.root} accountId={workspace.accountId} rootId={workspace.root.nodeId} refresh={treeRefresh}
                selected={opened?.address.nodeId ?? unsupportedFile?.nodeId} disabled={disabled || !reachable} onOpen={openFile} onReachability={updateReachability} />
            </nav>
          </aside>
          <div className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${showTree ? "hidden" : "flex"}`}>
            <button type="button" className="flex min-h-11 items-center gap-2 border-b border-line px-3 text-sm font-medium text-brand-dark md:hidden" onClick={() => setShowTree(true)}><ArrowLeft size={16} /> Archivos</button>
            {opened ? <Suspense fallback={<p role="status" className="p-6">Cargando editor…</p>}>
              <DocumentPane document={opened} getCurrent={documentState.getCurrent} isBusy={isBusy} uploadImage={uploadImage}
                editorCheckpoint={editorCheckpoint} edited={edited} connected={reachable} busy={disabled} canWrite={workspace.canWrite} remoteChanged={remoteChanged}
                onEdit={documentState.edit} onReload={() => openFile(opened.document.node)}
                onProtect={() => { void run(protect, "No se ha podido guardar el borrador en este dispositivo."); }}
                onSave={() => { if (reachable && workspace.canWrite) void run(documentState.save, "No se confirmó el guardado. Revisa el estado del borrador antes de continuar."); }}
                onReconcile={() => { void run(documentState.reconcile, "No se pudo comprobar la revisión en Proton."); }}
                onDiscard={() => { void run(documentState.discard, "No se pudo completar el descarte o volver a leer el archivo. Abre el documento de nuevo."); }} />
            </Suspense> : unsupportedFile ? <section className="p-6"><h2 className="break-words text-lg font-semibold">{unsupportedFile.name}</h2><p className="mt-2 text-sm text-ink-secondary">Esta versión solo abre archivos Markdown e imágenes compatibles.</p></section>
              : <div className="grid flex-1 place-items-center p-6 text-center"><div><Folder className="mx-auto mb-4 text-brand-dark" size={30} /><p>Selecciona un archivo de Proton Drive.</p><p className="mt-2 text-sm text-ink-secondary">Puedes abrir documentos Markdown e imágenes.</p></div></div>}
          </div>
        </div>
        : <section className="mx-auto my-auto w-full max-w-lg overflow-y-auto px-5 py-8" aria-labelledby="proton-welcome">
          <Cloud size={34} className="mb-4 text-brand-dark" />
          <h1 id="proton-welcome" className="text-2xl font-semibold">Tu espacio en Proton Drive</h1>
          <p className="mt-2 text-sm text-ink-secondary">Conecta tu cuenta y elige una carpeta para trabajar con sus archivos.</p>
          {!native && <p className="mt-4 text-sm" role="status">La conexión con Proton está disponible en la aplicación instalada.</p>}
          {native && !status?.available && <p className="mt-4 text-sm" role="status">El conector Proton no está disponible en esta instalación.</p>}
          {native && status?.available && <div className="mt-5 flex flex-col items-start gap-3">
            {selectedAccount && <label className="flex w-full flex-col gap-1 text-sm">Cuenta de Proton
              <select className="min-h-10 rounded-md border border-line bg-white px-2" value={selectedAccount.id} onChange={event => setAccountId(event.target.value)} disabled={disabled}>
                {connectedAccounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
              </select>
            </label>}
            {connectionId ? <>
              <p role="status" className="text-sm text-ink-secondary">Esperando autorización en Proton.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={control} disabled={disabled} onClick={() => { void run(async () => updateStatus(await accounts.pollProtonConnection(connectionId)), "No se pudo comprobar la autorización de Proton."); }}>Consultar conexión</button>
                <button type="button" className={control} disabled={disabled} onClick={() => { void run(async () => updateStatus(await accounts.cancelProtonConnection(connectionId)), "No se pudo cancelar la conexión."); }}>Cancelar conexión</button>
              </div>
            </> : <div className="flex flex-wrap gap-2">
              {selectedAccount && <button type="button" className={primary} onClick={chooseRoot} disabled={disabled}>Elegir carpeta</button>}
              <button type="button" className={selectedAccount ? control : primary} disabled={disabled}
                onClick={() => { void run(async () => updateStatus(await accounts.startProtonConnection()), "No se pudo iniciar la conexión de Proton."); }}>
                {selectedAccount ? "Conectar otra cuenta" : "Conectar con Proton"}
              </button>
            </div>}
          </div>}
        </section>}
    </main>
  </div>;
}
