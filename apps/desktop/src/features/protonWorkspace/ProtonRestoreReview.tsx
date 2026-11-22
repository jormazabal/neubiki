import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { usePortabilityCopy } from "../../lib/i18n/protonPortabilityCopy";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { actOnProtonRestore, getProtonRestore, reviewProtonRestore } from "../../lib/api/protonRestore";
import type { ProjectTransferJob } from "../../types/projectTransfer";
import type { ProtonRestore } from "../../types/protonRestore";
import type { ProtonNode, ProtonWorkspace } from "../../types/protonWorkspace";
type Props = { workspace: ProtonWorkspace; source: ProjectTransferJob; connected: boolean; beforeApply: () => Promise<void>;
  onPendingChange: (pending: boolean) => void; onRestored?: () => void; onResult?: (value: ProtonRestore) => void; destination?: ProtonNode[] };
export function ProtonRestoreReview({ workspace, source, connected, beforeApply, onPendingChange, onRestored, onResult, destination }: Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const { t } = usePortabilityCopy();
  const scope = { accountId: workspace.accountId, rootId: workspace.root.nodeId };
  const [name, setName] = useState(`${source.manifest?.projectName.slice(0, 180) || t("Proyecto")} ${t("copia")}`);
  const [review, setReview] = useState<ProtonRestore>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [needsCheck, setNeedsCheck] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const pending = useRef(false); const mounted = useRef(false); const notify = useRef(onPendingChange); notify.current = onPendingChange;
  const busy = Boolean(action);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; notify.current(false); }; }, []);
  useEffect(() => { notify.current(busy || unresolved || review?.phase === "running"); }, [busy, unresolved, review?.phase]);
  useEffect(() => {
    let active = true;
    void getProtonRestore({ accountId: workspace.accountId, rootId: workspace.root.nodeId }, source).then(value => {
      if (active) { if (value) { setReview(value); setName(value.name); } setLoading(false); }
    }, cause => { if (active) { setLoading(false); setError(runtimeErrorMessage(cause, t("No se pudo consultar la restauración conservada."))); } });
    return () => { active = false; };
  }, [workspace.accountId, workspace.root.nodeId, source.id, source.archiveSha256]);
  function start(value: string) { if (pending.current) return false; pending.current = true; setAction(value); setError(""); return true; }
  function finish() { pending.current = false; if (mounted.current) setAction(""); }
  async function prepare() {
    if (!name.trim() || !start("Revisando el destino de la copia…")) return;
    try { const value = await reviewProtonRestore(scope, source, name.trim(), destination?.[destination.length - 1]?.nodeId); if (mounted.current) { setReview(value); setName(value.name); setAcknowledge(false); setNeedsCheck(false); } }
    catch (cause) { if (mounted.current) setError(runtimeErrorMessage(cause, t("No se pudo revisar el destino. No se ha creado ninguna copia."))); }
    finally { finish(); }
  }
  async function run(kind: "apply" | "check" | "status") {
    if (!review || !start(kind === "apply" ? "Restaurando como copia nueva…" : "Consultando el resultado…")) return;
    try {
      if (kind === "apply") { setUnresolved(true); notify.current(true); await beforeApply(); }
      const value = kind === "status" ? await getProtonRestore(scope, source) : await actOnProtonRestore(scope, source, review, kind);
      if (!value) throw Error(t("No se encontró la restauración. Conserva el paquete y vuelve a consultar."));
      if (mounted.current) { setReview(value); setNeedsCheck(false); setUnresolved(value.phase === "running"); if (kind !== "status") { onRestored?.(); onResult?.(value); } }
    } catch (cause) { if (mounted.current) { setError(runtimeErrorMessage(cause, t("El resultado no está confirmado. Consulta antes de continuar."))); setNeedsCheck(true); } }
    finally { finish(); }
  }
  async function cancel() {
    if (!review) return;
    try { const value = await actOnProtonRestore(scope, source, review, "cancel"); if (mounted.current) setReview(value); }
    catch (cause) { if (mounted.current) setError(runtimeErrorMessage(cause, t("No se pudo confirmar la solicitud de detención."))); }
  }
  const editable = !review || review.phase === "reviewed";
  const expectedParent = destination?.[destination.length - 1]?.nodeId || workspace.root.nodeId;
  const destinationLabel = review?.parentId && review.parentId !== expectedParent
    ? `${workspace.root.name} / … / ${review.parentName || t("Carpeta de la revisión conservada")}`
    : destination?.map(node => node.name).join(" / ") || workspace.root.name;
  const canApply = review && ["reviewed", "interrupted"].includes(review.phase) && !needsCheck && !unresolved && !review.entries.some(entry => entry.status === "pending");
  return <section className="space-y-3 rounded-xl border border-line p-3" aria-label={t("Restaurar como copia")}>
    <h3 className="text-sm font-semibold">{t("Restaurar como copia nueva")}</h3>
    <p className="text-sm">{t("Destino:")} <strong>{destinationLabel}</strong>{t(". Se crea una carpeta nueva y se verifican los archivos copiados. Las carpetas existentes se conservan.")}</p>
    {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
    {loading ? <p role="status" className="text-sm">{t("Consultando restauración conservada…")}</p> : <>
      {editable && <label className="grid gap-1 text-sm">{t("Nombre de la carpeta nueva")}<input className="ui-field" maxLength={200} value={name} disabled={busy || unresolved} onChange={event => { setName(event.target.value); setReview(undefined); setAcknowledge(false); }} /></label>}
      {review && <ProtonRestoreResults value={review} />}
      {busy && <div role="status" className="space-y-2 text-sm"><p>{t(action)}</p><ProgressBar label={t("Restaurando copia")} /></div>}
      {(unresolved || needsCheck || review?.phase === "running") && <InlineNotice tone="warning">{t("La operación requiere consultar su estado antes de continuar o cerrar.")}</InlineNotice>}
      {review?.phase === "uncertain" && <InlineNotice tone="warning">{t("Hay una creación sin confirmar. Comprueba el resultado. Una carpeta cuya creación no pueda atribuirse con seguridad permanece pendiente y no se vuelve a crear.")}</InlineNotice>}
      {canApply && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledge} disabled={busy} onChange={event => setAcknowledge(event.target.checked)} />{t("He revisado el paquete y el destino. Quiero crear esta copia en Proton.")}</label>}
      <div className="flex flex-wrap justify-end gap-2">
        {editable && !review && <Button disabled={busy || !connected || !workspace.canWrite || !name.trim()} onClick={() => void prepare()}>{t("Revisar destino")}</Button>}
        {review && <Button disabled={busy} onClick={() => void run("status")}>{t("Consultar estado")}</Button>}
        {review && !["reviewed", "running"].includes(review.phase) && <Button disabled={busy || !connected} onClick={() => void run("check")}>{t("Comprobar archivos")}</Button>}
        {canApply && <Button variant="primary" disabled={busy || !connected || !workspace.canWrite || !acknowledge} onClick={() => void run("apply")}>{t(review.phase === "interrupted" ? "Continuar copia" : "Crear copia en Proton")}</Button>}
        {(action.startsWith("Restaurando") || review?.phase === "running") && <Button variant="quiet" disabled={Boolean(review?.cancelRequested)} onClick={() => void cancel()}>{t(review?.cancelRequested ? "Detención solicitada" : "Solicitar detención")}</Button>}
      </div>
    </>}
  </section>;
}
export function ProtonRestoreResults({ value, archived = false }: { value: ProtonRestore; archived?: boolean }) {
  const { t } = usePortabilityCopy();
  const confirmed = value.entries.filter(entry => ["confirmed", "observed"].includes(entry.status)).length;
  const phase = value.phase === "running" && archived ? value.entries.every(entry => ["confirmed", "observed"].includes(entry.status)) ? "complete" : value.entries.some(entry => entry.status === "pending") ? "uncertain" : "interrupted" : value.phase;
  const label = { reviewed: "Destino revisado", running: "Copia en curso", interrupted: "Copia interrumpida", uncertain: "Resultado sin confirmar", cancelled: "Copia detenida", complete: "Copia verificada en Proton" }[phase];
  return <div className="space-y-2 text-sm"><p><strong>{value.name} · {t(label)}</strong></p><p>{t("{count} de {total} elementos confirmados", { count: confirmed, total: value.entries.length })}</p>
    <details open={value.phase !== "reviewed"}><summary>{t("Resultado por archivo y carpeta")}</summary><ul className="mt-2 max-h-[30dvh] space-y-2 overflow-auto">{value.entries.map(entry => <li key={`${entry.kind}:${entry.path}`} className="rounded-lg border border-line p-2"><span className="break-words">{entry.path || value.name}</span> · <strong>{t(entry.status === "confirmed" ? "Verificado" : entry.status === "observed" ? "Comprobado" : entry.status === "pending" ? "Sin confirmar" : "Pendiente")}</strong>{entry.detail && <p className="mt-1 text-muted">{entry.detail}</p>}</li>)}</ul></details>
  </div>;
}
