import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { CloudUpload, FileText, Image as ImageIcon, Languages, PanelTop, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { MarkdownTools } from "../editor/MarkdownTools";
import { MarkdownSourceViewer } from "../editor/MarkdownSourceViewer";
import {
  emptyMarkdownEditorFormatState, emptyMarkdownEditorHistoryState,
  type MarkdownEditorAction, type MarkdownEditorActionOptions,
  type MarkdownEditorDiagramEditTarget, type MarkdownEditorImageEditTarget,
} from "../editor/editorTypes";
import { markdownImage } from "../../lib/markdownImage";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";
import type { OpenedDocument } from "./useProtonDocument";
import { imageObjectUrl, protonImageCache } from "./protonImages";
import { protonTools } from "./protonTools";
import type { ProtonDocumentTool, ProtonToolTarget } from "./protonToolTypes";
import { ProtonInsertContentDialog } from "./ProtonInsertContentDialog";
import { useProtonEditorTools } from "./useProtonEditorTools";

const DiagramDialog = lazy(() => import("../documents/InsertDiagramDialog").then(module => ({ default: module.InsertDiagramDialog })));
const FindPanel = lazy(() => import("../editor/DocumentToolsPanel").then(module => ({ default: module.DocumentToolsPanel })));
const action = "proton-document-action";
const noAction = () => {};
const toolIcons = { assistant: Sparkles, translation: Languages, images: ImageIcon, find: Search };

type ToolId = ProtonDocumentTool["id"] | "find";
type Dialog = { target: ProtonToolTarget } & (
  | { kind: "link" }
  | { kind: "image"; media?: MarkdownEditorImageEditTarget }
  | { kind: "diagram"; diagram?: MarkdownEditorDiagramEditTarget }
);

type Props = {
  document: OpenedDocument;
  getCurrent: () => OpenedDocument | null;
  isBusy: () => boolean;
  editorCheckpoint: MutableRefObject<((key: number) => void) | null>;
  edited: boolean;
  connected: boolean;
  busy: boolean;
  canWrite: boolean;
  remoteChanged: boolean;
  uploadImage?: (address: ProtonDocumentKey, file: File) => Promise<string>;
  onEdit: (markdown: string) => void;
  onProtect: () => void;
  onSave: () => void;
  onReconcile: () => void;
  onDiscard: () => void;
  onReload: () => void;
};

export function ProtonDocumentPane({
  document: opened, getCurrent, isBusy, editorCheckpoint, edited, connected, busy, canWrite, remoteChanged, uploadImage,
  onEdit, onProtect, onSave, onReconcile, onDiscard, onReload,
}: Props) {
  const { address, document: source, editorKey } = opened;
  const isMarkdown = source.markdown !== null;
  const conflict = opened.draft?.state === "conflict";
  const unknown = opened.uncertain || opened.draft?.state === "unknown";
  const readOnly = busy || !connected || unknown || conflict;
  const [confirmDiscardKey, setConfirmDiscardKey] = useState<number | null>(null);
  const [sourceViewKey, setSourceViewKey] = useState<number | null>(null);
  const sourceVisible = sourceViewKey === editorKey;
  const [zoom, setZoom] = useState(100);
  const [pinned, setPinned] = useState(true);
  const [format, setFormat] = useState({ key: editorKey, value: emptyMarkdownEditorFormatState });
  const [history, setHistory] = useState({ key: editorKey, value: emptyMarkdownEditorHistoryState });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [visitedTools, setVisitedTools] = useState<Set<ToolId>>(() => new Set());
  const surfaceRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { controller, connectController, capture, apply, validateTarget, getEditableEditor } =
    useProtonEditorTools(editorKey, isMarkdown && !sourceVisible && !readOnly, getCurrent, isBusy);
  useLayoutEffect(() => {
    const flush = (key: number) => { if (key === editorKey) controller?.flushMarkdown?.(); };
    editorCheckpoint.current = flush;
    return () => { if (editorCheckpoint.current === flush) editorCheckpoint.current = null; };
  }, [controller, editorCheckpoint, editorKey]);
  const toolAvailable = isMarkdown && !sourceVisible && !readOnly && controller !== null;

  const cacheRef = useRef<{ address: ProtonDocumentKey; cache: ReturnType<typeof protonImageCache> } | null>(null);
  useEffect(() => () => {
    if (cacheRef.current?.address === address) {
      cacheRef.current.cache.dispose();
      cacheRef.current = null;
    }
  }, [address]);
  const resolveImage = useCallback(async (image: string) => {
    if (getCurrent()?.address !== address) return "";
    if (cacheRef.current?.address !== address) {
      cacheRef.current?.cache.dispose();
      cacheRef.current = { address, cache: protonImageCache(address) };
    }
    return (await cacheRef.current.cache.resolve(image)) ?? "";
  }, [address, getCurrent]);

  const resourceNotice = (text: string) => setNotice({ key: editorKey, text });

  function openTool(id: ToolId) {
    setTool(current => current === id ? null : id);
    setVisitedTools(previous => previous.has(id) ? previous : new Set(previous).add(id));
  }

  function runAction(action: MarkdownEditorAction, options?: MarkdownEditorActionOptions) {
    const editor = getEditableEditor();
    if (!editor) return;
    if (action === "image" || action === "diagram" || action === "link") {
      const target = capture();
      if (target?.selection) setDialog({ target, kind: action });
      else resourceNotice("Coloca el cursor en el documento o selecciona texto y vuelve a intentarlo.");
    } else {
      editor.controller.run(action, options);
    }
  }

  function openMedia(media: MarkdownEditorImageEditTarget) {
    const target = capture();
    if (target) setDialog({ target, kind: "image", media });
  }

  function openDiagram(diagram: MarkdownEditorDiagramEditTarget) {
    const target = capture();
    if (target) setDialog({ target, kind: "diagram", diagram });
  }

  function rejectStaleDialog() {
    resourceNotice("El documento cambió o no está disponible.");
  }

  function submitImageOrLink(session: Extract<Dialog, { kind: "link" | "image" }>, value: string, alt: string) {
    const editor = validateTarget(session.target);
    if (!editor) return false;
    if (session.kind === "link") {
      const selection = session.target.selection;
      if (!selection) return false;
      editor.navigateTo?.(selection.from, selection.to);
      return editor.run("link", { link: { href: value } });
    }
    const markdown = markdownImage(alt, value);
    return session.media
      ? editor.replaceImageAt(session.media.position, markdown)
      : apply(session.target, { kind: "insert_at", markdown });
  }

  function submitDiagram(session: Extract<Dialog, { kind: "diagram" }>, markdown: string) {
    const editor = validateTarget(session.target);
    if (!editor) return rejectStaleDialog();
    const applied = session.diagram
      ? editor.replaceDiagramAt(session.diagram.position, session.diagram.nodeSize, markdown)
      : apply(session.target, { kind: "insert_at", markdown });
    if (applied) setDialog(null);
    else rejectStaleDialog();
  }

  const uploadInEditor = uploadImage && (async (file: File) => {
    const target = capture();
    if (!target || target.editorKey !== editorKey) throw new Error("El editor no está disponible para insertar la imagen.");
    const path = await uploadImage(target.address, file);
    if (!validateTarget(target)) throw new Error("La imagen se encuentra en Proton Drive. El documento cambió durante la carga.");
    return markdownImage(file.name.replace(/\.[^.]+$/, ""), path);
  });

  const activeDialog = dialog?.target.editorKey === editorKey ? dialog : null;
  const confirmDiscard = confirmDiscardKey === editorKey;
  const draftStatus = unknown ? "Guardado pendiente de comprobación."
    : conflict ? "La revisión de Proton cambió. Tu borrador se conserva."
    : edited ? "Borrador pendiente de guardar en este dispositivo."
    : opened.draft ? "Borrador privado recuperable en este dispositivo."
    : opened.receipt ? "Guardado en Proton."
    : isMarkdown ? "Leído de Proton." : "Vista previa.";

  function toolButton(id: ToolId, label: string) {
    const Icon = toolIcons[id];
    return <button key={id} type="button" className={action} title={label} aria-label={label} aria-expanded={tool === id}
      aria-controls={tool === id ? panelId : undefined} onClick={() => openTool(id)}><Icon size={16} /><span>{label}</span></button>;
  }

  return <section className="proton-document-pane flex min-h-0 min-w-0 flex-1 flex-col" aria-label={source.node.name}
    onKeyDown={event => {
      if (!toolAvailable || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)
        || event.key.toLowerCase() !== "f" || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
      event.preventDefault();
      if (tool !== "find") openTool("find");
    }}>
    <div className="proton-document-header">
      <div className="proton-document-heading">
        <FileText size={19} className="shrink-0 text-brand-dark" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold" title={source.node.name}>{source.node.name}</h2>
          <p role="status" className="text-xs text-ink-secondary">{draftStatus}</p>
        </div>
      </div>
      <div className="proton-document-actions">
        {isMarkdown && edited && <button className={action} type="button" onClick={onProtect} disabled={busy}>Guardar borrador</button>}
        {isMarkdown && canWrite && !unknown && !conflict && (opened.draft || edited) &&
          <button className={action + " proton-document-primary"} type="button" onClick={onSave} disabled={busy || !connected}><CloudUpload size={16} /> Guardar en Proton</button>}
        {(unknown || conflict) && <button className={action} type="button" onClick={onReconcile} disabled={busy || !connected}>Comprobar revisión</button>}
        {isMarkdown && !unknown && <button className={action} type="button" onClick={onReload} disabled={busy || !connected}
          aria-label="Volver a leer" title="Volver a leer"><RefreshCw size={15} /></button>}
        {opened.draft && !edited && !confirmDiscard && <button className={action} type="button" onClick={() => setConfirmDiscardKey(editorKey)} disabled={busy}>Descartar borrador…</button>}
      </div>
    </div>
    {(!connected || (isMarkdown && !canWrite) || remoteChanged || notice?.key === editorKey) && <div className="proton-document-notices text-xs">
      {!connected && <p>Conexión sin confirmar. Vuelve a conectar para seguir editando.</p>}
      {isMarkdown && !canWrite && <p>El guardado en Proton no está disponible en esta instalación. Puedes preparar un borrador privado.</p>}
      {remoteChanged && <p>Proton ha notificado cambios. Puedes volver a leer el archivo conservando el borrador.</p>}
      {notice?.key === editorKey && <p role="alert" className="flex gap-2">{notice.text}<button type="button" aria-label="Cerrar aviso del editor" onClick={() => setNotice(null)}><X size={15} /></button></p>}
    </div>}
    {confirmDiscard && <div className="proton-document-notices space-y-2 text-sm">
      <p>Se eliminará el borrador de este dispositivo. El archivo en Proton no se modificará.</p>
      {unknown && <p>El estado del último guardado sigue sin confirmarse.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={action} onClick={() => setConfirmDiscardKey(null)}>Cancelar</button>
        <button type="button" className={action} onClick={onDiscard} disabled={busy || edited}>Descartar borrador</button>
      </div>
    </div>}
    <div className="proton-document-body">
      <div className="proton-document-center">
        {isMarkdown && <div className="proton-document-tools" aria-label="Acciones del documento">
          {!pinned && <button type="button" className={action} onClick={() => setPinned(true)}><PanelTop size={16} /> Formato</button>}
          {toolButton("find", "Buscar")}
          {protonTools.map(item => toolButton(item.id, item.label))}
        </div>}
        {isMarkdown && <MarkdownTools surfaceRef={surfaceRef} scope={String(editorKey)} pinned={pinned} onPinnedChange={setPinned}
          editorReady={toolAvailable} historyOpen={false} historyEnabled={false} historyDisabledReason=""
          activeActions={format.key === editorKey ? format.value : emptyMarkdownEditorFormatState}
          editorHistoryState={history.key === editorKey ? history.value : emptyMarkdownEditorHistoryState}
          documentActionsEnabled={false} markdownZoomPercent={zoom} markdownSourceVisible={sourceVisible}
          onMarkdownZoomChange={setZoom} onToggleMarkdownSource={() => setSourceViewKey(sourceVisible ? null : editorKey)}
          onRunEditorAction={runAction} onExportDocument={noAction} onToggleHistory={noAction} />}
        <div ref={surfaceRef} className="proton-document-canvas" data-markdown-canvas={isMarkdown || undefined}>
          {isMarkdown ? <div className="proton-document-paper">
            {sourceVisible && <MarkdownSourceViewer markdown={opened.markdown} zoomPercent={zoom} />}
            <div hidden={sourceVisible}>
              <MarkdownEditor key={editorKey} documentKey={String(editorKey)} markdown={opened.markdown}
                onChange={markdown => { if (getCurrent()?.editorKey === editorKey) onEdit(markdown); }}
                active={!sourceVisible} readOnly={readOnly || sourceVisible} zoomPercent={zoom} resolveImageSource={resolveImage}
                onControllerChange={connectController} onFormatStateChange={value => setFormat({ key: editorKey, value })}
                onHistoryStateChange={value => setHistory({ key: editorKey, value })} onSelectionChange={noAction}
                onImageEditRequest={openMedia} onDiagramEditRequest={openDiagram}
                onUploadImage={uploadInEditor} />
            </div>
          </div> : <ProtonFilePreview key={editorKey} name={source.node.name} bytes={source.contentBase64} />}
        </div>
      </div>
      <aside id={panelId} className="proton-document-side" aria-label="Herramientas de Proton" hidden={!tool}>
        <header>
          <h3>{tool === "find" ? "Buscar en el documento" : protonTools.find(item => item.id === tool)?.label}</h3>
          <button type="button" className={action} aria-label="Cerrar panel" onClick={() => setTool(null)}><X size={17} /></button>
        </header>
        <div className="proton-document-side-content">
          {visitedTools.has("find") && <section hidden={tool !== "find"}>
            <Suspense fallback={<p role="status">Cargando búsqueda…</p>}>
              <FindPanel controller={toolAvailable ? controller : null} scope={String(editorKey)} name={source.node.name} revision={opened.markdown} />
            </Suspense>
          </section>}
          {protonTools.filter(item => visitedTools.has(item.id)).map(({ id, panel: Panel }) => <section key={id} hidden={tool !== id}>
            <Suspense fallback={<p role="status">Cargando herramienta…</p>}>
              <Panel available={toolAvailable} capture={capture} apply={apply} />
            </Suspense>
          </section>)}
        </div>
      </aside>
    </div>
    {activeDialog && (activeDialog.kind === "diagram" ? <Suspense fallback={<p role="status">Cargando diagramas…</p>}>
      <DiagramDialog variant={activeDialog.diagram ? "edit" : "insert"} initialCode={activeDialog.diagram?.code}
        initialCaption={activeDialog.diagram?.caption} onClose={() => setDialog(null)} onInsert={markdown => submitDiagram(activeDialog, markdown)}
        onDelete={activeDialog.diagram ? () => {
          const editor = validateTarget(activeDialog.target);
          const position = activeDialog.diagram;
          if (position && editor?.deleteDiagramAt(position.position, position.nodeSize)) setDialog(null);
          else rejectStaleDialog();
        } : undefined} />
    </Suspense> : <ProtonInsertContentDialog kind={activeDialog.kind}
      initialValue={activeDialog.kind === "image" ? activeDialog.media?.src : undefined}
      initialAlt={activeDialog.kind === "image" ? activeDialog.media?.alt : undefined}
      upload={activeDialog.kind === "image" && uploadImage ? file => {
        if (!validateTarget(activeDialog.target)) return Promise.reject(new Error("El documento cambió o no está disponible."));
        return uploadImage(activeDialog.target.address, file);
      } : undefined}
      onClose={() => setDialog(null)} onSubmit={(source, alt) => submitImageOrLink(activeDialog, source, alt)}
      onDelete={activeDialog.kind === "image" && activeDialog.media ? () => {
        const position = activeDialog.media?.position;
        return position !== undefined && Boolean(validateTarget(activeDialog.target)?.deleteImageAt(position));
      } : undefined} />)}
  </section>;
}

function ProtonFilePreview({ name, bytes }: { name: string; bytes: string | null }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) return;
    const ext = name.split(".").pop()?.toLowerCase();
    const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/" + ext;
    let url: string | null = null;
    try { url = imageObjectUrl(bytes, contentType); } catch { /* Invalid data has no usable preview. */ }
    setPreview(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [bytes, name]);
  return preview ? <img src={preview} alt={name} className="mx-auto max-h-full max-w-full object-contain p-4" />
    : <p className="p-4 text-sm text-ink-secondary">No se pudo mostrar la vista previa de este archivo.</p>;
}
