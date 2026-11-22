import { requestJson } from "./client";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";

export type WorkbookReference = {
  sheets: { id: string; name: string; hidden: boolean }[];
  sheetId: string;
  rowCount: number;
  columnCount: number;
  rowStart?: number;
  columnStart?: number;
  cells: { row: number; column: number; value: string }[];
  partial: boolean;
};

export type ProtonOfficePreview =
  | { format: "docx"; revisionId: string; text: string }
  | { format: "xlsx"; revisionId: string; workbook: WorkbookReference };

export function readProtonOfficePreview(address: ProtonDocumentKey, revisionId: string, sheetId?: string, signal?: AbortSignal, position?: { row: number; column: number }) {
  return requestJson<ProtonOfficePreview>("/api/proton/workspace/office-preview", {
    method: "POST", body: JSON.stringify({ ...address, revisionId, sheetId, ...position }), timeoutMs: 210_000, signal,
  });
}
