import { useUiLocale } from "../../lib/i18n/UiLocale";

const toolbarCopy = {
  es: {
    toolbar: "Herramientas del documento", text: "Texto", blocks: "Bloques e inserción", document: "Documento",
    format: "Formato", structure: "Estructura", insert: "Insertar", more: "Más opciones", block: "Formato de bloque",
    palette: "Formato del texto", close: "Cerrar formato del texto", pin: "Fijar barra de formato", unpin: "Ocultar barra de formato",
    history: "Histórico de versiones", export: "Exportar documento", template: "Guardar como plantilla…", zoom: "Zoom del visualizador Markdown",
    undo: "Deshacer", noUndo: "No hay cambios para deshacer", redo: "Rehacer", noRedo: "No hay cambios para rehacer",
    visual: "Mostrar vista visual", source: "Mostrar Markdown puro", normal: "Normal", heading: (level: number) => `Título ${level}`,
    bold: "Negrita", italic: "Cursiva", strike: "Tachado", underline: "Subrayado", underlineHtml: "Subrayado HTML",
    inlineCode: "Código inline", clear: "Borrar formato", bullets: "Lista con viñetas", shortBullets: "Viñetas",
    ordered: "Lista numerada", shortOrdered: "Numerada", checklist: "Checklist", quote: "Cita", code: "Bloque de código",
    rule: "Separador horizontal", shortRule: "Separador", link: "Enlace", image: "Imagen", diagram: "Diagrama", table: "Tabla",
    highlight: "Resaltado", colors: "Colores de resaltado", highlightColor: (color: string) => `Resaltar en ${color}`,
    clearHighlight: "Quitar resaltado", color: { yellow: "Amarillo", green: "Verde", blue: "Azul", pink: "Rosa", orange: "Naranja" },
    insertTable: "Insertar tabla", insertTableSize: (rows: number, columns: number) => `Insertar tabla ${rows} x ${columns}`,
    rows: "Filas", columns: "Columnas", custom: "Personalizar...",
  },
  en: {
    toolbar: "Document tools", text: "Text", blocks: "Blocks and inserts", document: "Document",
    format: "Formatting", structure: "Structure", insert: "Insert", more: "More options", block: "Block format",
    palette: "Text formatting", close: "Close text formatting", pin: "Pin formatting toolbar", unpin: "Hide formatting toolbar",
    history: "Version history", export: "Export document", template: "Save as template…", zoom: "Markdown zoom",
    undo: "Undo", noUndo: "No changes to undo", redo: "Redo", noRedo: "No changes to redo",
    visual: "Show visual editor", source: "Show Markdown source", normal: "Normal", heading: (level: number) => `Heading ${level}`,
    bold: "Bold", italic: "Italic", strike: "Strikethrough", underline: "Underline", underlineHtml: "HTML underline",
    inlineCode: "Inline code", clear: "Clear formatting", bullets: "Bulleted list", shortBullets: "Bullets",
    ordered: "Numbered list", shortOrdered: "Numbered", checklist: "Checklist", quote: "Quote", code: "Code block",
    rule: "Horizontal rule", shortRule: "Divider", link: "Link", image: "Image", diagram: "Diagram", table: "Table",
    highlight: "Highlight", colors: "Highlight colors", highlightColor: (color: string) => `Highlight in ${color}`,
    clearHighlight: "Remove highlight", color: { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink", orange: "Orange" },
    insertTable: "Insert table", insertTableSize: (rows: number, columns: number) => `Insert ${rows} x ${columns} table`,
    rows: "Rows", columns: "Columns", custom: "Custom size…",
  },
};

export type MarkdownToolbarCopy = typeof toolbarCopy.es;
export function useMarkdownToolbarCopy() { return toolbarCopy[useUiLocale()]; }
