import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { UiLanguage } from "../i18n/uiCopy";
import type { ExportFormat, HandwrittenExportFormat } from "../../types/domain";

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

export type BrowserExportTarget = {
  fileName: string;
  save: (blob: Blob) => Promise<void>;
};

const exportDialogFilters: Record<ExportFormat, { name: string; extensions: string[] }> = {
  md: { name: "Markdown", extensions: ["md"] },
  pdf: { name: "PDF", extensions: ["pdf"] },
  docx: { name: "Word", extensions: ["docx"] },
};

const browserFileTypes: Record<ExportFormat, { description: string; accept: Record<string, string[]> }> = {
  md: { description: "Markdown", accept: { "text/markdown": [".md"] } },
  pdf: { description: "PDF", accept: { "application/pdf": [".pdf"] } },
  docx: {
    description: "Word",
    accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
  },
};

const handwrittenExportDialogFilters: Record<HandwrittenExportFormat, { name: string; extensions: string[] }> = {
  nbnote: { name: "Nota manuscrita de Neubiki", extensions: ["nbnote"] },
  png: { name: "PNG", extensions: ["png"] },
  svg: { name: "SVG", extensions: ["svg"] },
  pdf: { name: "PDF", extensions: ["pdf"] },
};

const handwrittenBrowserFileTypes: Record<HandwrittenExportFormat, { description: string; accept: Record<string, string[]> }> = {
  nbnote: { description: "Nota manuscrita de Neubiki", accept: { "application/vnd.neubiki.handwritten-note+json": [".nbnote"] } },
  png: { description: "PNG", accept: { "image/png": [".png"] } },
  svg: { description: "SVG", accept: { "image/svg+xml": [".svg"] } },
  pdf: { description: "PDF", accept: { "application/pdf": [".pdf"] } },
};

export async function selectExportFilePath(defaultFileName: string, format: ExportFormat, language: UiLanguage = "es"): Promise<string | null> {
  if (!isTauriRuntime()) return null;

  return saveDialog({
      title: language === "en" ? "Export document" : "Exportar documento",
      defaultPath: withExportExtension(defaultFileName, format),
      filters: [exportDialogFilters[format]],
    });
}

export async function selectBrowserExportTarget(defaultFileName: string, format: ExportFormat): Promise<BrowserExportTarget | null> {
  if (typeof window === "undefined") return null;

  const fileName = withExportExtension(defaultFileName, format);
  const savePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (savePicker) {
    try {
      const handle = await savePicker({
        suggestedName: fileName,
        types: [browserFileTypes[format]],
      });
      return {
        fileName,
        save: async (blob) => {
          try {
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
          } catch {
            saveBlobAsDownload(fileName, blob);
          }
        },
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      return createDownloadTarget(fileName);
    }
  }

  return createDownloadTarget(fileName);
}

export async function selectHandwrittenExportFilePath(defaultFileName: string, format: HandwrittenExportFormat, language: UiLanguage = "es"): Promise<string | null> {
  if (!isTauriRuntime()) return null;

  const filter = handwrittenExportDialogFilters[format];
  return saveDialog({
      title: language === "en" ? "Export handwritten note" : "Exportar nota manuscrita",
      defaultPath: withHandwrittenExportExtension(defaultFileName, format),
      filters: [language === "en" && format === "nbnote" ? { ...filter, name: "Neubiki handwritten note" } : filter],
    });
}

export async function selectBrowserHandwrittenExportTarget(defaultFileName: string, format: HandwrittenExportFormat): Promise<BrowserExportTarget | null> {
  if (typeof window === "undefined") return null;

  const fileName = withHandwrittenExportExtension(defaultFileName, format);
  const savePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (savePicker) {
    try {
      const handle = await savePicker({
        suggestedName: fileName,
        types: [handwrittenBrowserFileTypes[format]],
      });
      return {
        fileName,
        save: async (blob) => {
          try {
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
          } catch {
            saveBlobAsDownload(fileName, blob);
          }
        },
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      return createDownloadTarget(fileName);
    }
  }

  return createDownloadTarget(fileName);
}

export function withExportExtension(fileName: string, format: ExportFormat) {
  const extension = `.${format}`;
  const withoutMarkdownExtension = fileName.replace(/\.(?:md|markdown|mdown)$/i, "");
  return withoutMarkdownExtension.toLowerCase().endsWith(extension)
    ? withoutMarkdownExtension
    : `${withoutMarkdownExtension}${extension}`;
}

export function withHandwrittenExportExtension(fileName: string, format: HandwrittenExportFormat) {
  const extension = `.${format}`;
  const withoutKnownExtensions = fileName.replace(/\.(?:nbnote|knote|png|svg|pdf)$/i, "");
  return withoutKnownExtensions.toLowerCase().endsWith(extension)
    ? withoutKnownExtensions
    : `${withoutKnownExtensions}${extension}`;
}

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function createDownloadTarget(fileName: string): BrowserExportTarget {
  return {
    fileName,
    save: async (blob) => saveBlobAsDownload(fileName, blob),
  };
}

function saveBlobAsDownload(fileName: string, blob: Blob) {
  const url = window.URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
