import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { usePortabilityCopy } from "../../lib/i18n/protonPortabilityCopy";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, Package, RefreshCw, Upload } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { projectTransfers } from "../../lib/api/projectTransfer";
import { checkProtonPackage, deliverProtonPackage, discardProtonPackage, getProtonPackages, prepareProtonPackage } from "../../lib/api/protonPackage";
import type { ProjectPackageManifest, ProjectTransferJob } from "../../types/projectTransfer";
import type { ProtonPackage } from "../../types/protonPackage";
import { getProtonRestoreHistory } from "../../lib/api/protonRestore";
import { ProtonRestoreReview, ProtonRestoreResults } from "./ProtonRestoreReview";
import type { ProtonRestore } from "../../types/protonRestore";
import type { ProtonWorkspace } from "../../types/protonWorkspace";
type Props = { workspace: ProtonWorkspace; connected: boolean; beforePrepare: () => Promise<void>; onPendingChange?: (pending: boolean) => void;
  onClose: () => void; fallbackFocus?: () => HTMLElement | null; initialMode?: "export" | "review"; onRestored?: () => void; backupControl?: ReactNode };
const size = (bytes: number, locale = "es") => `${(bytes / 1024 ** 2).toLocaleString(locale, { maximumFractionDigits: 1 })} MiB`;
export function ProtonPackageDialog(props: Props) { return <PackageContent key={JSON.stringify([props.workspace.accountId, props.workspace.root.nodeId])} {...props} />; }
function PackageContent({ workspace, connected, beforePrepare, onPendingChange, onClose, fallbackFocus, initialMode = "export", onRestored, backupControl }: Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const { locale, t } = usePortabilityCopy();
  const scope = { accountId: workspace.accountId, rootId: workspace.root.nodeId };
  const [mode, setMode] = useState(initialMode);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [history, setHistory] = useState<ProtonRestore[]>([]);
  const restorePending = useRef(false);
  const [copies, setCopies] = useState<ProtonPackage[]>([]);
  const [copy, setCopy] = useState<ProtonPackage>();
  const [importJob, setImportJob] = useState<ProjectTransferJob>();
  const [otherPreparation, setOtherPreparation] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [requiresCheck, setRequiresCheck] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false); const mounted = useRef(false); const notify = useRef(onPendingChange); notify.current = onPendingChange;
  const busy = Boolean(progress) || restoreBusy;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (pending.current || restorePending.current) notify.current?.(false); }; }, []);
  useEffect(() => {
    let active = true;
    void getProtonPackages({ accountId: workspace.accountId, rootId: workspace.root.nodeId }).then(value => {
      if (active) { setCopies(value); setRequiresCheck(false); }
    }, cause => { if (active) setError(runtimeErrorMessage(cause, t("No se pudieron consultar las copias preparadas."))); });
    void getProtonRestoreHistory({ accountId: workspace.accountId, rootId: workspace.root.nodeId }).then(value => { if (active) setHistory(value); }, () => {});
    void projectTransfers.list().then(value => {
      if (!active) return;
      const job = value.jobs.find(item => item.kind === "import" && !item.templateCatalogue && !item.templateId);
      setImportJob(job); setOtherPreparation(Boolean(value.warnings.length || value.jobs.length && !job));
    }, cause => { if (active) setError(runtimeErrorMessage(cause, t("No se pudo consultar la revisión de paquetes."))); });
    return () => { active = false; };
  }, [workspace.accountId, workspace.root.nodeId, refresh]);
  function start(text: string) { if (pending.current || restorePending.current) return false; pending.current = true; notify.current?.(true); setProgress(text); setError(""); return true; }
  function finish() { pending.current = false; notify.current?.(restorePending.current); if (mounted.current) setProgress(""); }
  function show(value: ProtonPackage) { setCopy(value); setAcknowledge(false); setRemove(false); setRequiresCheck(false); }
  function record(value: ProtonPackage) { show(value); setCopies(items => value.phase === "discarded" ? items.filter(item => item.id !== value.id) : [value, ...items.filter(item => item.id !== value.id)]); }
  async function prepare() {
    if (!start("Protegiendo cambios y preparando la copia…")) return;
    try { await beforePrepare(); const value = await prepareProtonPackage(scope); if (mounted.current) record(value); }
    catch (cause) { if (mounted.current) { setError(runtimeErrorMessage(cause, t("La preparación requiere comprobar su resultado."))); setRequiresCheck(true); } }
    finally { finish(); }
  }
  async function copyAction(action: "deliver" | "check" | "discard") {
    if (!copy || !start(action === "deliver" ? "Elige dónde guardar la copia…" : "Comprobando la copia…")) return;
    try { const value = action === "deliver" ? await deliverProtonPackage(scope, copy) : action === "discard" ? await discardProtonPackage(scope, copy) : await checkProtonPackage(scope, copy.id); if (mounted.current) record(value); }
    catch (cause) { if (mounted.current) { setError(runtimeErrorMessage(cause, t("Comprueba el destino antes de repetir."))); setRequiresCheck(true); } }
    finally { finish(); }
  }
  async function inspectPackage() {
    if (otherPreparation || !start("Elige un paquete Neubiki…")) return;
    try {
      let job = importJob ?? await projectTransfers.begin({ kind: "import" });
      if (mounted.current) setImportJob(job);
      if (job.phase === "awaiting_source") { job = await projectTransfers.pick(job.id); if (mounted.current) setImportJob(job); }
      if (job.phase === "preparing" && !job.interrupted) { setProgress("Verificando nombres, contenido e integridad del paquete…"); job = await projectTransfers.prepare(job.id); }
      if (mounted.current) setImportJob(job);
    } catch (cause) { if (mounted.current) { setError(runtimeErrorMessage(cause, t("No se pudo revisar el paquete. El original se conserva."))); setRefresh(value => value + 1); } }
    finally { finish(); }
  }
  async function discardImport() {
    if (!importJob || !start("Retirando la preparación privada…")) return;
    try { await projectTransfers.discard(importJob.id); if (mounted.current) { setImportJob(undefined); setRemove(false); } }
    catch (cause) { if (mounted.current) setError(runtimeErrorMessage(cause, t("La preparación se conserva sin cambios."))); }
    finally { finish(); }
  }
  function close() { if (!pending.current && !restorePending.current) onClose(); }
  const omissions = copy?.sourceMetadata.manifest.exclusions.length ?? 0;
  const canSave = copy && ["prepared", "cancelled"].includes(copy.phase) && !requiresCheck && (!omissions || acknowledge);
  return createPortal(<ModalFrame label={t("Copias portables")} onClose={close} fallbackFocus={fallbackFocus} className="proton-rail-dialog">
    <section className="proton-confirm-dialog space-y-4 p-5" style={{ width: "min(100%, 48rem)" }}>
      <DialogHeading title={t("Copias portables")} closeLabel={t("Cerrar")} busy={busy} onClose={close} />
      <div className="flex flex-wrap gap-2" aria-label={t("Acción de copia portable")}>
        <Button disabled={busy} variant={mode === "export" ? "primary" : "secondary"} aria-pressed={mode === "export"} onClick={() => { setMode("export"); setRemove(false); }}><Package size={16} />{t("Preparar copia")}</Button>
        <Button disabled={busy} variant={mode === "review" ? "primary" : "secondary"} aria-pressed={mode === "review"} onClick={() => { setMode("review"); setRemove(false); }}><Upload size={16} />{t("Revisar un paquete")}</Button>
      </div>
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {busy && <div role="status" className="space-y-2 text-sm"><p>{t(progress)}</p><ProgressBar label={t("Preparando copia portable")} /></div>}
      {mode === "export" ? <>
        <p className="text-sm">{t("Copia de los archivos guardados de")} <strong>{workspace.root.name}</strong>{t(", con su estructura y carpetas vacías. Se incluyen Markdown, notas manuscritas, imágenes y adjuntos compatibles.")}</p>
        <p className="text-sm text-muted">{t("Hasta 32 archivos, 32 carpetas, 12 niveles, 8 MiB por archivo y 128 MiB en total. Quedan fuera borradores privados, conversaciones, grabaciones, preferencias, claves y carpetas de la aplicación.")}</p>
        {backupControl}
        {!connected && <InlineNotice tone="warning">{t("Necesitas conexión para preparar una copia nueva. Los paquetes preparados se pueden consultar y guardar.")}</InlineNotice>}
        {copy ? <>
          <PackageManifest manifest={copy.sourceMetadata.manifest} archiveBytes={copy.archiveBytes} />
          <p className="text-sm"><strong>{t(copy.phase === "saved" ? "Copia guardada" : copy.phase === "cancelled" ? "Destino cancelado · copia preparada" : copy.phase === "discarded" ? "Preparación retirada" : copy.phase === "uncertain" || copy.phase === "picking" ? "Entrega sin confirmar" : "Copia preparada")}</strong></p>
          {(requiresCheck || ["picking", "uncertain"].includes(copy.phase)) && <InlineNotice tone="warning">{t("Revisa el destino y comprueba el resultado. Una entrega sin confirmar no se vuelve a ejecutar.")}</InlineNotice>}
          {!!omissions && ["prepared", "cancelled"].includes(copy.phase) && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledge} disabled={busy} onChange={event => setAcknowledge(event.target.checked)} />{t("He revisado las exclusiones y quiero guardar una copia parcial.")}</label>}
          <details className="text-xs text-muted"><summary>{t("Integridad del paquete")}</summary><p className="mt-2 break-all">SHA-256: {copy.archiveSha256}</p><p>{t("El manifiesto verifica nombres, tamaños y huellas de los archivos. La identidad de tu cuenta y los datos privados del dispositivo quedan fuera del ZIP.")}</p></details>
          {remove && <InlineNotice tone="warning">{t("Solo se elimina la preparación privada. Proton y el ZIP del destino se conservan.")}<Button disabled={busy} variant="danger" size="compact" onClick={() => void copyAction("discard")}>{t("Confirmar retirada")}</Button></InlineNotice>}
          <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={() => { setCopy(undefined); setRemove(false); }}>{t("Otra copia")}</Button>
            {copy.phase !== "discarded" && <Button disabled={busy || copy.phase === "picking"} variant="quiet" onClick={() => setRemove(value => !value)}>{t("Retirar preparación")}</Button>}
            <Button disabled={busy} onClick={() => void copyAction("check")}>{t("Comprobar resultado")}</Button>
            {canSave && <Button variant="primary" disabled={busy} onClick={() => void copyAction("deliver")}><Download size={16} />{t("Guardar paquete…")}</Button>}</div>
        </> : <>
          {!!copies.length && <details><summary className="text-sm">{t("Copias preparadas en este dispositivo ({count})", { count: copies.length })}</summary><ul className="mt-2 max-h-[26dvh] space-y-2 overflow-auto">{copies.map(item => <li key={item.id}><Button variant="quiet" size="compact" disabled={busy} onClick={() => show(item)}>{new Date(item.checkedAt).toLocaleString(locale)} · {item.documents.length} {t(item.documents.length === 1 ? "archivo" : "archivos")} · {t(item.phase === "saved" ? "Guardado" : item.phase === "uncertain" || item.phase === "picking" ? "Sin confirmar" : "Preparado")}</Button></li>)}</ul></details>}
          <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} />{t("Actualizar copias")}</Button><Button variant="primary" disabled={busy || !connected || requiresCheck} onClick={() => void prepare()}>{t("Preparar y revisar")}</Button></div>
        </>}
      </> : <>
        <p className="text-sm">{t("Elige un paquete .neubiki-project.zip para verificar sus archivos y estructura antes de restaurarlo como una copia nueva.")}</p>
        <InlineNotice tone="neutral">{t("El paquete se verifica en una preparación privada. Restaurarlo requiere revisar y confirmar una carpeta nueva; no se incorporan ajustes ni datos privados del paquete.")}</InlineNotice>
        {otherPreparation && <InlineNotice tone="warning">{t("Hay otra transferencia conservada que requiere atención. No se cambia ni se sustituye desde esta revisión.")}</InlineNotice>}
        {importJob?.manifest && <PackageManifest manifest={importJob.manifest} archiveBytes={importJob.archiveBytes} />}
        {importJob?.manifest?.supplement && <InlineNotice tone="warning">{t("El paquete contiene un archivo privado. Sus ajustes, conversaciones y grabaciones no se incorporan.")}</InlineNotice>}
        {importJob?.phase === "ready" && importJob.manifest && !importJob.manifest.supplement && importJob.manifest.schemaVersion === 1 && <ProtonRestoreReview key={importJob.id}
          workspace={workspace} source={importJob} connected={connected} beforeApply={beforePrepare} onRestored={onRestored}
          onPendingChange={value => { restorePending.current = value; setRestoreBusy(value); notify.current?.(value || pending.current); }} />}
        {importJob?.error && <InlineNotice tone="error">{importJob.error}</InlineNotice>}
        {importJob?.interrupted && <InlineNotice tone="warning">{t("La preparación se interrumpió. Se conserva para revisión; no se repite automáticamente.")}</InlineNotice>}
        {remove && importJob && <InlineNotice tone="warning">{t("Se elimina solo la copia privada preparada. El ZIP original y los elementos ya creados en Proton se conservan; los resultados de restauración quedan registrados en este dispositivo.")}<Button variant="danger" size="compact" disabled={busy} onClick={() => void discardImport()}>{t("Confirmar retirada")}</Button></InlineNotice>}
        {!!history.length && <details><summary className="text-sm">{t("Resultados de restauración conservados ({count})", { count: history.length })}</summary><div className="mt-2 max-h-[40dvh] space-y-3 overflow-auto">{history.map(item => <ProtonRestoreResults key={`${item.transferId}:${item.revision}:${item.checkedAt}`} value={item} archived />)}</div></details>}
        <div className="flex flex-wrap justify-end gap-2">
          {importJob && !["committing", "pending_registration"].includes(importJob.phase) && <Button disabled={busy} variant="quiet" onClick={() => setRemove(value => !value)}>{t("Retirar revisión")}</Button>}
          {!importJob || ["awaiting_source", "preparing"].includes(importJob.phase) && !importJob.interrupted ? <Button variant="primary" disabled={busy || otherPreparation} onClick={() => void inspectPackage()}>{t("Elegir y revisar paquete…")}</Button> : null}
        </div>
      </>}
      <div className="flex justify-end"><Button data-autofocus disabled={busy} onClick={close}>{t("Cerrar")}</Button></div>
    </section>
  </ModalFrame>, document.body);
}
function PackageManifest({ manifest, archiveBytes }: { manifest: ProjectPackageManifest; archiveBytes: number }) {
  const { locale, t } = usePortabilityCopy();
  const [filePage, setFilePage] = useState(0);
  const pages = Math.max(1, Math.ceil(manifest.files.length / 100));
  const page = Math.min(filePage, pages - 1);
  return <div className="space-y-2 rounded-xl border border-line p-3 text-sm"><h3 className="font-semibold">{manifest.projectName}</h3>
    <p>{t("{count} {files} · {folders} {folderLabel} · {size}", { count: manifest.files.length, files: t(manifest.files.length === 1 ? "archivo" : "archivos"), folders: manifest.directories.length, folderLabel: t(manifest.directories.length === 1 ? "carpeta" : "carpetas"), size: size(archiveBytes, locale) })}</p>
    <details><summary>{t("Archivos incluidos")}</summary><ul className="mt-2 max-h-[26dvh] space-y-1 overflow-auto">{manifest.files.slice(page * 100, (page + 1) * 100).map(file => <li key={file.path} className="flex justify-between gap-3"><span className="min-w-0 break-words">{file.path}</span><span className="shrink-0 text-muted">{size(file.size, locale)}</span></li>)}</ul>{pages > 1 && <nav className="mt-2 flex items-center justify-between gap-2" aria-label={t("Páginas de archivos del paquete")}><Button size="compact" disabled={page === 0} onClick={() => setFilePage(page - 1)}>{t("Anterior")}</Button><span>{t("{page} de {pages}", { page: page + 1, pages })}</span><Button size="compact" disabled={page + 1 >= pages} onClick={() => setFilePage(page + 1)}>{t("Siguiente")}</Button></nav>}</details>
    {!!manifest.directories.length && <details><summary>{t("Carpetas incluidas")}</summary><ul className="mt-2 max-h-[20dvh] overflow-auto">{manifest.directories.map(path => <li key={path} className="break-words">{path}</li>)}</ul></details>}
    {!!manifest.exclusions.length && <details open><summary>{t("{count} entradas excluidas · revisar", { count: manifest.exclusions.length })}</summary><ul className="mt-2 max-h-[26dvh] space-y-2 overflow-auto">{manifest.exclusions.map((item, index) => <li key={index}><strong className="break-words">{item.path}</strong><p className="text-muted">{item.reason}</p></li>)}</ul></details>}
    {!!manifest.referenceWarnings.length && <InlineNotice tone="warning">{t("{count} referencias necesitan revisión. Se conservan sus destinos originales.", { count: manifest.referenceWarnings.length })}</InlineNotice>}
  </div>;
}
