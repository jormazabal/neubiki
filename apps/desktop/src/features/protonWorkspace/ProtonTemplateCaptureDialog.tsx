import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image, Paperclip } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { usePortabilityCopy } from "../../lib/i18n/protonPortabilityCopy";
import { checkProtonTemplateCapture, newProtonTemplateCaptureOperationId, prepareProtonTemplateCapture, saveProtonTemplateCapture } from "../../lib/api/protonTemplateCapture";
import type { ProtonTemplateCapturePreview, ProtonTemplateCaptureReceipt, ProtonTemplateCaptureRequest } from "../../types/protonTemplateCapture";
import type { DocumentTemplateSummary } from "../../types/documentTemplates";
import type { ProtonDocumentKey, ProtonWorkspace } from "../../types/protonWorkspace";
const Preview = lazy(() => import("../editor/ReadonlyMarkdownViewer").then(module => ({ default: module.ReadonlyMarkdownViewer })));
type Props = {
  workspace: ProtonWorkspace; documentKey: ProtonDocumentKey; revisionId: string; documentName: string; connected: boolean;
  onPendingChange?: (pending: boolean) => void; onClose: () => void; onSaved?: (template: DocumentTemplateSummary) => void; fallbackFocus?: () => HTMLElement | null;
};
function defaultName(documentName: string) {
  const plain = documentName.replace(/\.(md|markdown|mdown)$/i, ""); let result = "";
  for (const character of plain) { if (new TextEncoder().encode(result + character).byteLength > 200) break; result += character; }
  return result;
}
export function ProtonTemplateCaptureDialog(props: Props) {
  return <CaptureContent key={JSON.stringify([props.documentKey.accountId, props.documentKey.rootId, props.documentKey.nodeId, props.revisionId])} {...props} />;
}
function CaptureContent({ workspace, documentKey, revisionId, documentName, connected, onPendingChange, onClose, onSaved, fallbackFocus }: Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const { locale, t } = usePortabilityCopy();
  const [name, setName] = useState(() => defaultName(documentName));
  const [description, setDescription] = useState("");
  const [prepared, setPrepared] = useState<ProtonTemplateCapturePreview>();
  const [outcome, setOutcome] = useState<ProtonTemplateCaptureReceipt>();
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState<"" | "review" | "save" | "check">("");
  const [error, setError] = useState("");
  const [needsCheck, setNeedsCheck] = useState(false);
  const pending = useRef(false); const unresolved = useRef(false); const attempt = useRef<ProtonTemplateCaptureRequest>();
  const mounted = useRef(false); const notified = useRef(false); const notify = useRef(onPendingChange); notify.current = onPendingChange;
  const scope = { ...documentKey, revisionId };
  const validScope = documentKey.accountId === workspace.accountId && documentKey.rootId === workspace.root.nodeId;
  const saved = outcome?.state === "saved" || outcome?.state === "retired";
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (pending.current || unresolved.current) notify.current?.(false); }; }, []);
  function start(action: typeof busy) { if (pending.current) return false; pending.current = true; notify.current?.(true); setBusy(action); setError(""); return true; }
  function finish() { pending.current = false; notify.current?.(unresolved.current); if (mounted.current) setBusy(""); }
  function close() { if (!pending.current && !unresolved.current) onClose(); }
  function metadataChanged() { setAcknowledge(false); setOutcome(undefined); attempt.current = undefined; }
  async function review() {
    if (!validScope || needsCheck || !start("review")) return;
    setPrepared(undefined); setOutcome(undefined); setAcknowledge(false); attempt.current = undefined;
    try { const value = await prepareProtonTemplateCapture(scope); if (mounted.current) setPrepared(value); }
    catch (cause) { if (mounted.current) setError(runtimeErrorMessage(cause, t("No se pudo revisar el documento guardado y sus recursos."))); }
    finally { finish(); }
  }
  function show(value: ProtonTemplateCaptureReceipt) {
    setOutcome(value); setNeedsCheck(false); unresolved.current = false;
    if (value.state === "not-recorded") setAcknowledge(false);
    if (value.state === "saved" && value.template && !notified.current) { notified.current = true; onSaved?.(value.template); }
  }
  async function save() {
    if (!prepared || !acknowledge || needsCheck || saved || !validScope || !connected) return;
    if (!name.trim() || new TextEncoder().encode(name.trim()).byteLength > 240 || new TextEncoder().encode(description.trim()).byteLength > 2000) {
      setError(t("Revisa el nombre y acorta la descripción antes de guardar la plantilla.")); return;
    }
    if (!start("save")) return;
    let sending = false;
    try {
      const request: ProtonTemplateCaptureRequest = attempt.current ?? { ...scope, digest: prepared.digest, name: name.trim(), description: description.trim(),
        operationId: newProtonTemplateCaptureOperationId(), acknowledge: true };
      attempt.current = request; sending = true;
      const value = await saveProtonTemplateCapture(request); if (mounted.current) show(value);
    }
    catch (cause) { if (mounted.current) { unresolved.current = sending; setNeedsCheck(sending); setError(runtimeErrorMessage(cause, t("La captura no está confirmada. Consulta su resultado antes de repetir."))); } }
    finally { finish(); }
  }
  async function check() {
    if (!attempt.current || !start("check")) return;
    try { const value = await checkProtonTemplateCapture(attempt.current); if (mounted.current) show(value); }
    catch (cause) { if (mounted.current) { unresolved.current = true; setNeedsCheck(true); setError(runtimeErrorMessage(cause, t("No se pudo comprobar la captura. Conserva esta revisión y vuelve a consultar."))); } }
    finally { finish(); }
  }
  const disabled = Boolean(busy) || needsCheck || saved;
  const progress = busy === "review" ? t("Revisando la versión guardada y sus recursos…") : busy === "save" ? t("Verificando la revisión y guardando en la biblioteca del dispositivo…") : t("Consultando el resultado de la captura…");
  return createPortal(<ModalFrame label={t("Guardar como plantilla")} onClose={close} fallbackFocus={fallbackFocus} className="proton-rail-dialog">
    <section className="proton-confirm-dialog space-y-4 p-5" style={{ width: "min(100%, 48rem)" }}>
      <DialogHeading title={t("Guardar como plantilla")} closeLabel={t("Cerrar")} busy={Boolean(busy) || needsCheck} onClose={close} />
      <p className="text-sm">{t("Documento de origen:")} <strong>{prepared?.source.name || documentName}</strong> · {t("Versión guardada en Proton")}</p>
      <p className="text-sm text-muted">{t("La plantilla se conserva en la biblioteca de este dispositivo. Incluye el contenido guardado y los recursos compatibles; los borradores privados quedan fuera.")}</p>
      {!validScope && <InlineNotice tone="warning">{t("El documento ya no corresponde al ámbito abierto. Vuelve a abrir la captura.")}</InlineNotice>}
      {!connected && !needsCheck && <InlineNotice tone="warning">{t("Necesitas conexión para revisar y capturar la versión guardada. Puedes consultar un resultado ya iniciado.")}</InlineNotice>}
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {busy && <div role="status" className="space-y-2 text-sm"><p>{progress}</p><ProgressBar label={t("Capturando plantilla")} /></div>}
      {needsCheck && <InlineNotice tone="warning">{t("El resultado está pendiente de comprobar. No se crea otra plantilla ni se repite el guardado automáticamente.")}</InlineNotice>}
      {outcome?.state === "saved" && <InlineNotice tone="success" announce="status">{t("«{name}» está guardada como plantilla en este dispositivo.", { name: outcome.template?.name || name })}</InlineNotice>}
      {outcome?.state === "retired" && <InlineNotice tone="neutral">{t("La captura se guardó y después fue retirada de la biblioteca. Esta operación no la vuelve a crear.")}</InlineNotice>}
      {outcome?.state === "not-recorded" && <InlineNotice tone="neutral">{t("La captura no figura en la biblioteca. Puedes revisar el contenido y confirmar otro intento con la misma operación.")}</InlineNotice>}
      {!saved && <>
        <fieldset disabled={disabled} className="space-y-3">
          <label className="grid gap-1 text-sm">{t("Nombre de la plantilla")}<input data-autofocus className="ui-field" value={name} maxLength={240} onChange={event => { setName(event.target.value); metadataChanged(); }} /></label>
          <label className="grid gap-1 text-sm">{t("Descripción opcional")}<textarea className="ui-field" value={description} rows={2} maxLength={2000} onChange={event => { setDescription(event.target.value); metadataChanged(); }} /></label>
        </fieldset>
        {prepared && <>
          <div className="max-h-[32dvh] overflow-auto rounded-xl border border-line p-3" onClickCapture={event => { if ((event.target as Element).closest("a")) { event.preventDefault(); event.stopPropagation(); } }}>
            <Suspense fallback={<p role="status" className="text-sm">{t("Preparando vista previa…")}</p>}><Preview markdown={prepared.markdown} ariaLabel={t("Vista previa de la plantilla")} emptyMessage={t("El documento está vacío.")} /></Suspense>
          </div>
          <div className="space-y-2 text-sm"><h3 className="font-semibold">{t("Recursos incluidos ({count})", { count: prepared.resources.length })}</h3>
            {prepared.resources.length ? <ul className="max-h-[22dvh] space-y-2 overflow-auto">{prepared.resources.map((resource, index) => <li key={`${resource.sha256}:${index}`} className="flex items-start gap-2 rounded-lg border border-line p-2">
              {resource.kind === "image" ? <Image size={16} aria-hidden="true" /> : <Paperclip size={16} aria-hidden="true" />}<div className="min-w-0 flex-1"><p className="break-words">{resource.name || t("Imagen incrustada")} · {(resource.bytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KiB</p>{resource.path && <p className="break-words text-xs text-muted">{resource.path}</p>}</div>
            </li>)}</ul> : <p className="text-muted">{t("No hay recursos que copiar.")}</p>}
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledge} disabled={disabled} onChange={event => setAcknowledge(event.target.checked)} />{t("He revisado el contenido y los recursos y confirmo que pueden reutilizarse como plantilla.")}</label>
        </>}
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={Boolean(busy) || needsCheck} onClick={close}>{t("Cerrar")}</Button>
        {needsCheck ? <Button variant="primary" disabled={Boolean(busy)} onClick={() => void check()}>{t("Comprobar captura")}</Button> : !saved && <>
          <Button disabled={Boolean(busy) || !connected || !validScope} onClick={() => void review()}>{t(prepared ? "Volver a revisar" : "Revisar versión guardada")}</Button>
          {prepared && <Button variant="primary" disabled={Boolean(busy) || !connected || !validScope || !name.trim() || !acknowledge} onClick={() => void save()}>{t("Guardar en este dispositivo")}</Button>}
        </>}
      </div>
    </section>
  </ModalFrame>, document.body);
}
