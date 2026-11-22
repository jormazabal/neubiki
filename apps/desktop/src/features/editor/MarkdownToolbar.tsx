import {
  Bold,
  BookOpen,
  CheckSquare,
  Code2,
  ChevronDown,
  Download,
  FileCode2,
  Heading1,
  Heading2,
  Heading3,
  History,
  Highlighter,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table,
  TerminalSquare,
  Undo2,
  Underline,
  Workflow,
  ZoomIn,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { editorToolsViewport, MarkdownToolsPanel, observeEditorToolsViewport, type MarkdownToolsPinControl } from "./MarkdownToolsPanel";
import type { MarkdownEditorAction, MarkdownEditorActionOptions, MarkdownEditorFormatState, MarkdownEditorHistoryState } from "./editorTypes";
import { markdownHighlightColors, type MarkdownHighlightColorId } from "./highlightPalette";
import type { ExportFormat } from "../../types/domain";

type ToolbarAction = {
  label: string;
  compactLabel?: string;
  icon: LucideIcon;
  action: MarkdownEditorAction;
  extended?: boolean;
  options?: MarkdownEditorActionOptions;
};

const blockFormats = [
  { label: "Normal", action: "paragraph", icon: Pilcrow },
  { label: "Título 1", action: "heading-1", icon: Heading1 },
  { label: "Título 2", action: "heading-2", icon: Heading2 },
  { label: "Título 3", action: "heading-3", icon: Heading3 },
  { label: "Título 4", action: "heading-4", icon: Heading3 },
  { label: "Título 5", action: "heading-5", icon: Heading3 },
  { label: "Título 6", action: "heading-6", icon: Heading3 },
] satisfies Array<{ label: string; action: MarkdownEditorAction; icon: LucideIcon }>;

const primaryInlineTools = [
  { label: "Negrita", icon: Bold, action: "bold" },
  { label: "Cursiva", icon: Italic, action: "italic" },
] satisfies ToolbarAction[];

const secondaryInlineTools = [
  { label: "Tachado", icon: Strikethrough, action: "strike" },
  { label: "Subrayado", compactLabel: "Subrayado HTML", icon: Underline, action: "underline", extended: true },
  { label: "Código inline", icon: Code2, action: "inline-code" },
  { label: "Borrar formato", icon: RemoveFormatting, action: "clear-format" },
] satisfies ToolbarAction[];

const structureTools = [
  { label: "Lista con viñetas", compactLabel: "Viñetas", icon: List, action: "bullet-list" },
  { label: "Lista numerada", compactLabel: "Numerada", icon: ListOrdered, action: "ordered-list" },
  { label: "Checklist", icon: CheckSquare, action: "check-list" },
  { label: "Cita", icon: Quote, action: "quote" },
  { label: "Bloque de código", icon: Code2, action: "code-block" },
  { label: "Separador horizontal", compactLabel: "Separador", icon: Minus, action: "horizontal-rule" },
] satisfies ToolbarAction[];

const insertionTools = [
  { label: "Enlace", icon: Link, action: "link" },
  { label: "Imagen", icon: Image, action: "image" },
  { label: "Diagrama", icon: Workflow, action: "diagram" },
] satisfies ToolbarAction[];

const markdownZoomOptions = [80, 90, 100, 110, 125, 150];

export type MarkdownToolbarProps = {
  contextual?: boolean;
  pinControl?: MarkdownToolsPinControl;
  historyOpen: boolean;
  historyEnabled: boolean;
  historyDisabledReason: string;
  editorReady: boolean;
  extendedUnderlineEnabled?: boolean;
  markdownZoomPercent: number;
  markdownSourceVisible?: boolean;
  activeActions: MarkdownEditorFormatState;
  editorHistoryState: MarkdownEditorHistoryState;
  imageInsertionEnabled?: boolean;
  diagramInsertionEnabled?: boolean;
  documentActionsEnabled?: boolean;
  onRunEditorAction: (action: MarkdownEditorAction, options?: MarkdownEditorActionOptions) => void;
  onExportDocument: (format: ExportFormat) => void;
  onSaveTemplate?: () => void;
  onMarkdownZoomChange: (zoomPercent: number) => void;
  onToggleMarkdownSource?: () => void;
  onToggleHistory: () => void;
};

export function MarkdownToolbar({
  contextual = false,
  pinControl,
  historyOpen,
  historyEnabled,
  historyDisabledReason,
  editorReady,
  extendedUnderlineEnabled = true,
  markdownZoomPercent,
  markdownSourceVisible = false,
  activeActions,
  editorHistoryState,
  imageInsertionEnabled = true,
  diagramInsertionEnabled = true,
  documentActionsEnabled = true,
  onRunEditorAction,
  onExportDocument,
  onSaveTemplate,
  onMarkdownZoomChange,
  onToggleMarkdownSource,
  onToggleHistory,
}: MarkdownToolbarProps) {
  const [openMenu, setOpenMenu] = useState<"block" | "format" | "highlight" | "structure" | "insert" | "table" | "export" | "zoom" | null>(null);
  const [compactOptionsOpen, setCompactOptionsOpen] = useState(false);
  const [hoveredTableSize, setHoveredTableSize] = useState({ rows: 3, columns: 4 });
  const compactToolbar = useCompactToolbarMode();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const compactPanelRef = useRef<HTMLDivElement>(null);
  const menuEntry=useRef<"pointer"|"first"|"last">("pointer"),menuTrigger=useRef<HTMLButtonElement|null>(null),roving=useRef<HTMLButtonElement|null>(null);
  function toolbarButtons(){return [...(toolbarRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")??[])].filter(b=>!b.closest('[role="menu"]')&&!toolbarRef.current?.querySelector('[role="dialog"]')?.contains(b)&&visibleControl(b));}
  function moveTabStop(button:HTMLButtonElement){roving.current=button;for(const item of toolbarButtons())item.tabIndex=item===button?0:-1;}
  function syncToolbarTabStop(){const items=toolbarButtons();if(items.length)moveTabStop(roving.current&&items.includes(roving.current)?roving.current:items[0]);toolbarRef.current?.querySelectorAll<HTMLElement>('span[tabindex]').forEach(node=>node.tabIndex=-1);}
  useEffect(syncToolbarTabStop);
  useEffect(()=>{window.addEventListener("resize",syncToolbarTabStop);return()=>window.removeEventListener("resize",syncToolbarTabStop);},[]);
  function leaveToolbar(backward:boolean){const root=toolbarRef.current;if(!root)return;const modal=root.closest('[role="dialog"],[role="alertdialog"]'),container=modal??document;const controls=[...container.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex],[contenteditable="true"]')].filter(node=>!root.contains(node)&&visibleControl(node)&&(node.tabIndex>=0||node.getAttribute('contenteditable')==="true"));const candidates=controls.filter(node=>root.compareDocumentPosition(node)&(backward?Node.DOCUMENT_POSITION_PRECEDING:Node.DOCUMENT_POSITION_FOLLOWING));const next=backward?candidates[candidates.length-1]:candidates[0];(next??(modal?(backward?controls[controls.length-1]:controls[0]):null)??menuTrigger.current)?.focus();}
  function toolbarKey(event:ReactKeyboardEvent<HTMLDivElement>){
    if(event.nativeEvent.isComposing)return;const target=event.target as HTMLElement,dialog=target.closest('[role="dialog"]');if(dialog&&!dialog.contains(toolbarRef.current))return;
    if(openMenu&&(event.key==="Escape"||event.key==="Tab")){setOpenMenu(null);event.preventDefault();event.stopPropagation();if(event.key==="Tab")leaveToolbar(event.shiftKey);else if(target.closest('[role="menu"]'))menuTrigger.current?.focus();return;}
    if(target.closest('[role="menu"]'))return;const button=target.closest<HTMLButtonElement>('button');if(!button)return;const items=toolbarButtons(),index=items.indexOf(button);if(index<0)return;
    if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();const next=event.key==="Home"?items[0]:event.key==="End"?items[items.length-1]:items[(index+(event.key==="ArrowRight"?1:-1)+items.length)%items.length];moveTabStop(next);next.focus();}
    else if((event.key==="ArrowDown"||event.key==="ArrowUp")&&button.hasAttribute('aria-haspopup')){event.preventDefault();menuEntry.current=event.key==="ArrowUp"?"last":"first";menuTrigger.current=button;if(openMenu)setOpenMenu(null);button.click();}
    else if(event.key==="Enter"||event.key===" "){menuEntry.current="first";menuTrigger.current=button;}
  }
  function menuActionFocus(event:MouseEvent<HTMLDivElement>){if(menuEntry.current!=="pointer"&&(event.target as HTMLElement).closest('[role="menu"] button'))menuTrigger.current?.focus();}
  function toolbarFocus(event:ReactFocusEvent<HTMLDivElement>){const target:EventTarget=event.target;if(target instanceof HTMLButtonElement&&toolbarButtons().includes(target))moveTabStop(target);}

  useEffect(() => {
    if (!openMenu) return;

    function closeOnPointerDown(event: PointerEvent) {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented) {
        if (contextual) event.preventDefault();
        setOpenMenu(null);
      }
    }

    window.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu, contextual]);

  const visibleSecondaryInlineTools = secondaryInlineTools.filter((tool) => !tool.extended || extendedUnderlineEnabled);
  const currentBlockFormat = blockFormats.find((format) => activeActions[format.action]) ?? blockFormats[0];

  function keepEditorSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function runAction(action: MarkdownEditorAction, options?: MarkdownEditorActionOptions) {
    setOpenMenu(null);
    setCompactOptionsOpen(false);
    if (options) {
      onRunEditorAction(action, options);
      return;
    }
    onRunEditorAction(action);
  }

  function runHighlight(color: MarkdownHighlightColorId) {
    runAction("highlight", { highlight: { color } });
  }

  function toggleMenu(menu: typeof openMenu, event: MouseEvent<HTMLButtonElement>) {
    keepEditorSelection(event);
    menuTrigger.current=event.currentTarget;if(event.detail!==0)menuEntry.current="pointer";else if(menuEntry.current==="pointer")menuEntry.current="first";
    setOpenMenu((currentMenu) => (currentMenu === menu ? null : menu));
  }

  function openCompactOptions(event: MouseEvent<HTMLButtonElement>) {
    keepEditorSelection(event);
    setOpenMenu(null);
    setCompactOptionsOpen(true);
  }

  const blockSelect = (
    <BlockFormatSelect
      currentBlockFormat={currentBlockFormat}
      activeActions={activeActions}
      editorReady={editorReady}
      open={openMenu === "block"}
      onMouseDown={keepEditorSelection}
      onToggle={(event) => toggleMenu("block", event)}
      onRun={runAction}
    />
  );

  function toolButton(tool: ToolbarAction, icon = tool.icon) {
    return <ToolbarIconButton key={tool.action} tool={{ ...tool, icon }}
      active={Boolean(activeActions[tool.action])} disabled={!editorReady}
      onMouseDown={keepEditorSelection} onRun={() => runAction(tool.action)} />;
  }

  const highlight = extendedUnderlineEnabled && (
    <div className="relative">
      <HighlightToolbarButton activeColor={activeActions.highlightColor ?? null}
        disabled={!editorReady} expanded={openMenu === "highlight"} onMouseDown={keepEditorSelection}
        onToggle={(event) => toggleMenu("highlight", event)} />
      {openMenu === "highlight" &&
        <HighlightMenu activeColor={activeActions.highlightColor ?? null} onRun={runHighlight} onClear={() => runAction("clear-highlight")} />}
    </div>
  );

  const tablePicker = (
    <div className="relative">
      <ToolbarMenuButton label="Tabla" icon={Table} disabled={!editorReady} expanded={openMenu === "table"}
        onMouseDown={keepEditorSelection} onClick={(event) => toggleMenu("table", event)} />
      {openMenu === "table" &&
        <TablePicker rows={hoveredTableSize.rows} columns={hoveredTableSize.columns}
          onHover={setHoveredTableSize} onInsert={(rows, columns) => runAction("table", { table: { rows, columns } })} />}
    </div>
  );

  function runFromCompactPanel(action: () => void) {
    setCompactOptionsOpen(false);
    action();
  }

  function closeMenuThen(action: () => void) {
    setOpenMenu(null);
    action();
  }

  const documentActions = documentActionsEnabled && (
    <>
      <button type="button"
        className={`toolbar-button neubiki-history-button ${historyOpen ? "toolbar-button-active" : ""} ${historyEnabled ? "" : "opacity-40"}`}
        data-tooltip={historyEnabled ? "Histórico de versiones" : historyDisabledReason}
        aria-label="Histórico de versiones" disabled={!historyEnabled} onMouseDown={keepEditorSelection}
        onClick={() => closeMenuThen(onToggleHistory)}>
        <History size={15} />
      </button>
      <div className="neubiki-document-export-menu relative">
        <ToolbarMenuButton label="Exportar documento" icon={Download} disabled={!editorReady} expanded={openMenu === "export"}
          onMouseDown={keepEditorSelection} onClick={(event) => toggleMenu("export", event)} />
        {openMenu === "export" && (
          <ToolbarMenu align="right">
            <ExportMenuAction label="Markdown (.md)" format="md" onRun={(format) => closeMenuThen(() => onExportDocument(format))} />
            <ExportMenuAction label="PDF (.pdf)" format="pdf" onRun={(format) => closeMenuThen(() => onExportDocument(format))} />
            <ExportMenuAction label="Word (.docx)" format="docx" onRun={(format) => closeMenuThen(() => onExportDocument(format))} />
            {onSaveTemplate && (
              <button role="menuitem" className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-brand-hover"
                onMouseDown={keepEditorSelection} onClick={() => closeMenuThen(onSaveTemplate)}>
                <BookOpen size={14} />Guardar como plantilla…
              </button>
            )}
          </ToolbarMenu>
        )}
      </div>
    </>
  );

  const sourceToggle = <MarkdownSourceToggleButton active={markdownSourceVisible} icon={contextual ? FileCode2 : Code2}
    onMouseDown={keepEditorSelection} onToggle={() => closeMenuThen(() => onToggleMarkdownSource?.())} />;

  const zoomSelector = (
    <div className="relative shrink-0">
      {contextual ? (
        <ToolbarMenuButton label="Zoom del visualizador Markdown" icon={ZoomIn} disabled={false} expanded={openMenu === "zoom"}
          onMouseDown={keepEditorSelection} onClick={(event) => toggleMenu("zoom", event)} />
      ) : (
        <button type="button" className="toolbar-select neubiki-markdown-zoom-select"
          aria-label="Zoom del visualizador Markdown" aria-haspopup="menu" aria-expanded={openMenu === "zoom"}
          onMouseDown={keepEditorSelection} onClick={(event) => toggleMenu("zoom", event)}>
          <ZoomIn size={13} />
          <span className="toolbar-select-label">{markdownZoomPercent}%</span>
          <ChevronDown size={13} />
        </button>
      )}
      {openMenu === "zoom" && (
        <ToolbarMenu align="right">
          {markdownZoomOptions.map((zoomPercent) => (
            <ZoomMenuAction key={zoomPercent} zoomPercent={zoomPercent} active={zoomPercent === markdownZoomPercent}
              onRun={() => closeMenuThen(() => onMarkdownZoomChange(zoomPercent))} />
          ))}
        </ToolbarMenu>
      )}
    </div>
  );

  const historyActions = <ToolbarHistoryActions editorReady={editorReady} editorHistoryState={editorHistoryState}
    onMouseDown={keepEditorSelection} onRun={runAction} />;

  if (contextual) {
    return (
      <div ref={toolbarRef} role="toolbar" aria-label="Herramientas del documento" data-menu-entry={menuEntry.current}
        onKeyDown={toolbarKey} onFocus={toolbarFocus} onClickCapture={menuActionFocus} className="neubiki-editor-palette-tools">
        <PaletteGroup title="Texto" end={blockSelect}>
          {primaryInlineTools.map(tool => toolButton(tool))}
          {visibleSecondaryInlineTools.map(tool => toolButton(tool))}
          {highlight}
        </PaletteGroup>
        <PaletteGroup title="Bloques e inserción">
          {structureTools.map(tool => toolButton(tool, tool.action === "code-block" ? TerminalSquare : tool.icon))}
          {insertionTools.filter(tool =>
            (tool.action !== "image" || imageInsertionEnabled) && (tool.action !== "diagram" || diagramInsertionEnabled)
          ).map(tool => toolButton(tool))}
          {tablePicker}
        </PaletteGroup>
        <PaletteGroup title="Documento">
          {documentActions}
          {sourceToggle}
          {zoomSelector}
          {historyActions}
        </PaletteGroup>
      </div>
    );
  }

  if (compactToolbar) {
    return (
      <div ref={toolbarRef} role="toolbar" aria-label="Herramientas del documento" data-menu-entry={menuEntry.current} onKeyDown={toolbarKey} onFocus={toolbarFocus} onClickCapture={menuActionFocus} className="neubiki-editor-toolbar neubiki-editor-toolbar-compact flex h-9 shrink-0 items-center gap-1 border-b border-line bg-white px-2">
        {blockSelect}

        <ToolbarIconButton
          tool={primaryInlineTools[0]}
          active={Boolean(activeActions[primaryInlineTools[0].action])}
          disabled={!editorReady}
          onMouseDown={keepEditorSelection}
          onRun={() => runAction(primaryInlineTools[0].action)}
        />
        <ToolbarIconButton
          tool={primaryInlineTools[1]}
          active={Boolean(activeActions[primaryInlineTools[1].action])}
          disabled={!editorReady}
          onMouseDown={keepEditorSelection}
          onRun={() => runAction(primaryInlineTools[1].action)}
        />
        <ToolbarMenuButton
          label="Más opciones"
          icon={MoreHorizontal}
          popup="dialog"
          disabled={false}
          expanded={compactOptionsOpen}
          onMouseDown={keepEditorSelection}
          onClick={openCompactOptions}
        />
        <MarkdownSourceToggleButton
          active={markdownSourceVisible}
          onMouseDown={keepEditorSelection}
          onToggle={onToggleMarkdownSource}
        />

        <ToolbarHistoryActions
          editorReady={editorReady}
          editorHistoryState={editorHistoryState}
          onMouseDown={keepEditorSelection}
          onRun={runAction}
        />

        {compactOptionsOpen && createPortal(
          <ModalFrame label="Formato del texto" onClose={() => setCompactOptionsOpen(false)} className="neubiki-editor-palette-modal">
            <MarkdownToolsPanel panelRef={compactPanelRef} onClose={() => setCompactOptionsOpen(false)}
              pin={pinControl && { pinned: pinControl.pinned, onChange: (value) => { setCompactOptionsOpen(false); pinControl.onChange(value); } }}>
              <MarkdownToolbar contextual
                historyOpen={historyOpen} historyEnabled={historyEnabled} historyDisabledReason={historyDisabledReason}
                editorReady={editorReady} extendedUnderlineEnabled={extendedUnderlineEnabled}
                markdownZoomPercent={markdownZoomPercent} markdownSourceVisible={markdownSourceVisible}
                activeActions={activeActions} editorHistoryState={editorHistoryState}
                imageInsertionEnabled={imageInsertionEnabled} diagramInsertionEnabled={diagramInsertionEnabled}
                documentActionsEnabled={documentActionsEnabled} onRunEditorAction={runAction}
                onExportDocument={(format) => runFromCompactPanel(() => onExportDocument(format))}
                onSaveTemplate={onSaveTemplate && (() => runFromCompactPanel(onSaveTemplate))}
                onMarkdownZoomChange={(zoom) => runFromCompactPanel(() => onMarkdownZoomChange(zoom))}
                onToggleMarkdownSource={() => runFromCompactPanel(() => onToggleMarkdownSource?.())}
                onToggleHistory={() => runFromCompactPanel(onToggleHistory)} />
            </MarkdownToolsPanel>
          </ModalFrame>, document.body
        )}
      </div>
    );
  }

  return (
    <div ref={toolbarRef} role="toolbar" aria-label="Herramientas del documento" data-menu-entry={menuEntry.current} onKeyDown={toolbarKey} onFocus={toolbarFocus} onClickCapture={menuActionFocus} className="neubiki-editor-toolbar flex h-9 shrink-0 items-center gap-1 border-b border-line bg-white px-3">
      {blockSelect}

      <ToolbarDivider />

      <ToolbarActionGroup>
        {primaryInlineTools.map((tool) => (
          <ToolbarIconButton
            key={tool.action}
            tool={tool}
            active={Boolean(activeActions[tool.action])}
            disabled={!editorReady}
            onMouseDown={keepEditorSelection}
            onRun={() => runAction(tool.action)}
          />
        ))}
        <div className="neubiki-toolbar-wide-group flex items-center gap-0.5">
          {visibleSecondaryInlineTools.map(tool => toolButton(tool))}
          {highlight}
        </div>
        <div className="neubiki-toolbar-compact-menu relative">
          <ToolbarMenuButton
            label="Formato"
            icon={MoreHorizontal}
            disabled={!editorReady}
            expanded={openMenu === "format"}
            onMouseDown={keepEditorSelection}
            onClick={(event) => toggleMenu("format", event)}
          />
          {openMenu === "format" ? (
            <ToolbarMenu align="left">
              {visibleSecondaryInlineTools.map((tool) => (
                <MenuAction
                  key={tool.action}
                  action={tool}
                  active={Boolean(activeActions[tool.action])}
                  onRun={() => runAction(tool.action)}
                />
              ))}
              {extendedUnderlineEnabled ? (
                <HighlightMenu
                  activeColor={activeActions.highlightColor ?? null}
                  onRun={runHighlight}
                  onClear={() => runAction("clear-highlight")}
                  compact
                />
              ) : null}
            </ToolbarMenu>
          ) : null}
        </div>
      </ToolbarActionGroup>

      <ToolbarDivider />

      <ToolbarActionGroup>
        <ToolbarIconButton
          tool={structureTools[0]}
          active={Boolean(activeActions[structureTools[0].action])}
          disabled={!editorReady}
          onMouseDown={keepEditorSelection}
          onRun={() => runAction(structureTools[0].action)}
        />
        <div className="neubiki-toolbar-wide-group flex items-center gap-0.5">
          {structureTools.slice(1).map((tool) => (
            <ToolbarIconButton
              key={tool.action}
              tool={tool}
              active={Boolean(activeActions[tool.action])}
              disabled={!editorReady}
              onMouseDown={keepEditorSelection}
              onRun={() => runAction(tool.action)}
            />
          ))}
        </div>
        <div className="neubiki-toolbar-compact-menu relative">
          <ToolbarMenuButton
            label="Estructura"
            icon={MoreHorizontal}
            disabled={!editorReady}
            expanded={openMenu === "structure"}
            onMouseDown={keepEditorSelection}
            onClick={(event) => toggleMenu("structure", event)}
          />
          {openMenu === "structure" ? (
            <ToolbarMenu align="left">
              {structureTools.slice(1).map((tool) => (
                <MenuAction
                  key={tool.action}
                  action={tool}
                  active={Boolean(activeActions[tool.action])}
                  onRun={() => runAction(tool.action)}
                />
              ))}
            </ToolbarMenu>
          ) : null}
        </div>
      </ToolbarActionGroup>

      <ToolbarDivider />

      <ToolbarActionGroup>
        <ToolbarIconButton
          tool={insertionTools[0]}
          active={Boolean(activeActions[insertionTools[0].action])}
          disabled={!editorReady}
          onMouseDown={keepEditorSelection}
          onRun={() => runAction(insertionTools[0].action)}
        />
        <div className="neubiki-toolbar-wide-group flex items-center gap-0.5">
          {imageInsertionEnabled ? (
            <ToolbarIconButton
              tool={insertionTools[1]}
              active={Boolean(activeActions[insertionTools[1].action])}
              disabled={!editorReady}
              onMouseDown={keepEditorSelection}
              onRun={() => runAction(insertionTools[1].action)}
            />
          ) : null}
          {diagramInsertionEnabled ? (
            <ToolbarIconButton
              tool={insertionTools[2]}
              active={Boolean(activeActions[insertionTools[2].action])}
              disabled={!editorReady}
              onMouseDown={keepEditorSelection}
              onRun={() => runAction(insertionTools[2].action)}
            />
          ) : null}
        </div>
        {tablePicker}
        <div className="neubiki-toolbar-compact-menu relative">
          <ToolbarMenuButton
            label="Insertar"
            icon={MoreHorizontal}
            disabled={!editorReady}
            expanded={openMenu === "insert"}
            onMouseDown={keepEditorSelection}
            onClick={(event) => toggleMenu("insert", event)}
          />
          {openMenu === "insert" ? (
            <ToolbarMenu align="right">
              {imageInsertionEnabled ? <MenuAction action={insertionTools[1]} active={false} onRun={() => runAction("image")} /> : null}
              {diagramInsertionEnabled ? <MenuAction action={insertionTools[2]} active={false} onRun={() => runAction("diagram")} /> : null}
              <MenuAction action={structureTools[5]} active={false} onRun={() => runAction("horizontal-rule")} />
            </ToolbarMenu>
          ) : null}
        </div>
        {documentActions}
      </ToolbarActionGroup>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {sourceToggle}
        {zoomSelector}
        {historyActions}
      </div>
    </div>
  );
}

function PaletteGroup({ title, end, children }: { title: string; end?: ReactNode; children: ReactNode }) {
  return (
    <section role="group" aria-label={title} className="neubiki-editor-palette-group">
      <div className="neubiki-editor-palette-group-heading">
        <h3>{title}</h3>
        {end}
      </div>
      <div className="neubiki-editor-palette-grid">{children}</div>
    </section>
  );
}

function BlockFormatSelect({
  currentBlockFormat,
  activeActions,
  editorReady,
  open,
  onMouseDown,
  onToggle,
  onRun,
}: {
  currentBlockFormat: { label: string };
  activeActions: MarkdownEditorFormatState;
  editorReady: boolean;
  open: boolean;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  onRun: (action: MarkdownEditorAction) => void;
}) {
  return (
    <div className="relative shrink-0">
      <button
        className={`toolbar-select ${editorReady ? "" : "opacity-40"}`}
        aria-label="Formato de bloque"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!editorReady}
        onMouseDown={onMouseDown}
        onClick={onToggle}
      >
        <span className="toolbar-select-label">{currentBlockFormat.label}</span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <ToolbarMenu align="left">
          {blockFormats.map((format) => (
            <BlockMenuAction
              key={format.action}
              action={format}
              active={Boolean(activeActions[format.action])}
              onRun={() => onRun(format.action)}
            />
          ))}
        </ToolbarMenu>
      ) : null}
    </div>
  );
}

function ToolbarHistoryActions({
  editorReady,
  editorHistoryState,
  onMouseDown,
  onRun,
}: {
  editorReady: boolean;
  editorHistoryState: MarkdownEditorHistoryState;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onRun: (action: MarkdownEditorAction) => void;
}) {
  return (
    <div className="neubiki-editor-history-actions ml-auto flex shrink-0 items-center gap-1">
      <span
        className="inline-grid rounded-md focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-brand-orange"
        data-tooltip={editorHistoryState.canUndo ? "Deshacer" : "No hay cambios para deshacer"}
        tabIndex={editorReady && editorHistoryState.canUndo ? -1 : 0}
      >
        <button
          className={`toolbar-button ${editorReady && editorHistoryState.canUndo ? "" : "pointer-events-none opacity-40"}`}
          aria-label="Deshacer"
          disabled={!editorReady || !editorHistoryState.canUndo}
          onMouseDown={onMouseDown}
          onClick={() => onRun("undo")}
        >
          <Undo2 size={15} />
        </button>
      </span>
      <span
        className="inline-grid rounded-md focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-brand-orange"
        data-tooltip={editorHistoryState.canRedo ? "Rehacer" : "No hay cambios para rehacer"}
        tabIndex={editorReady && editorHistoryState.canRedo ? -1 : 0}
      >
        <button
          className={`toolbar-button ${editorReady && editorHistoryState.canRedo ? "" : "pointer-events-none opacity-40"}`}
          aria-label="Rehacer"
          disabled={!editorReady || !editorHistoryState.canRedo}
          onMouseDown={onMouseDown}
          onClick={() => onRun("redo")}
        >
          <Redo2 size={15} />
        </button>
      </span>
    </div>
  );
}

function MarkdownSourceToggleButton({
  active,
  icon: Icon = Code2,
  onMouseDown,
  onToggle,
}: {
  active: boolean;
  icon?: LucideIcon;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggle?: () => void;
}) {
  const label = active ? "Mostrar vista visual" : "Mostrar Markdown puro";
  return (
    <button
      className={`toolbar-button ${active ? "toolbar-button-active" : ""}`}
      type="button"
      data-tooltip={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={onMouseDown}
      onClick={() => onToggle?.()}
    >
      <Icon size={15} />
    </button>
  );
}

function HighlightToolbarButton({
  activeColor,
  disabled,
  expanded,
  onMouseDown,
  onToggle,
}: {
  activeColor: MarkdownHighlightColorId | null;
  disabled: boolean;
  expanded: boolean;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const color = markdownHighlightColors.find((item) => item.id === activeColor);
  return (
    <button
      className={`toolbar-button ${activeColor || expanded ? "toolbar-button-active" : ""} ${disabled ? "opacity-40" : ""}`}
      data-tooltip="Resaltado"
      aria-label="Resaltado"
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-pressed={Boolean(activeColor)}
      disabled={disabled}
      onMouseDown={onMouseDown}
      onClick={onToggle}
    >
      <span className="relative grid h-[15px] w-[15px] place-items-center">
        <Highlighter size={15} />
        <span
          className="absolute -bottom-0.5 h-1.5 w-3 rounded-full border border-white"
          style={{ backgroundColor: color?.background ?? "transparent" }}
          aria-hidden="true"
        />
      </span>
    </button>
  );
}

function HighlightMenu({
  activeColor,
  onRun,
  onClear,
  compact = false,
}: {
  activeColor: MarkdownHighlightColorId | null;
  onRun: (color: MarkdownHighlightColorId) => void;
  onClear: () => void;
  compact?: boolean;
}) {
  const content = (
    <>
      <div className="grid grid-cols-5 gap-1 p-1" role="group" aria-label="Colores de resaltado">
        {markdownHighlightColors.map((color) => (
          <button
            key={color.id}
            className={`h-7 w-7 rounded-md border ${activeColor === color.id ? "ring-2 ring-brand-orange ring-offset-1" : ""}`}
            style={{ backgroundColor: color.background, borderColor: color.border }}
            type="button"
            role="menuitem"
            aria-label={`Resaltar en ${color.label}`}
            aria-pressed={activeColor === color.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRun(color.id)}
          />
        ))}
      </div>
      <button
        className="mt-1 flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-ink-primary hover:bg-brand-hover"
        role="menuitem"
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClear}
      >
        <X size={14} />
        <span className="min-w-0 flex-1 truncate">Quitar resaltado</span>
      </button>
    </>
  );

  if (compact) return <div className="border-t border-line pt-1">{content}</div>;
  return <ToolbarMenu align="left">{content}</ToolbarMenu>;
}

function ExportMenuAction({ label, format, onRun }: { label: string; format: ExportFormat; onRun: (format: ExportFormat) => void }) {
  return (
    <button
      className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-ink-primary hover:bg-brand-hover"
      role="menuitem"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onRun(format)}
    >
      <Download size={14} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function ToolbarActionGroup({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 shrink-0 items-center gap-0.5">{children}</div>;
}

function ToolbarDivider() {
  return <span className="neubiki-toolbar-divider mx-1 h-5 shrink-0 border-l border-line" />;
}

function ToolbarIconButton({
  tool,
  active,
  disabled,
  onMouseDown,
  onRun,
}: {
  tool: ToolbarAction;
  active: boolean;
  disabled: boolean;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onRun: () => void;
}) {
  return (
    <button
      className={`toolbar-button ${active ? "toolbar-button-active" : ""} ${disabled ? "opacity-40" : ""}`}
      data-tooltip={tool.label}
      aria-label={tool.label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={onMouseDown}
      onClick={onRun}
    >
      <tool.icon size={15} />
    </button>
  );
}

function ToolbarMenuButton({
  label,
  icon: Icon,
  popup = "menu",
  disabled,
  expanded,
  onMouseDown,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  popup?: "menu" | "dialog";
  disabled: boolean;
  expanded: boolean;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      className={`toolbar-button ${expanded ? "toolbar-button-active" : ""} ${disabled ? "opacity-40" : ""}`}
      data-tooltip={label}
      aria-label={label}
      aria-haspopup={popup}
      aria-expanded={expanded}
      disabled={disabled}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <Icon size={15} />
    </button>
  );
}

function visibleControl(node:HTMLElement){for(let current:HTMLElement|null=node;current;current=current.parentElement){const style=getComputedStyle(current);if(current.hidden||current.inert||style.display==="none"||style.visibility==="hidden")return false;}return true;}
/** Mouse activation keeps Milkdown's selection; keyboard activation owns menu focus. */
function useToolbarMenuNavigation(){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current;
    const panel = menu?.closest<HTMLElement>(".neubiki-editor-palette");
    if (!menu || !panel) return;
    const trigger = menu.parentElement?.querySelector("button");
    const scrollBody = panel.querySelector(".neubiki-editor-palette-scroll");
    function place() {
      if (!menu || !trigger) return;
      const view = editorToolsViewport();
      const anchor = trigger.getBoundingClientRect();
      const left = view.left + 8;
      const right = view.left + view.width - 8;
      const top = view.top + 8;
      const bottom = view.top + view.height - 8;
      const belowStart = Math.max(top, Math.min(anchor.bottom + 4, bottom));
      const aboveEnd = Math.max(top, Math.min(anchor.top - 4, bottom));
      const below = bottom - belowStart;
      const above = aboveEnd - top;
      menu.style.position = "fixed";
      menu.style.right = "auto";
      menu.style.maxWidth = `${Math.max(0, right - left)}px`;
      const placeBelow = menu.scrollHeight <= below || below >= above;
      menu.style.maxHeight = `${Math.max(0, placeBelow ? below : above)}px`;
      menu.style.overflowY = "auto";
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(left, Math.min(anchor.left, right - bounds.width))}px`;
      menu.style.top = `${placeBelow ? belowStart : aboveEnd - bounds.height}px`;
    }
    // The panel's layout effect places the parent after the child mounts.
    let frame = requestAnimationFrame(place);
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    }
    const stop = observeEditorToolsViewport(schedule);
    scrollBody?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      stop();
      scrollBody?.removeEventListener("scroll", schedule);
    };
  }, []);
  const buttons=()=>[...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[])].filter(visibleControl);
  function tabStop(target:HTMLButtonElement){for(const b of buttons())b.tabIndex=b===target?0:-1;}
  useEffect(()=>{const items=buttons(),entry=ref.current?.closest<HTMLElement>('[role="toolbar"]')?.dataset.menuEntry;if(!items.length)return;const target=entry==="last"?items[items.length-1]:items[0];tabStop(target);if(entry&&entry!=="pointer")target.focus();},[]);
  function onKeyDown(event:ReactKeyboardEvent<HTMLDivElement>){if(event.nativeEvent.isComposing||!["ArrowDown","ArrowUp","ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;const items=buttons();if(!items.length)return;event.preventDefault();event.stopPropagation();const current=items.indexOf(document.activeElement as HTMLButtonElement),next=event.key==="Home"?0:event.key==="End"?items.length-1:(Math.max(current,0)+(["ArrowDown","ArrowRight"].includes(event.key)?1:-1)+items.length)%items.length;tabStop(items[next]);items[next].focus();}
  function onFocus(event:ReactFocusEvent<HTMLDivElement>){const target:EventTarget=event.target;if(target instanceof HTMLButtonElement&&buttons().includes(target))tabStop(target);}
  return{ref,onKeyDown,onFocus};
}
function ToolbarMenu({ children, align }: { children: ReactNode; align: "left" | "right" }) {
  const navigation=useToolbarMenuNavigation();
  return (
    <div
      className={[
        "absolute top-8 z-[90] min-w-[178px] rounded-md border border-line bg-white p-1 shadow-menu",
        align === "right" ? "right-0" : "left-0",
      ].join(" ")}
      role="menu"
      ref={navigation.ref}
      onKeyDown={navigation.onKeyDown}
      onFocus={navigation.onFocus}
    >
      {children}
    </div>
  );
}

function MenuAction({
  action,
  active,
  onRun,
}: {
  action: { label: string; compactLabel?: string; icon: LucideIcon };
  active: boolean;
  onRun: () => void;
}) {
  return (
    <button
      className={`flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-brand-hover ${active ? "bg-brand-hover text-brand-orange" : "text-ink-primary"}`}
      role="menuitem"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      <action.icon size={14} />
      <span className="min-w-0 flex-1 truncate">{action.compactLabel ?? action.label}</span>
    </button>
  );
}

function BlockMenuAction({
  action,
  active,
  onRun,
}: {
  action: { label: string };
  active: boolean;
  onRun: () => void;
}) {
  return (
    <button
      className={`flex h-8 w-full items-center rounded px-2 text-left text-[11px] hover:bg-brand-hover ${active ? "bg-brand-hover font-semibold text-brand-orange" : "text-ink-primary"}`}
      role="menuitem"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      <span className="min-w-0 flex-1 truncate">{action.label}</span>
    </button>
  );
}

function ZoomMenuAction({
  zoomPercent,
  active,
  onRun,
}: {
  zoomPercent: number;
  active: boolean;
  onRun: () => void;
}) {
  return (
    <button
      className={`flex h-8 w-full items-center rounded px-2 text-left text-[11px] hover:bg-brand-hover ${active ? "bg-brand-hover font-semibold text-brand-orange" : "text-ink-primary"}`}
      role="menuitem"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      <span className="min-w-0 flex-1 truncate">{zoomPercent}%</span>
    </button>
  );
}

function useCompactToolbarMode() {
  const [compact, setCompact] = useState(() => (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 760px)").matches
      : false
  ));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  return compact;
}

function TablePicker({
  rows,
  columns,
  onHover,
  onInsert,
}: {
  rows: number;
  columns: number;
  onHover: (size: { rows: number; columns: number }) => void;
  onInsert: (rows: number, columns: number) => void;
}) {
  const navigation=useToolbarMenuNavigation();
  const grid = Array.from({ length: 5 }, (_, rowIndex) =>
    Array.from({ length: 5 }, (_, columnIndex) => ({ row: rowIndex + 1, column: columnIndex + 1 })),
  );

  return (
    <div ref={navigation.ref} role="menu" aria-label="Insertar tabla" onKeyDown={navigation.onKeyDown} onFocus={navigation.onFocus} className="absolute left-0 top-8 z-[90] w-[172px] rounded-md border border-line bg-white p-3 shadow-menu">
      <div className="grid grid-cols-5 gap-1">
        {grid.flat().map((cell) => {
          const selected = cell.row <= rows && cell.column <= columns;
          return (
            <button
              key={`${cell.row}-${cell.column}`}
              className={`h-6 w-6 rounded border ${selected ? "border-brand-orange bg-brand-hover" : "border-line bg-white hover:bg-panel"}`}
              aria-label={`Insertar tabla ${cell.row} x ${cell.column}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover({ rows: cell.row, columns: cell.column })}
              onFocus={() => onHover({ rows: cell.row, columns: cell.column })}
              onClick={() => onInsert(cell.row, cell.column)}
            />
          );
        })}
      </div>
      <p className="mt-2 text-center font-mono text-[10px] font-semibold text-ink-secondary">
        {rows} x {columns}
      </p>
      <button
        className="mt-2 h-7 w-full rounded border border-line text-[10px] font-semibold text-ink-secondary hover:bg-brand-hover hover:text-brand-orange"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onInsert(rows, columns)}
      >
        Insertar tabla
      </button>
      <button
        className="mt-1 h-7 w-full rounded text-[10px] font-semibold text-ink-secondary hover:bg-panel hover:text-ink-primary"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const customRows = Number(window.prompt("Filas", String(rows)));
          const customColumns = Number(window.prompt("Columnas", String(columns)));
          if (!customRows || !customColumns) return;
          onInsert(customRows, customColumns);
        }}
      >
        Personalizar...
      </button>
    </div>
  );
}
