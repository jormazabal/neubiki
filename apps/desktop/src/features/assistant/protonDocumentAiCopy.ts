import { useUiLocale } from "../../lib/i18n/UiLocale";

const languageLabels = {
  Alemán: "German", Catalán: "Catalan", Español: "Spanish", Euskera: "Basque", Francés: "French",
  Gallego: "Galician", Inglés: "English", Italiano: "Italian", Portugués: "Portuguese",
} as const;

export type TranslationLanguage = keyof typeof languageLabels;
export const translationLanguages = Object.keys(languageLabels) as TranslationLanguage[];

const copy = {
  es: {
    historyWarning: "No se confirmó la copia en el historial privado.",
    translation: {
      unavailable: "La traducción requiere un documento Markdown disponible.", open: "Abre un documento Markdown para traducir.",
      select: "Selecciona texto en el editor y vuelve a pulsar Traducir.", empty: "El documento está vacío.",
      invalid: "El runtime no devolvió una traducción válida para el alcance elegido.", same: "La traducción coincide con el original.",
      failed: "No se pudo generar la traducción.", permission: "Activa el permiso de edición de documentos en Ajustes de IA.",
      checkUsage: "Consultar consumo de IA",
      applied: "Traducción aplicada al editor.", stale: "La propuesta ya no se puede aplicar a su documento o selección. Vuelve a pulsar Traducir.",
      permissionFailed: "No se pudo comprobar el permiso de edición. Vuelve a intentarlo.",
      scope: "Alcance", chooseScope: "Elige el alcance", selection: "Selección", document: "Documento",
      language: "Idioma de destino", chooseLanguage: "Elige un idioma", labelLanguage: (language: TranslationLanguage) => language,
      translate: "Traducir", translating: "Traduciendo…", progress: "Progreso de la traducción", review: "Revisar traducción",
      proposal: "Traducción propuesta", discard: "Descartar", checking: "Comprobando permiso…", applySelection: "Aplicar a la selección", applyDocument: "Aplicar al documento",
    },
    comparison: {
      source: "Original", proposal: "Propuesta", label: "Contenido de la revisión", whole: "Documento completo", selection: "Selección de texto",
      insertion: "Punto de inserción", originalContent: "Contenido original", empty: "El original está vacío.",
      preserves: "La inserción conserva el texto original.", proposalEmpty: "La propuesta está vacía.",
    },
    images: {
      usage: "La imagen está lista. El registro de consumo quedó sin confirmar.", failed: "No se confirmó la generación de la imagen.",
      checkUsage: "Consultar consumo de IA",
      stale: "El documento cambió. Selecciona el punto de inserción y usa el destino actual.",
      uploadStale: "La imagen está en Proton. El documento cambió antes de insertarla.",
      inserted: "Imagen insertada en el borrador. Guarda el documento para compartirla.",
      uploadFailed: "No se confirmó la subida. La imagen se conserva para reintentar.",
      describe: "Describe la imagen", generating: "Generando…", generate: "Generar imagen", working: "Generando imagen…",
      uploading: "Subiendo a Proton…", generationProgress: "Progreso de generación", uploadProgress: "Progreso de subida",
      preview: "Vista previa de la imagen generada", uploadingShort: "Subiendo…", useCurrent: "Insertar en el destino actual",
      upload: "Subir e insertar", outputAlt: "Imagen generada",
    },
  },
  en: {
    historyWarning: "Saving to private history could not be confirmed.",
    translation: {
      unavailable: "Translation requires an available Markdown document.", open: "Open a Markdown document to translate.",
      select: "Select text in the editor, then choose Translate again.", empty: "The document is empty.",
      invalid: "The runtime returned an invalid translation for the selected scope.", same: "The translation matches the original.",
      failed: "The translation could not be generated.", permission: "Allow document editing in AI Settings.",
      checkUsage: "Check AI usage",
      applied: "Translation applied in the editor.", stale: "The proposal no longer matches the document or selection. Choose Translate again.",
      permissionFailed: "Permission to edit could not be checked. Try again.", scope: "Scope", chooseScope: "Choose a scope",
      selection: "Selection", document: "Document", language: "Target language", chooseLanguage: "Choose a language",
      labelLanguage: (language: TranslationLanguage) => languageLabels[language], translate: "Translate", translating: "Translating…",
      progress: "Translation progress", review: "Review translation", proposal: "Proposed translation", discard: "Discard",
      checking: "Checking permission…", applySelection: "Apply to selection", applyDocument: "Apply to document",
    },
    comparison: {
      source: "Original", proposal: "Proposal", label: "Content to review", whole: "Entire document", selection: "Text selection",
      insertion: "Insertion point", originalContent: "Original content", empty: "The original is empty.",
      preserves: "Inserting keeps the original text.", proposalEmpty: "The proposal is empty.",
    },
    images: {
      usage: "The image is ready. Usage recording could not be confirmed.", failed: "Image generation could not be confirmed.",
      checkUsage: "Check AI usage",
      stale: "The document changed. Select an insertion point and use the current destination.",
      uploadStale: "The image is in Proton. The document changed before it could be inserted.",
      inserted: "Image inserted in the draft. Save the document to share it.",
      uploadFailed: "The upload could not be confirmed. The image is available to try again.",
      describe: "Describe the image", generating: "Generating…", generate: "Generate image", working: "Generating image…",
      uploading: "Uploading to Proton…", generationProgress: "Generation progress", uploadProgress: "Upload progress",
      preview: "Generated image preview", uploadingShort: "Uploading…", useCurrent: "Insert at the current destination",
      upload: "Upload and insert", outputAlt: "Generated image",
    },
  },
};

export function useProtonDocumentAiCopy() { return copy[useUiLocale()]; }
