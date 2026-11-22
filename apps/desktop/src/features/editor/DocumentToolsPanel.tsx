import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import type { MarkdownEditorController } from "./editorTypes";
import { useSessionDraft, useSessionValue } from "../../app/useSessionDraft";
import { DOCUMENT_QUERY_LIMIT, type DocumentFindOptions } from "./documentTools";

const defaultFindOptions: DocumentFindOptions = { caseSensitive: false, wholeWord: false };

export function DocumentToolsPanel({ controller, revision, scope, name, onRevealMatch }: {
  controller: MarkdownEditorController | null; revision: string; scope: string; name: string;
  onRevealMatch?: () => void;
}) {
  const [query, setQuery] = useSessionDraft(scope);
  const [replacement, setReplacement] = useSessionDraft(scope);
  const [options, setOptions] = useSessionValue(scope, defaultFindOptions);
  const searchHelpId = useId();
  const searchField = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(-1);
  const [notice, setNotice] = useState<{text:string;markdown?:string}|null>(null);
  const headings = useMemo(() => controller?.getHeadings?.() ?? [], [controller, revision]);
  const matches = useMemo(() => controller?.findText?.(query, options) ?? [], [controller, query, revision, options]);
  useEffect(() => { setIndex(-1); setNotice(null); }, [query, scope, options]);
  useEffect(() => { setIndex(-1); }, [revision]);
  const navigate = (next: number) => {
    if (!matches.length) return;
    const target = (next + matches.length) % matches.length;
    const control = document.activeElement;
    setIndex(target);
    controller?.navigateTo?.(matches[target].from, matches[target].to);
    if (control instanceof HTMLElement && control.closest(".document-tools-panel")) control.focus({ preventScroll: true });
  };
  const replace = (all: boolean) => {
    const count = controller?.replaceText?.(query, replacement, all, Math.max(0, index), options) ?? 0;
    setNotice({text:count ? `${count === 1 ? "1 coincidencia reemplazada" : `${count} coincidencias reemplazadas`}. Puedes deshacer desde el editor.` : "No se aplicaron cambios. Revisa las coincidencias actuales.",markdown:controller?.getMarkdownSnapshot?.()});
    setIndex(-1);
  };
  return <div className="document-tools-panel">
    <p className="text-xs text-ink-secondary">Solo en {name}</p>
    <div className="document-search-field">
      <label htmlFor={`${searchHelpId}-field`}>Buscar en el documento</label>
      <div className="document-search-input">
        <Search size={16} aria-hidden="true" />
        <input id={`${searchHelpId}-field`} ref={searchField} className="ui-field" value={query}
          onChange={event => setQuery(event.target.value)} type="search" maxLength={DOCUMENT_QUERY_LIMIT} disabled={!controller}
          aria-describedby={searchHelpId} onKeyDown={event => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing || !matches.length) return;
            event.preventDefault();
            navigate(event.shiftKey ? index < 0 ? matches.length - 1 : index - 1 : index + 1);
          }} />
        {query && <Button size="icon" variant="quiet" aria-label="Limpiar búsqueda" onClick={() => {
          setQuery("");
          searchField.current?.focus();
        }}><X size={16} aria-hidden="true" /></Button>}
      </div>
    </div>
    <p id={searchHelpId} className="text-xs text-ink-secondary">Texto literal · Hasta {DOCUMENT_QUERY_LIMIT} caracteres</p>
    <div className="document-search-options">
      <label><input type="checkbox" checked={!!options.caseSensitive} onChange={event => setOptions(current => ({...current,caseSensitive:event.target.checked}))}/>Distinguir mayúsculas</label>
      <label><input type="checkbox" checked={!!options.wholeWord} onChange={event => setOptions(current => ({...current,wholeWord:event.target.checked}))}/>Palabra completa</label>
    </div>
    <p role="status" className={query && !matches.length ? "rounded-xl bg-panel px-3 py-2" : "text-ink-secondary"}
      aria-live="polite">{notice && (notice.markdown === undefined || notice.markdown === revision) ? notice.text : (query ? `${matches.length > 1000 ? "Más de 1000 coincidencias" : matches.length === 1 ? "1 coincidencia" : `${matches.length} coincidencias`}${index >= 0 && index < matches.length ? ` · ${index+1} de ${matches.length}` : ""}` : "Escribe para buscar en el contenido")}</p>
    <div className="flex flex-wrap gap-2">
      <Button size="compact" disabled={!matches.length} onClick={() => navigate(index < 0 ? matches.length - 1 : index - 1)}>
        <ArrowUp size={15} aria-hidden="true" /> Anterior
      </Button>
      <Button size="compact" disabled={!matches.length} onClick={() => navigate(index + 1)}>
        <ArrowDown size={15} aria-hidden="true" /> Siguiente
      </Button>
      {onRevealMatch && <Button size="compact" variant="quiet" disabled={!matches.length} onClick={() => {
        navigate(Math.max(0, index));
        onRevealMatch();
      }}>Ver en el documento</Button>}
    </div>
    <details><summary>Reemplazar texto</summary>
      <label>Reemplazar por<input className="ui-field" value={replacement} onChange={event => setReplacement(event.target.value)}/></label>
      <p>Se aplicará solo a {name}, con los filtros elegidos. Revisa las coincidencias antes de reemplazar.</p>
      {matches.length > 1000 && <p>Acota la búsqueda para reemplazar hasta 1000 coincidencias de forma revisable.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="compact" disabled={!matches.length || matches.length > 1000} onClick={() => replace(false)}>Reemplazar una</Button>
        <Button size="compact" disabled={!matches.length || matches.length > 1000} onClick={() => replace(true)}>Reemplazar todas</Button>
      </div>
    </details>
    <nav aria-label="Secciones del documento"><h3>Secciones</h3>{headings.length ? headings.map(heading => <button key={heading.position} style={{ paddingLeft: (heading.level - 1) * 12 + 8 }} onClick={() => controller?.navigateTo?.(heading.position)}>{heading.text || "Sin título"}</button>) : <p>No hay títulos en este documento.</p>}</nav>
  </div>;
}
