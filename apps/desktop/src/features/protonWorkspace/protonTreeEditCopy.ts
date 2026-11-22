import type { ProtonTreeEdit } from "../../types/protonWorkspace";
import type { UiLanguage } from "../../lib/i18n/uiCopy";

type TreeEditCopy = {
  action: Record<ProtonTreeEdit["action"], string>;
  inFolder: (name: string) => string;
  copiedName: (name: string) => string;
  name: string;
  invalidName: string;
  duplicateHelp: string;
  trashFolder: string;
  trashFile: string;
  draftsKept: string;
  moveHelp: string;
  up: string;
  loading: string;
  loadError: string;
  empty: string;
  close: string;
  cancel: string;
  applying: string;
  create: string;
  move: string;
};

export const protonTreeEditCopy: Record<UiLanguage, TreeEditCopy> = {
  es: {
    action: {
      "create-folder": "Nueva carpeta", "create-document": "Nuevo documento",
      "create-note": "Nueva nota manuscrita", rename: "Renombrar",
      duplicate: "Duplicar documento", move: "Mover", trash: "Enviar a la papelera",
    },
    inFolder: name => `En ${name}`, copiedName: name => `${name} (copia)`,
    name: "Nombre", invalidName: "Introduce un nombre válido de hasta 255 caracteres.",
    duplicateHelp: "Se copia la revisión guardada en Proton.",
    trashFolder: "La carpeta y su contenido se enviarán a la papelera de Proton Drive.",
    trashFile: "El archivo se enviará a la papelera de Proton Drive.",
    draftsKept: "Los borradores locales se conservan.",
    moveHelp: "Elige la carpeta de destino. Los enlaces relativos pueden requerir ajustes.",
    up: "Subir un nivel", loading: "Leyendo carpetas…",
    loadError: "No se pudo abrir esta carpeta.", empty: "No hay subcarpetas disponibles.",
    close: "Cerrar", cancel: "Cancelar", applying: "Aplicando…", create: "Crear", move: "Mover aquí",
  },
  en: {
    action: {
      "create-folder": "New folder", "create-document": "New document",
      "create-note": "New handwritten note", rename: "Rename",
      duplicate: "Duplicate document", move: "Move", trash: "Move to trash",
    },
    inFolder: name => `In ${name}`, copiedName: name => `${name} (copy)`,
    name: "Name", invalidName: "Enter a valid name up to 255 characters.",
    duplicateHelp: "The revision saved in Proton will be copied.",
    trashFolder: "The folder and its contents will move to the Proton Drive trash.",
    trashFile: "The file will move to the Proton Drive trash.",
    draftsKept: "Drafts on this device stay available.",
    moveHelp: "Choose a destination folder. You may need to update relative links.",
    up: "Go up one level", loading: "Reading folders…",
    loadError: "This folder could not be opened.", empty: "No subfolders are available.",
    close: "Close", cancel: "Cancel", applying: "Applying…", create: "Create", move: "Move here",
  },
};
