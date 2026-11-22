import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { usePortabilityCopy } from "../../lib/i18n/protonPortabilityCopy";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { ApiError } from "../../lib/api/client";
import { getDocumentTemplate, listDocumentTemplates } from "../../lib/api/documentTemplates";
import { createProtonTemplateDocument, previewProtonTemplate, prepareProtonTemplatePackage, type ProtonTemplateInput, type ProtonTemplatePreview } from "../../lib/api/protonTemplates";
import type { DocumentTemplate, DocumentTemplateInventory } from "../../types/documentTemplates";
import type { ProjectTransferJob } from "../../types/projectTransfer";
import { ProtonRestoreReview } from "./ProtonRestoreReview";
import type { ProtonNode } from "../../types/protonWorkspace";

const MarkdownPreview = lazy(() => import("../editor/ReadonlyMarkdownViewer").then(module => ({ default: module.ReadonlyMarkdownViewer })));

type Props = {
  accountId: string;
  connected?: boolean;
  canWrite?: boolean;
  root: ProtonNode;
  destination: ProtonNode[];
  beforeCreate: () => Promise<void>;
  onCreated: (node: ProtonNode) => void;
  onCreatePending?: (pending: boolean) => void;
  onClose: () => void;
  fallbackFocus?: () => HTMLElement | null;
};

export function ProtonTemplateDialog(props: Props) {
  return <TemplateContent key={JSON.stringify([props.accountId, props.root.nodeId, props.destination.map(item => item.nodeId)])} {...props} />;
}

function TemplateContent({ accountId, connected = true, canWrite = true, root, destination, beforeCreate, onCreated, onCreatePending, onClose, fallbackFocus }: Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const { t } = usePortabilityCopy();
  const [catalog, setCatalog] = useState<DocumentTemplateInventory>();
  const [templateId, setTemplateId] = useState("");
  const [template, setTemplate] = useState<DocumentTemplate>();
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ProtonTemplatePreview>();
  const [previewInput, setPreviewInput] = useState<ProtonTemplateInput>();
  const [staged, setStaged] = useState<ProjectTransferJob>();
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restorePending = useRef(false);
  const notified = useRef(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [detailRetry, setDetailRetry] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const [created, setCreated] = useState<ProtonNode>();
  const pending = useRef(false);
  const mounted = useRef(false);
  const previewGeneration = useRef(0);
  const working = busy || restoreBusy;
  const parent = destination[destination.length - 1];
  const fileName = /\.md$/i.test(name.trim()) ? name.trim() : `${name.trim()}.md`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const request = { active: true };
    setLoading(true);
    setError("");
    void listDocumentTemplates().then(result => {
      if (request.active) { setCatalog(result); setLoading(false); }
    }, cause => {
      if (request.active) { setError(runtimeErrorMessage(cause, t("No se pudo consultar el catálogo de plantillas."))); setLoading(false); }
    });
    return () => { request.active = false; };
  }, [retry]);
  useEffect(() => {
    setTemplate(undefined); setPreview(undefined); setValues({});
    previewGeneration.current += 1;
    if (!templateId) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setError("");
    void getDocumentTemplate(templateId).then(value => {
      if (!active) return;
      if (value.id !== templateId || typeof value.markdown !== "string" || typeof value.revision !== "string"
        || !Array.isArray(value.variables) || value.variables.some(key => typeof key !== "string")) {
        setError(t("La plantilla recibida no tiene un formato compatible."));
      } else setTemplate(value);
      setLoading(false);
    }, cause => {
      if (active) { setError(runtimeErrorMessage(cause, t("No se pudo abrir la plantilla."))); setLoading(false); }
    });
    return () => { active = false; };
  }, [templateId, detailRetry]);

  function invalidate() { previewGeneration.current += 1; setPreview(undefined); setPreviewInput(undefined); setError(""); }

  async function review() {
    if (!template || pending.current || !name.trim()) return;
    pending.current = true; setBusy(true); setError("");
    const generation = previewGeneration.current;
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    try {
      const input = { accountId, rootId: root.nodeId, templateId: template.id, revision: template.revision,
        name: fileName, values, localDate };
      const result = await previewProtonTemplate(input);
      if (mounted.current && generation === previewGeneration.current) {
        if (result.templateId !== template.id || result.revision !== template.revision
          || result.name !== fileName || typeof result.markdown !== "string"
          || (result.resources?.length ?? 0) !== (template.resources?.length ?? 0)) {
          throw new Error(t("La vista previa no corresponde al documento y la plantilla seleccionados."));
        }
        setPreview(result); setPreviewInput(input);
      }
    } catch (cause) {
      if (mounted.current && generation === previewGeneration.current) {
        setError(runtimeErrorMessage(cause, t("No se pudo preparar el documento.")));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function prepareResources() {
    if (!preview || !previewInput || pending.current || staged) return;
    pending.current = true; setBusy(true); setError(""); onCreatePending?.(true);
    try {
      await beforeCreate();
      const value = await prepareProtonTemplatePackage(previewInput, preview);
      if (mounted.current) setStaged(value);
    } catch (cause) {
      if (mounted.current) { setUncertain(true); setError(runtimeErrorMessage(cause, t("La preparación no está confirmada. Consúltala en Copias portables antes de repetir."))); }
    } finally { pending.current = false; onCreatePending?.(restorePending.current); if (mounted.current) setBusy(false); }
  }
  function close() { if (!pending.current && !restorePending.current) onClose(); }
  async function create() {
    if (!preview || pending.current || !parent || uncertain || created) return;
    if (preview.resources?.length) { await prepareResources(); return; }
    pending.current = true; setBusy(true); setError("");
    let sending = false;
    try {
      onCreatePending?.(true);
      await beforeCreate();
      sending = true;
      const node = await createProtonTemplateDocument(accountId, root.nodeId, parent.nodeId, preview);
      if (mounted.current) { setCreated(node); onCreated(node); }
    } catch (cause) {
      if (!mounted.current) return;
      const unknown = sending && (!(cause instanceof ApiError) || cause.operationOutcome !== "not-started" && cause.operationOutcome !== "not-applied");
      setUncertain(unknown);
      setError(unknown ? t("Proton no confirmó el resultado. Comprueba la carpeta de destino antes de volver a crear el documento.")
        : runtimeErrorMessage(cause, t("No se pudo crear el documento.")));
    } finally {
      pending.current = false;
      onCreatePending?.(false);
      if (mounted.current) setBusy(false);
    }
  }

  return createPortal(<ModalFrame label={t("Nuevo documento desde plantilla")} onClose={close} fallbackFocus={fallbackFocus} className="proton-rail-dialog">
    <section className="proton-confirm-dialog space-y-3 p-5">
      <DialogHeading title={t("Nuevo documento desde plantilla")} closeLabel={t("Cerrar")} busy={working} onClose={close} />
      <p className="break-words text-sm">{t("Destino")} <strong>{destination.map(node => node.name).join(" / ")}</strong></p>
      {error && <InlineNotice tone={uncertain ? "warning" : "error"} announce="alert">{error}</InlineNotice>}
      {staged ? <ProtonRestoreReview workspace={{ accountId, root, canWrite }} source={staged} connected={connected} beforeApply={beforeCreate} destination={destination}
        onPendingChange={value => { restorePending.current = value; setRestoreBusy(value); onCreatePending?.(value || pending.current); }}
        onResult={result => {
          if (result.phase !== "complete" || notified.current || !preview) return;
          const entry = result.entries.find(item => item.kind === "file" && item.path === preview.name && item.nodeId && item.revisionId);
          if (!entry?.nodeId || !entry.revisionId) return;
          notified.current = true; const node: ProtonNode = { nodeId: entry.nodeId, revisionId: entry.revisionId, name: preview.name, type: "file" };
          setCreated(node); onCreated(node);
        }} />
        : created ? <InlineNotice tone="success" announce="status">{t("«{name}» se ha creado en Proton.", { name: created.name })}</InlineNotice>
        : uncertain ? null : <>
          {loading && <p role="status" className="text-sm">{t("Leyendo plantillas…")}</p>}
          {!catalog && !loading && <Button onClick={() => setRetry(value => value + 1)}>{t("Reintentar")}</Button>}
          {catalog && <>
            {!catalog.complete && <InlineNotice tone="warning">{t("El catálogo contiene elementos que requieren revisión.")}</InlineNotice>}
            <fieldset disabled={busy || loading} className="space-y-3">
              <label className="grid gap-1 text-sm">Plantilla
                <select className="ui-field w-full" value={templateId} onChange={event => {
                  invalidate(); setTemplate(undefined); setValues({}); setTemplateId(event.target.value);
                }}>
                  <option value="">{t("Elegir plantilla…")}</option>
                  {catalog.templates.map(item => <option key={item.id} value={item.id} >
                    {item.name}{item.builtIn ? "" : ` · ${t("Este dispositivo")}`}{item.resourceCount ? ` · ${item.resourceCount} ${t(item.resourceCount === 1 ? "adjunto" : "adjuntos")}` : ""}
                  </option>)}
                </select>
              </label>
              {templateId && !template && !loading && <Button onClick={() => setDetailRetry(value => value + 1)}>{t("Reintentar plantilla")}</Button>}
              <label className="grid gap-1 text-sm">Nombre del documento
                <input className="ui-field" maxLength={200} value={name} onChange={event => { setName(event.target.value); invalidate(); }} />
              </label>
              {template?.variables.filter(key => !["titulo", "fecha", "proyecto"].includes(key)).map(key =>
                <label key={key} className="grid gap-1 text-sm">{key}
                  <input className="ui-field" maxLength={16384} value={values[key] ?? ""}
                    onChange={event => { setValues(current => ({ ...current, [key]: event.target.value })); invalidate(); }} />
                </label>)}
              {!preview && <Button disabled={!template || !name.trim()} onClick={() => void review()}>{t("Revisar documento")}</Button>}
            </fieldset>
            {preview?.resources?.length ? <InlineNotice tone="neutral">{t("El documento y sus {count} adjuntos se crearán juntos en una carpeta nueva del destino elegido. Revisarás su nombre y cada archivo antes de escribir.", { count: preview.resources.length })}</InlineNotice> : null}
            {!!preview?.resources?.length && <ul className="space-y-1 text-sm" aria-label={t("Adjuntos de la plantilla")}>{preview.resources.map(resource => <li key={resource.path}>{resource.name} · {Math.ceil(resource.bytes / 1024)} KiB</li>)}</ul>}
            {preview && <div onClickCapture={event => { if ((event.target as Element).closest("a")) { event.preventDefault(); event.stopPropagation(); } }} className="max-h-[35dvh] overflow-auto rounded-xl border border-line p-3">
              <Suspense fallback={<p role="status" className="text-sm">{t("Preparando vista previa…")}</p>}>
                <MarkdownPreview markdown={preview.markdown} ariaLabel={t("Vista previa del documento")} emptyMessage={t("El documento está vacío.")} />
              </Suspense>
            </div>}
          </>}
        </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button data-autofocus disabled={working} onClick={close}>{t(created || uncertain ? "Cerrar" : "Cancelar")}</Button>
        {preview && !staged && !created && !uncertain && <Button variant="primary" disabled={busy} onClick={() => void create()}>
          {t(busy ? "Preparando…" : preview?.resources?.length ? "Preparar carpeta con adjuntos" : "Crear en Proton")}
        </Button>}
      </div>
    </section>
  </ModalFrame>, document.body);
}
