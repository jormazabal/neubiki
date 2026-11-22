import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { ChevronLeft, ChevronRight, RefreshCw, Search, ZoomIn, ZoomOut } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { Button } from "../../components/ui/Button";
import { readProtonOfficePreview, type ProtonOfficePreview, type WorkbookReference } from "../../lib/api/protonOffice";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonExplorationCopy } from "./protonExplorationCopy";
import { protonReferenceFormat } from "./protonReferenceFormat";

const PdfSurface = lazy(() => import("../documentPreview/PdfPreviewSurface")
  .then(module => ({ default: module.PdfPreviewSurface })));
const MediaPreview = lazy(() => import("./ProtonMediaPreview").then(module => ({ default: module.ProtonMediaPreview })));

type Props = {
  name: string;
  contentBase64: string | null;
  address?: ProtonDocumentKey;
  revisionId?: string;
  onReload: () => void;
  busy?: boolean;
  searchJump?: { query: string; revisionId?: string | null; pageNumber?: number | null; pageId?: string | null; sheetId?: string | null; row?: number | null; column?: number | null } | null;
};

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_PDF_BYTES = 12 * MAX_TEXT_BYTES;

function decodeContent(content: string, maxBytes: number) {
  if (content.length > Math.ceil(maxBytes / 3) * 4) throw new Error("El archivo supera el tamaño admitido.");
  const binary = atob(content);
  if (binary.length > maxBytes) throw new Error("El archivo supera el tamaño admitido.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function ProtonReferenceViewer(props: Props) {
  const t = protonExplorationCopy[useUiLocale()];
  const format = protonReferenceFormat(props.name);
  const jump = props.searchJump?.revisionId === props.revisionId ? props.searchJump : null;
  const currentProps = { ...props, searchJump: jump };
  return <section aria-label={t.previewNamed(props.name)} className="flex h-full min-h-0 min-w-0 flex-col">
    {(format === "docx" || format === "xlsx") && props.address && props.revisionId
      ? <OfficeReference key={JSON.stringify([props.address, props.revisionId])}
        address={props.address} revisionId={props.revisionId} onReload={props.onReload} busy={props.busy} searchJump={jump} />
      : props.contentBase64 === null || format === null ? <InlineNotice tone="warning">{t.previewUnavailable}</InlineNotice>
      : format === "audio" || format === "video" ? <Suspense fallback={<p role="status">{t.loadingPlayer}</p>}>
        <MediaPreview name={props.name} contentBase64={props.contentBase64} busy={props.busy} onReload={props.onReload} />
      </Suspense>
      : format === "pdf" ? <PdfReference {...currentProps} contentBase64={props.contentBase64} />
      : <TextReference {...currentProps} contentBase64={props.contentBase64} />}
  </section>;
}

type FileProps = Omit<Props, "contentBase64"> & { contentBase64: string };

function PdfReference({ contentBase64, onReload, busy, searchJump }: FileProps) {
  const t = protonExplorationCopy[useUiLocale()];
  const [file, setFile] = useState<{ source: string; url: string | null }>();
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [navigation, setNavigation] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [fit, setFit] = useState<"width" | "page" | null>("page");
  const [query, setQuery] = useState("");
  const [searchCount, setSearchCount] = useState<number | null>(null);
  useEffect(() => {
    if (!searchJump || !pageCount) return;
    setQuery(searchJump.query);
    setPage(Math.max(1, Math.min(searchJump.pageNumber ?? 1, pageCount)));
    setNavigation(value => value + 1);
  }, [searchJump, pageCount]);

  useEffect(() => {
    let url: string | null = null;
    try {
      const bytes = decodeContent(contentBase64, MAX_PDF_BYTES);
      if (new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-")) {
        url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      }
    } catch { /* A failure is rendered below for this exact source. */ }
    setFile({ source: contentBase64, url });
    setPage(1);
    setPageCount(null);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [contentBase64]);

  const current = file?.source === contentBase64 ? file : undefined;
  const onPageCountChange = useCallback((count: number | null) => {
    setPageCount(count);
    if (count !== null) setPage(value => Math.min(value, count));
  }, []);

  function goTo(value: number) {
    setPage(value);
    setNavigation(sequence => sequence + 1);
  }
  function changeZoom(delta: number) {
    setFit(null);
    setZoom(value => Math.max(50, Math.min(220, value + delta)));
  }

  return <>
    <div aria-label={t.pdfTools} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <div aria-label={t.pages} role="group" className="flex items-center gap-1">
        <Button size="icon" variant="quiet" aria-label={t.previousPage} disabled={!pageCount || page <= 1} onClick={() => goTo(page - 1)}><ChevronLeft size={18} /></Button>
        <span aria-live="polite" className="whitespace-nowrap text-sm">{pageCount ? `${page} / ${pageCount}` : "—"}</span>
        <Button size="icon" variant="quiet" aria-label={t.nextPage} disabled={!pageCount || page >= pageCount} onClick={() => goTo(page + 1)}><ChevronRight size={18} /></Button>
      </div>
      <div aria-label="Zoom" role="group" className="flex items-center gap-1">
        <Button size="icon" variant="quiet" aria-label={t.zoomOut} disabled={!pageCount || (fit === null && zoom <= 50)} onClick={() => changeZoom(-10)}><ZoomOut size={16} /></Button>
        <Button size="compact" variant="quiet" aria-label={t.fitToggle} disabled={!pageCount}
          onClick={() => setFit(value => value === "page" ? "width" : "page")}>
          {fit === "page" ? t.fitPage : fit === "width" ? t.fitWidth : `${zoom} %`}
        </Button>
        <Button size="icon" variant="quiet" aria-label={t.zoomIn} disabled={!pageCount || (fit === null && zoom >= 220)} onClick={() => changeZoom(10)}><ZoomIn size={16} /></Button>
      </div>
      <ReferenceSearch label={t.searchPage} query={query} onQuery={setQuery} disabled={!pageCount}
        result={query.trim() && searchCount !== null ? t.matchCount(searchCount) : ""} />
      <Reload onReload={onReload} busy={busy} />
    </div>
    <div className="min-h-0 flex-1">
      {!current ? <p role="status" className="p-4 text-sm">{t.pdfPreparing}</p>
        : !current.url ? <InlineNotice tone="error">{t.pdfOpenFailed}</InlineNotice>
        : <Suspense fallback={<p role="status" className="p-4 text-sm">{t.pdfLoading}</p>}>
          <PdfSurface url={current.url} query={query} zoomPercent={zoom} fitMode={fit} pageNumber={page}
            navigationSequence={navigation} onPageChange={setPage} onPageCountChange={onPageCountChange}
            onSearchCountChange={setSearchCount} singlePage />
        </Suspense>}
    </div>
  </>;
}

function TextReference({ contentBase64, onReload, busy, searchJump }: FileProps) {
  const content = useMemo(() => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(decodeContent(contentBase64, MAX_TEXT_BYTES)); }
    catch { return null; }
  }, [contentBase64]);
  return <SearchableText content={content} onReload={onReload} busy={busy} searchJump={searchJump} />;
}

function SearchableText({ content, onReload, busy, description, searchJump }: Pick<Props, "onReload" | "busy" | "searchJump"> & {
  content: string | null; description?: string;
}) {
  const t = protonExplorationCopy[useUiLocale()];
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const activeMatch = useRef<HTMLElement>(null);
  useEffect(() => {
    if (searchJump) { setQuery(searchJump.query); setSelected(0); }
  }, [searchJump]);
  const { matches, partial } = useMemo(() => {
    const matches: { start: number; end: number }[] = [];
    if (content === null || !query.trim()) return { matches, partial: false };
    const search = new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    for (const match of content.matchAll(search)) {
      if (matches.length >= 500) return { matches, partial: true };
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
    return { matches, partial: false };
  }, [content, query]);

  useEffect(() => { activeMatch.current?.scrollIntoView?.({ block: "nearest" }); }, [selected, matches]);

  return <>
    <div aria-label={t.textTools} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <ReferenceSearch label={t.textSearch} query={query} onQuery={value => { setQuery(value); setSelected(0); }}
        disabled={content === null} result={query.trim() ? t.matchCount(matches.length, partial) : ""} />
      <div role="group" aria-label={t.matchGroup} className="flex items-center">
        <Button size="icon" variant="quiet" aria-label={t.previousMatch} disabled={selected <= 0}
          onClick={() => setSelected(value => value - 1)}><ChevronLeft size={18} /></Button>
        <Button size="icon" variant="quiet" aria-label={t.nextMatch} disabled={selected + 1 >= matches.length}
          onClick={() => setSelected(value => value + 1)}><ChevronRight size={18} /></Button>
      </div>
      <Reload onReload={onReload} busy={busy} />
    </div>
    {description && <p className="px-4 pt-2 text-xs text-ink-secondary">{description}</p>}
    {content === null ? <InlineNotice tone="error">{t.textError}</InlineNotice>
      : content.length === 0 ? <p className="p-4 text-sm text-ink-secondary">{t.textEmpty}</p>
      : <pre tabIndex={0} aria-label={t.textContent} className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-sm">
        {matches.map((match, index) => <span key={match.start}>
          {content.slice(index === 0 ? 0 : matches[index - 1].end, match.start)}
          <mark ref={index === selected ? activeMatch : undefined}
            className={`bg-brand-hover text-ink-primary ${index === selected ? "font-bold underline" : ""}`}>
            {content.slice(match.start, match.end)}
          </mark>
        </span>)}
        {content.slice(matches[matches.length - 1]?.end ?? 0)}
      </pre>}
  </>;
}

function OfficeReference({ address, revisionId, onReload, busy, searchJump }: Pick<Props, "onReload" | "busy" | "searchJump"> & {
  address: ProtonDocumentKey; revisionId: string;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const t = protonExplorationCopy[useUiLocale()];
  const { accountId, rootId, nodeId } = address;
  const [sheetId, setSheetId] = useState<string | undefined>(searchJump?.sheetId ?? undefined);
  const [position, setPosition] = useState<{ row: number; column: number } | undefined>(() => searchJump?.row && searchJump.column ? { row: searchJump.row, column: searchJump.column } : undefined);
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<ProtonOfficePreview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!searchJump?.sheetId) return;
    setSheetId(searchJump.sheetId);
    setPosition(searchJump.row && searchJump.column ? { row: searchJump.row, column: searchJump.column } : undefined);
  }, [searchJump]);

  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError("");
    void readProtonOfficePreview({ accountId, rootId, nodeId }, revisionId, sheetId, request.signal, position)
      .then(value => {
        if (request.signal.aborted) return;
        if (value.revisionId !== revisionId) { setPreview(undefined); setError(t.officeChanged); }
        else setPreview(value);
        setLoading(false);
      }, cause => {
        if (request.signal.aborted) return;
        setError(runtimeErrorMessage(cause, t.officeFailed));
        setLoading(false);
      });
    return () => request.abort();
  }, [accountId, rootId, nodeId, revisionId, sheetId, position, refresh]);

  return <>
    {error && <InlineNotice tone="error" announce="alert"
      action={<Button onClick={() => setRefresh(value => value + 1)} disabled={busy || loading}>{t.retry}</Button>}>{error}</InlineNotice>}
    {loading && <p role="status" className="p-4 text-sm">{t.officePreparing}</p>}
    {!preview && !loading && <div className="px-3 py-2"><Reload onReload={onReload} busy={busy} /></div>}
    {preview?.format === "docx" && <SearchableText content={preview.text} onReload={onReload} busy={busy || loading}
      searchJump={searchJump}
      description={t.wordDescription} />}
    {preview?.format === "xlsx" && <SpreadsheetReference workbook={preview.workbook} onSheet={id => { setSheetId(id); setPosition(undefined); }}
      onReload={onReload} busy={busy || loading} searchJump={searchJump} />}
  </>;
}

function SpreadsheetReference({ workbook, onSheet, onReload, busy, searchJump }: Pick<Props, "onReload" | "busy" | "searchJump"> & {
  workbook: WorkbookReference; onSheet: (id: string) => void;
}) {
  const t = protonExplorationCopy[useUiLocale()];
  const cells = useMemo(() => new Map(workbook.cells.map(cell => [`${cell.row}:${cell.column}`, cell.value])), [workbook.cells]);
  const columns = Array.from({ length: workbook.columnCount }, (_, index) => index + (workbook.columnStart ?? 1));
  const rows = Array.from({ length: workbook.rowCount }, (_, index) => index + (workbook.rowStart ?? 1));
  const target = useRef<HTMLTableCellElement>(null);
  useEffect(() => { target.current?.scrollIntoView?.({ block: "center", inline: "center" }); target.current?.focus({ preventScroll: true }); }, [workbook, searchJump]);
  const title = workbook.sheets.find(sheet => sheet.id === workbook.sheetId)?.name;
  const query = searchJump?.query.trim().toLocaleLowerCase() ?? "";
  const matchingCells = query ? workbook.cells.filter(cell => cell.value.toLocaleLowerCase().includes(query)).length : 0;
  return <>
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        {t.sheet}
        <select className="ui-field min-w-0 flex-1" value={workbook.sheetId} disabled={busy}
          onChange={event => onSheet(event.target.value)}>
          {workbook.sheets.map(sheet => <option key={sheet.id} value={sheet.id}>
            {sheet.name}{sheet.hidden ? t.hiddenSheet : ""}
          </option>)}
        </select>
      </label>
      <Reload onReload={onReload} busy={busy} />
    </div>
    {workbook.partial && <InlineNotice tone="warning">{t.partialSheet}</InlineNotice>}
    {searchJump?.sheetId === workbook.sheetId && searchJump.row && searchJump.column && <p role="status" className="px-3 py-2 text-xs text-ink-secondary">{t.cellResult(title, `${workbookColumnLabel(searchJump.column)}${searchJump.row}`)}</p>}
    {query && <p role="status" className="px-3 py-2 text-xs text-ink-secondary">{matchingCells
      ? t.visibleCellMatches(matchingCells)
      : t.sheetMatchMissing}</p>}
    {rows.length === 0 || columns.length === 0
      ? <p className="p-4 text-sm text-ink-secondary">{workbook.partial ? t.noVisibleCells : t.emptySheet}</p>
      : <div className="min-h-0 flex-1 overflow-auto p-3" tabIndex={0} aria-label={t.tableNamed(title)}>
        <table className="border-collapse text-sm">
          <caption className="sr-only">{title}</caption>
          <thead><tr><th scope="col" className="border border-line bg-panel px-2 py-1"><span className="sr-only">{t.row}</span></th>
            {columns.map(column => <th scope="col" key={column} className="border border-line bg-panel px-2 py-1">{workbookColumnLabel(column)}</th>)}
          </tr></thead>
          <tbody>{rows.map(row => <tr key={row}>
            <th scope="row" className="border border-line bg-panel px-2 py-1">{row}</th>
            {columns.map(column => <td key={column}
              ref={searchJump?.sheetId === workbook.sheetId && searchJump.row === row && searchJump.column === column ? target : undefined}
              tabIndex={searchJump?.sheetId === workbook.sheetId && searchJump.row === row && searchJump.column === column ? -1 : undefined}
              className={`min-w-16 max-w-72 whitespace-pre-wrap break-words border border-line px-2 py-1 ${searchJump?.sheetId === workbook.sheetId && searchJump.row === row && searchJump.column === column ? "bg-brand-hover outline outline-2 outline-brand" : ""}`}>
              {query && cells.get(`${row}:${column}`)?.toLocaleLowerCase().includes(query)
                ? <mark className="bg-brand-hover text-ink-primary">{cells.get(`${row}:${column}`)}</mark>
                : cells.get(`${row}:${column}`) ?? ""}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>}
  </>;
}

export function workbookColumnLabel(column: number) {
  let label = "";
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label;
  return label;
}

function ReferenceSearch({ label, query, onQuery, disabled, result }: {
  label: string; query: string; onQuery: (value: string) => void; disabled: boolean; result: string;
}) {
  return <label className="flex min-w-0 flex-1 items-center gap-2">
    <Search size={16} aria-hidden="true" className="shrink-0" />
    <input aria-label={label} placeholder={label} type="search" maxLength={256} disabled={disabled}
      className="ui-field min-w-0 flex-1" value={query} onChange={event => onQuery(event.target.value)} />
    {result && <span role="status" className="shrink-0 text-xs">{result}</span>}
  </label>;
}

function Reload({ onReload, busy }: Pick<Props, "onReload" | "busy">) {
  const t = protonExplorationCopy[useUiLocale()];
  return <Button size="icon" variant="quiet" aria-label={t.reloadProton} disabled={busy} onClick={onReload}><RefreshCw size={16} /></Button>;
}
