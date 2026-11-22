import { useProtonDocumentCopy, type ProtonDocumentNotice } from "../../lib/i18n/protonDocumentCopy";
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { ArrowLeft, CloudUpload, FileText, Image as ImageIcon, Languages, Link2, PanelTop, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { StatusTag } from "../../components/ui/StatusTag";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { MarkdownTools } from "../editor/MarkdownTools";
import { MarkdownSourceViewer } from "../editor/MarkdownSourceViewer";
import {
  emptyMarkdownEditorFormatState, emptyMarkdownEditorHistoryState,
  type MarkdownEditorAction, type MarkdownEditorActionOptions,
  type MarkdownEditorDiagramEditTarget, type MarkdownEditorImageEditTarget,
} from "../editor/editorTypes";
import { markdownImage } from "../../lib/markdownImage";
import type { ProtonDocumentJump, ProtonDocumentKey, ProtonNode } from "../../types/protonWorkspace";
import type { HandwrittenNoteContent } from "../../types/domain";
import type { OpenedDocument } from "./useProtonDocument";
import { imageObjectUrl, protonImageCache } from "./protonImages";
import { protonTools } from "./protonTools";
import type { ProtonDocumentTool, ProtonToolTarget } from "./protonToolTypes";
import { ProtonInsertContentDialog } from "./ProtonInsertContentDialog";
import { ProtonExportActions } from "./ProtonExportActions";
import { ProtonHandwrittenExportActions } from "./ProtonHandwrittenExportActions";
import { useProtonEditorTools } from "./useProtonEditorTools";
import { isProtonReferenceName } from "./protonReferenceFormat";
import { checkpointPendingEditorInput } from "../editor/pendingInputCheckpoints";
import type { ProtonNoteAiController } from "./ProtonPageAiDialog";

const DiagramDialog = lazy(() => import("../documents/InsertDiagramDialog").then(module => ({ default: module.InsertDiagramDialog })));
const FindPanel = lazy(() => import("../editor/DocumentToolsPanel").then(module => ({ default: module.DocumentToolsPanel })));
const ReferenceViewer = lazy(() => import("./ProtonReferenceViewer").then(module => ({ default: module.ProtonReferenceViewer })));
const HandwrittenPreview = lazy(() => import("./ProtonHandwrittenPreview").then(module => ({ default: module.ProtonHandwrittenPreview })));
const HandwrittenEditor = lazy(() => import("./ProtonHandwrittenEditor").then(module => ({ default: module.ProtonHandwrittenEditor })));
const References = lazy(() => import("./ProtonReferencesTool").then(module => ({ default: module.ProtonReferencesTool })));
const NoteEmbedDialog = lazy(() => import("./ProtonNoteEmbedDialog").then(module => ({ default: module.ProtonNoteEmbedDialog })));
const action = "proton-document-action";
const noAction = () => {};
const toolIcons = { assistant: Sparkles, translation: Languages, images: ImageIcon, find: Search, references: Link2 };

type ToolId = ProtonDocumentTool["id"] | "find" | "references";
type Dialog = { target: ProtonToolTarget } & (
  | { kind: "link" }
  | { kind: "image"; media?: MarkdownEditorImageEditTarget }
  | { kind: "diagram"; diagram?: MarkdownEditorDiagramEditTarget }
  | { kind: "note-page" }
);

type Props = {
  document: OpenedDocument;
  workspaceRoot?: ProtonNode;
  getCurrent: () => OpenedDocument | null;
  isBusy: () => boolean;
  editorCheckpoint: MutableRefObject<((key: number) => void) | null>;
  edited: boolean;
  connected: boolean;
  busy: boolean;
  canWrite: boolean;
  tabs: ReactNode;
  toolsId: string;
  toolsHidden: boolean;
  compact: boolean;
  onShowTools: () => void;
  onCollapseTools?: () => void;
  aiSettingsRevision: number;
  onCheckAiUsage?: () => void;
  uploadImage?: (address: ProtonDocumentKey, file: File) => Promise<string>;
  onEdit: (markdown: string) => void;
  onEditHandwritten: (note: HandwrittenNoteContent) => void;
  onProtectNote: () => Promise<void>;
  onNoteAiApplied: ProtonNoteAiController["onApplied"];
  onProtect: () => void;
  onSave: () => void;
  onReconcile: () => void;
  onReviewConflict: () => void;
  onOpenReference: (node: ProtonNode, location?: { revisionId: string; line: number }) => void;
  searchJump?: ProtonDocumentJump | null;
  onSearchJumpHandled?: () => void;
  onDiscard: () => void;
  onReload: () => void;
  exportRequested: boolean;
  onExportRequestHandled: () => void;
};

export function ProtonDocumentPane({
  document: opened, workspaceRoot, getCurrent, isBusy, editorCheckpoint, edited, connected, busy, canWrite, uploadImage, aiSettingsRevision,
  tabs, toolsId, toolsHidden, compact, onShowTools, onCollapseTools,
  onEdit, onEditHandwritten, onProtect, onSave, onReconcile, onReviewConflict, onOpenReference, onDiscard, onReload, exportRequested, onExportRequestHandled,
  searchJump, onSearchJumpHandled,
  onProtectNote, onNoteAiApplied, onCheckAiUsage,
}: Props) {
  const copy = useProtonDocumentCopy();
  const { address, document: source, editorKey } = opened;
  const isMarkdown = source.markdown !== null;
  const isEditable = isMarkdown || !!opened.handwritten;
  const conflict = opened.draft?.state === "conflict";
  const unknown = opened.uncertain || opened.draft?.state === "unknown";
  const readOnly = busy || !connected || unknown || conflict || !!opened.needsDraftReload;
  useLayoutEffect(() => {
    if (readOnly && opened.handwritten) checkpointPendingEditorInput();
  }, [readOnly, editorKey]);
  const [confirmDiscardKey, setConfirmDiscardKey] = useState<number | null>(null);
  const [sourceViewKey, setSourceViewKey] = useState<number | null>(null);
  const [sourceLine, setSourceLine] = useState<{ editorKey: number; line: number } | null>(null);
  const sourceVisible = sourceViewKey === editorKey;
  const [zoom, setZoom] = useState(100);
  const [pinned, setPinned] = useState(true);
  const [format, setFormat] = useState({ key: editorKey, value: emptyMarkdownEditorFormatState });
  const [history, setHistory] = useState({ key: editorKey, value: emptyMarkdownEditorHistoryState });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<{ key: number; text: ProtonDocumentNotice } | null>(null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [compactToolsOpen, setCompactToolsOpen] = useState(false);
  const [visitedTools, setVisitedTools] = useState<Set<ToolId>>(() => new Set());
  const surfaceRef = useRef<HTMLDivElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const toolsClose = useRef<HTMLButtonElement>(null);
  const toolsOpen = compact ? compactToolsOpen && isMarkdown : Boolean(tool);
  const panelHidden = toolsHidden || (compact && !toolsOpen);
  const panelId = useId();
  useEffect(() => {
    if (compact && toolsOpen) toolsClose.current?.focus({ preventScroll: true });
  }, [compact, toolsOpen]);
  const { controller, connectController, capture, apply, validateTarget, getEditableEditor } =
    useProtonEditorTools(editorKey, isMarkdown && !sourceVisible && !readOnly, getCurrent, isBusy);
  useLayoutEffect(() => {
    const flush = (key: number) => { if (key === editorKey) controller?.flushMarkdown?.(); };
    editorCheckpoint.current = flush;
    return () => { if (editorCheckpoint.current === flush) editorCheckpoint.current = null; };
  }, [controller, editorCheckpoint, editorKey]);
  const toolAvailable = isMarkdown && !sourceVisible && !readOnly && controller !== null;

  useEffect(() => {
    if (!searchJump || !isMarkdown || busy) return;
    if (searchJump.line) {
      if (searchJump.revisionId === source.revisionId && opened.markdown === source.markdown) {
        setSourceLine({ editorKey, line: searchJump.line });
        setSourceViewKey(editorKey);
      } else {
        setNotice({ key: editorKey, text: "referenceStale" });
      }
      onSearchJumpHandled?.();
      return;
    }
    if (!controller) return;
    if (sourceVisible) {
      setSourceViewKey(null);
      return;
    }
    if (searchJump.revisionId !== source.revisionId || opened.markdown !== source.markdown) {
      setNotice({ key: editorKey, text: "searchStale" });
    } else {
      const match = controller.findText?.(searchJump.query)?.[0];
      if (match) controller.navigateTo?.(match.from, match.to);
      else setNotice({ key: editorKey, text: "sourceMatch" });
    }
    onSearchJumpHandled?.();
  }, [busy, controller, editorKey, isMarkdown, onSearchJumpHandled, opened.markdown, searchJump, source.markdown, source.revisionId, sourceVisible]);

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

  const resourceNotice = (text: ProtonDocumentNotice) => setNotice({ key: editorKey, text });

  function openTool(id: ToolId) {
    onShowTools();
    if (compact) setCompactToolsOpen(true);
    setTool(current => current === id ? null : id);
    setVisitedTools(previous => previous.has(id) ? previous : new Set(previous).add(id));
  }

  function closeTools() {
    if (compact) {
      setCompactToolsOpen(false);
      requestAnimationFrame(() => toolsTrigger.current?.focus({ preventScroll: true }));
    } else if (onCollapseTools) onCollapseTools();
    else setTool(null);
  }

  function runAction(action: MarkdownEditorAction, options?: MarkdownEditorActionOptions) {
    const editor = getEditableEditor();
    if (!editor) return;
    if (action === "image" || action === "diagram" || action === "link") {
      const target = capture();
      if (target?.selection) setDialog({ target, kind: action });
      else resourceNotice("cursorRequired");
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
    resourceNotice("targetChanged");
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
    if (!target || target.editorKey !== editorKey) throw new Error(copy.errors.editorUnavailable);
    const path = await uploadImage(target.address, file);
    if (!validateTarget(target)) throw new Error(copy.errors.uploadChanged);
    return markdownImage(file.name.replace(/\.[^.]+$/, ""), path);
  });

  const activeDialog = dialog?.target.editorKey === editorKey ? dialog : null;
  const confirmDiscard = confirmDiscardKey === editorKey;
  const draftStatus = opened.needsDraftReload ? copy.status.reload
    : unknown ? copy.status.unknown
    : conflict ? copy.status.conflict
    : edited ? copy.status.edited
    : opened.draft ? copy.status.draft
    : opened.receipt ? copy.status.saved
    : isMarkdown ? copy.status.read : copy.status.preview;
  const statusTone = unknown || conflict || edited || opened.needsDraftReload ? "warning" : opened.receipt ? "success" : "neutral";

  function toolButton(id: ToolId) {
    const Icon = toolIcons[id];
    return <Button key={id} variant="quiet" size="compact" data-tool={id} aria-expanded={tool === id}
      aria-controls={panelId} onClick={() => openTool(id)}><Icon size={16} aria-hidden="true" /><span>{copy.tools[id]}</span></Button>;
  }

  return <section className="proton-document-pane" data-tool-open={toolsOpen} aria-label={source.node.name}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing
        || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
      if (event.key === "Escape" && compact && toolsOpen) {
        event.preventDefault();
        closeTools();
      } else if (toolAvailable && !event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (tool !== "find") openTool("find");
        else {
          onShowTools();
          if (compact) setCompactToolsOpen(true);
        }
      }
    }}>
    <div className="proton-document-top">
      {tabs}
      <div className={tabs ? "sr-only" : "proton-document-header"}>
        <div className="proton-document-heading">
          <FileText size={19} className="shrink-0 text-brand-dark" aria-hidden="true" />
          <h2 className="truncate" title={source.node.name}>{source.node.name}</h2>
        </div>
      </div>
    </div>
    <aside id={toolsId} className="proton-document-side" aria-label={copy.toolsLabel}
      aria-hidden={panelHidden || undefined} ref={element => { if (element) element.inert = panelHidden; }}>
      <header className="proton-tool-header">
        {compact ? <Button ref={toolsClose} variant="quiet" onClick={closeTools}>
          <ArrowLeft size={17} aria-hidden="true" /> {copy.back}
        </Button> : <>
          <h3>{copy.toolsHeading}</h3>
          {(tool || onCollapseTools) && <Button variant="quiet" size="icon" aria-label={copy.closePanel}
            onClick={closeTools}><X size={17} aria-hidden="true" /></Button>}
        </>}
      </header>
      {isMarkdown && <div className="proton-document-tools" aria-label={copy.actionsLabel}>
        {toolButton("find")}
        {toolButton("references")}
        {protonTools.map(item => toolButton(item.id))}
      </div>}
      <div className="proton-document-side-content" id={panelId}>
        {!tool && <p className="proton-tool-empty">{isMarkdown ? source.node.name : copy.openMarkdown}</p>}
        {visitedTools.has("find") && <section hidden={tool !== "find"}>
          <Suspense fallback={<p role="status">{copy.loading.find}</p>}>
            <FindPanel controller={toolAvailable ? controller : null} scope={String(editorKey)} name={source.node.name}
              revision={opened.markdown} onRevealMatch={compact ? closeTools : undefined} />
          </Suspense>
        </section>}
        {tool === "references" && isMarkdown && <Suspense fallback={<p role="status">{copy.loading.references}</p>}>
          {opened.draft && <InlineNotice tone="neutral">{copy.referencesSaved}</InlineNotice>}
          <References address={address} revisionId={source.revisionId} connected={connected && !busy} onOpen={onOpenReference} />
        </Suspense>}
        {protonTools.filter(item => visitedTools.has(item.id)).map(({ id, panel: Panel }) => <section key={id} hidden={tool !== id}>
          <Suspense fallback={<p role="status">{copy.loading.tool}</p>}>
            <Panel available={toolAvailable} editorKey={editorKey} capture={capture} apply={apply} aiSettingsRevision={aiSettingsRevision} onCheckAiUsage={onCheckAiUsage}
              sourceScope={workspaceRoot ? { root: workspaceRoot, address, revisionId: opened.draft?.baseRevisionId ?? source.revisionId } : undefined} />
          </Suspense>
        </section>)}
      </div>
    </aside>
    <div className="proton-document-body">
      <div className="proton-document-center">
        {isMarkdown && !pinned && <div className="proton-document-format-trigger"><button type="button" className={action} onClick={() => setPinned(true)}><PanelTop size={16} /> {copy.format}</button></div>}
        {isMarkdown && <MarkdownTools surfaceRef={surfaceRef} scope={String(editorKey)} pinned={pinned} onPinnedChange={setPinned}
          editorReady={toolAvailable} historyOpen={false} historyEnabled={false} historyDisabledReason=""
          activeActions={format.key === editorKey ? format.value : emptyMarkdownEditorFormatState}
          editorHistoryState={history.key === editorKey ? history.value : emptyMarkdownEditorHistoryState}
          documentActionsEnabled={false} markdownZoomPercent={zoom} markdownSourceVisible={sourceVisible}
          onMarkdownZoomChange={setZoom} onToggleMarkdownSource={() => { setSourceLine(null); setSourceViewKey(sourceVisible ? null : editorKey); }}
          onRunEditorAction={runAction} onExportDocument={noAction} onToggleHistory={noAction} />}
        <div ref={surfaceRef} className="proton-document-canvas" data-markdown-canvas={isMarkdown || undefined}>
          {isMarkdown ? <div className="proton-document-paper proton-note-surface">
            {sourceVisible && <MarkdownSourceViewer markdown={opened.markdown} zoomPercent={zoom}
              lineNumber={sourceLine?.editorKey === editorKey ? sourceLine.line : null} />}
            <div hidden={sourceVisible}>
              <MarkdownEditor key={editorKey} documentKey={String(editorKey)} markdown={opened.markdown}
                onChange={markdown => { if (getCurrent()?.editorKey === editorKey) onEdit(markdown); }}
                active={!sourceVisible} readOnly={readOnly || sourceVisible} zoomPercent={zoom} resolveImageSource={resolveImage}
                onControllerChange={connectController} onFormatStateChange={value => setFormat({ key: editorKey, value })}
                onHistoryStateChange={value => setHistory({ key: editorKey, value })} onSelectionChange={noAction}
                onImageEditRequest={openMedia} onDiagramEditRequest={openDiagram}
                onUploadImage={uploadInEditor} />
            </div>
          </div> : opened.handwritten ? <Suspense fallback={<p className="p-4" role="status">{copy.loading.note}</p>}>
            <div hidden={readOnly} className="h-full min-h-0">
              <HandwrittenEditor key={editorKey} note={opened.handwritten} name={source.node.name} edited={edited}
                aiController={{ getCurrent, protect: onProtectNote, onApplied: onNoteAiApplied }}
                onChange={note => { if (getCurrent()?.editorKey === editorKey) onEditHandwritten(note); }}
                pageFocus={searchJump?.pageId && (!searchJump.revisionId || searchJump.revisionId === source.revisionId)
                  ? { noteId: opened.handwritten.id, pageId: searchJump.pageId, requestId: editorKey } : null}
                onPageFocusHandled={onSearchJumpHandled} />
            </div>
            {readOnly && <HandwrittenPreview key={editorKey} note={opened.handwritten} onReload={onReload} busy={busy || !connected} />}
          </Suspense> : isProtonReferenceName(source.node.name) ? <Suspense fallback={<p className="p-4" role="status">{copy.loading.viewer}</p>}>
            <ReferenceViewer key={editorKey} name={source.node.name} contentBase64={source.contentBase64}
              address={address} revisionId={source.revisionId} searchJump={searchJump} onReload={onReload} busy={busy || !connected} />
          </Suspense> : <ProtonFilePreview key={editorKey} name={source.node.name} bytes={source.contentBase64} />}
        </div>
        <footer className="proton-document-footer" aria-label={copy.footer.label}>
          {(!connected || (isEditable && !canWrite) || opened.remoteChanged || notice?.key === editorKey) && <div className="proton-document-notices">
            {!connected && <InlineNotice tone="warning">{copy.footer.connection}</InlineNotice>}
            {isEditable && !canWrite && <InlineNotice tone="neutral">{copy.footer.privateOnly}</InlineNotice>}
            {opened.remoteChanged && <InlineNotice tone="warning">{copy.footer.remoteChanged}</InlineNotice>}
            {notice?.key === editorKey && <InlineNotice tone="warning" announce="alert"
              action={<Button variant="quiet" size="icon" aria-label={copy.footer.closeNotice} onClick={() => setNotice(null)}><X size={15} aria-hidden="true" /></Button>}>
              {copy.notice[notice.text]}
            </InlineNotice>}
          </div>}
          {confirmDiscard && <div className="proton-document-notices space-y-2 text-sm">
            <p>{copy.footer.discardHelp}</p>
            {unknown && <p>{copy.footer.unknownHelp}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="compact" onClick={() => setConfirmDiscardKey(null)}>{copy.footer.cancel}</Button>
              <Button variant="danger" size="compact" onClick={onDiscard} disabled={busy || edited}>{copy.footer.discard}</Button>
            </div>
          </div>}
          <div className="proton-document-footer-row">
            <StatusTag role="status" tone={statusTone} activity={unknown || edited ? "waiting" : undefined}
              title={statusTone === "neutral" && opened.draft ? copy.footer.recoverable : undefined}>
              {draftStatus}
            </StatusTag>
            <div className="proton-document-actions">
              {compact && isMarkdown && <Button ref={toolsTrigger} size="compact" className="proton-mobile-tools"
                aria-expanded={toolsOpen} aria-controls={toolsId} onClick={() => setCompactToolsOpen(true)}>
                <Sparkles size={16} aria-hidden="true" /> {copy.toolsHeading}
              </Button>}
              {isMarkdown && <ProtonExportActions disabled={busy} requested={exportRequested} onRequestHandled={onExportRequestHandled} snapshot={() => {
                controller?.flushMarkdown?.();
                return getCurrent();
              }} />}
              {opened.handwritten && <ProtonHandwrittenExportActions disabled={busy} snapshot={getCurrent} />}
              {isEditable && edited && <Button size="compact" onClick={onProtect} disabled={busy}>{copy.footer.protect}</Button>}
              {unknown && <Button size="compact" onClick={onReconcile} disabled={busy || !connected}>{copy.footer.check}</Button>}
              {conflict && !unknown && <Button variant="primary" size="compact" onClick={onReviewConflict} disabled={busy || !connected}>{copy.footer.conflict}</Button>}
              {isEditable && !unknown && <Button variant="quiet" size="icon" onClick={onReload} disabled={busy || !connected}
                aria-label={copy.footer.reload} data-tooltip={copy.footer.reload}><RefreshCw size={15} aria-hidden="true" /></Button>}
              {opened.draft && !opened.needsDraftReload && !edited && !confirmDiscard && <Button variant="quiet" size="compact" onClick={() => setConfirmDiscardKey(editorKey)} disabled={busy}>{copy.footer.discardReview}</Button>}
              {isEditable && canWrite && !unknown && !conflict && !opened.needsDraftReload && (opened.draft || edited) &&
                <Button variant="primary" size="compact" onClick={onSave} disabled={busy || !connected}><CloudUpload size={16} aria-hidden="true" /> {copy.footer.save}</Button>}
            </div>
          </div>
        </footer>
      </div>
    </div>
    {activeDialog && (activeDialog.kind === "note-page" ? <Suspense fallback={<p role="status">{copy.loading.notes}</p>}>
      <NoteEmbedDialog target={activeDialog.target} validate={() => !!validateTarget(activeDialog.target)}
        onClose={() => setDialog(null)} onInsert={markdown => apply(activeDialog.target, {kind:"insert_at",markdown})} />
    </Suspense> : activeDialog.kind === "diagram" ? <Suspense fallback={<p role="status">{copy.loading.diagrams}</p>}>
      <DiagramDialog variant={activeDialog.diagram ? "edit" : "insert"} initialCode={activeDialog.diagram?.code}
        initialCaption={activeDialog.diagram?.caption} onClose={() => setDialog(null)} onInsert={markdown => submitDiagram(activeDialog, markdown)}
        onDelete={activeDialog.diagram ? () => {
          const editor = validateTarget(activeDialog.target);
          const position = activeDialog.diagram;
          if (position && editor?.deleteDiagramAt(position.position, position.nodeSize)) setDialog(null);
          else rejectStaleDialog();
        } : undefined} />
    </Suspense> : <ProtonInsertContentDialog kind={activeDialog.kind}
      onInsertNotePage={activeDialog.kind === "image" && !activeDialog.media && canWrite ? () => setDialog({kind:"note-page",target:activeDialog.target}) : undefined}
      initialValue={activeDialog.kind === "image" ? activeDialog.media?.src : undefined}
      initialAlt={activeDialog.kind === "image" ? activeDialog.media?.alt : undefined}
      upload={activeDialog.kind === "image" && uploadImage ? file => {
        if (!validateTarget(activeDialog.target)) return Promise.reject(new Error(copy.errors.targetChanged));
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
  const copy = useProtonDocumentCopy();
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
    : <p className="p-4 text-sm text-ink-secondary">{copy.errors.previewUnavailable}</p>;
}
