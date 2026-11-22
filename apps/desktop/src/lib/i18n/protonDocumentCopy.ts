import { useUiLocale } from "./UiLocale";
const es = {
  "toolsLabel": "Herramientas de Proton",
  "toolsHeading": "Herramientas",
  "back": "Volver al documento",
  "closePanel": "Cerrar panel",
  "actionsLabel": "Acciones del documento",
  "openMarkdown": "Abre un documento Markdown para usar las herramientas.",
  "format": "Formato",
  "tools": {
    "find": "Buscar",
    "references": "Referencias",
    "assistant": "IA",
    "translation": "Traducir",
    "images": "Imágenes"
  },
  "loading": {
    "find": "Cargando búsqueda…",
    "references": "Cargando referencias…",
    "tool": "Cargando herramienta…",
    "note": "Cargando nota…",
    "viewer": "Cargando visor…",
    "notes": "Cargando notas…",
    "diagrams": "Cargando diagramas…"
  },
  "notice": {
    "referenceStale": "La nota abierta difiere de la revisión donde se encontró la referencia. Vuelve a leer el documento para consultarla.",
    "searchStale": "El contenido abierto difiere del resultado de búsqueda. Usa Buscar en el documento para revisar el texto actual.",
    "sourceMatch": "La coincidencia está en la fuente Markdown. Puedes consultarla desde el menú de formato.",
    "cursorRequired": "Coloca el cursor en el documento o selecciona texto y vuelve a intentarlo.",
    "targetChanged": "El documento cambió o no está disponible."
  },
  "referencesSaved": "Las referencias corresponden a la versión guardada en Proton.",
  "footer": {
    "label": "Guardado del documento",
    "connection": "Conexión sin confirmar. Vuelve a conectar para seguir editando.",
    "privateOnly": "Puedes preparar un borrador privado. Esta instalación no guarda cambios en Proton.",
    "remoteChanged": "Proton ha notificado cambios. Puedes volver a leer el archivo conservando el borrador.",
    "closeNotice": "Cerrar aviso del editor",
    "discardHelp": "Se eliminará el borrador de este dispositivo. El archivo en Proton no se modificará.",
    "unknownHelp": "El estado del último guardado sigue sin confirmarse.",
    "cancel": "Cancelar",
    "discard": "Descartar borrador",
    "discardReview": "Descartar borrador…",
    "recoverable": "Borrador privado recuperable en este dispositivo.",
    "protect": "Guardar borrador",
    "check": "Comprobar revisión",
    "conflict": "Revisar conflicto",
    "reload": "Volver a leer",
    "save": "Guardar en Proton"
  },
  "status": {
    "reload": "Borrador preparado. Vuelve a leer el documento.",
    "unknown": "Guardado pendiente de comprobación.",
    "conflict": "La revisión de Proton cambió. Tu borrador se conserva.",
    "edited": "Borrador pendiente de guardar en este dispositivo.",
    "draft": "Borrador local",
    "saved": "Guardado en Proton.",
    "read": "Leído de Proton.",
    "preview": "Vista previa."
  },
  "errors": {
    "editorUnavailable": "El editor no está disponible para insertar la imagen.",
    "uploadChanged": "La imagen se encuentra en Proton Drive. El documento cambió durante la carga.",
    "targetChanged": "El documento cambió o no está disponible.",
    "previewUnavailable": "No se pudo mostrar la vista previa de este archivo."
  }
};
type Copy<T> = { [K in keyof T]: T[K] extends string ? string : Copy<T[K]> };
const en: Copy<typeof es> = {
  "toolsLabel": "Proton tools",
  "toolsHeading": "Tools",
  "back": "Back to document",
  "closePanel": "Close panel",
  "actionsLabel": "Document actions",
  "openMarkdown": "Open a Markdown document to use the tools.",
  "format": "Format",
  "tools": {
    "find": "Find",
    "references": "References",
    "assistant": "AI",
    "translation": "Translate",
    "images": "Images"
  },
  "loading": {
    "find": "Loading search…",
    "references": "Loading references…",
    "tool": "Loading tool…",
    "note": "Loading note…",
    "viewer": "Loading viewer…",
    "notes": "Loading notes…",
    "diagrams": "Loading diagrams…"
  },
  "notice": {
    "referenceStale": "The open note differs from the revision where the reference was found. Read the document again to inspect it.",
    "searchStale": "The open content differs from the search result. Use Find in document to inspect the current text.",
    "sourceMatch": "The match is in the Markdown source. You can inspect it from the format menu.",
    "cursorRequired": "Place the cursor in the document or select text and try again.",
    "targetChanged": "The document changed or is unavailable."
  },
  "referencesSaved": "References refer to the version saved in Proton.",
  "footer": {
    "label": "Document saving",
    "connection": "Connection unconfirmed. Reconnect to continue editing.",
    "privateOnly": "You can prepare a private draft. This installation does not save changes to Proton.",
    "remoteChanged": "Proton reported changes. You can read the file again while preserving the draft.",
    "closeNotice": "Close editor notice",
    "discardHelp": "The draft on this device will be deleted. The file in Proton will not change.",
    "unknownHelp": "The last save is still unconfirmed.",
    "cancel": "Cancel",
    "discard": "Discard draft",
    "discardReview": "Discard draft…",
    "recoverable": "Private draft recoverable on this device.",
    "protect": "Save draft",
    "check": "Check revision",
    "conflict": "Review conflict",
    "reload": "Read again",
    "save": "Save to Proton"
  },
  "status": {
    "reload": "Draft prepared. Read the document again.",
    "unknown": "Save awaiting verification.",
    "conflict": "The Proton revision changed. Your draft is preserved.",
    "edited": "Draft waiting to be saved on this device.",
    "draft": "Local draft",
    "saved": "Saved to Proton.",
    "read": "Read from Proton.",
    "preview": "Preview."
  },
  "errors": {
    "editorUnavailable": "The editor is unavailable for inserting the image.",
    "uploadChanged": "The image is in Proton Drive. The document changed during upload.",
    "targetChanged": "The document changed or is unavailable.",
    "previewUnavailable": "A preview of this file could not be displayed."
  }
};
export const protonDocumentCopy = { es, en };
export type ProtonDocumentNotice = keyof typeof es.notice;
export function useProtonDocumentCopy() { return protonDocumentCopy[useUiLocale()]; }
