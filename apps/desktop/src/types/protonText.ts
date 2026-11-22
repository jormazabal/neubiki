import type { ProtonDocumentKey } from "./protonWorkspace";

export type ProtonTextRequest = ProtonDocumentKey & {
  baseRevisionId: string;
} & (
  | { kind: "assistant"; prompt: string; markdown: string; selectedMarkdown?: string }
  | { kind: "translate"; language: string; scope: "selection" | "document"; markdown: string }
);

export type ProtonTextResult = {
  kind: "answer" | "replace_range" | "replace_document" | "insert_at";
  text: string;
};
