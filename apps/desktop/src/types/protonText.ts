import type { ProtonDocumentKey } from "./protonWorkspace";

export type ProtonTextExecutionMode = "quick" | "reasoning";
export type ProtonTextExchange = { prompt: string; answer: string };
export type ProtonTextSource = { nodeId: string; revisionId: string };

export type ProtonTextRequest = ProtonDocumentKey & {
  baseRevisionId: string;
  retainHistory?: true;
} & (
  | {
    kind: "assistant";
    prompt: string;
    markdown: string;
    selectedMarkdown?: string;
    executionMode?: ProtonTextExecutionMode;
    previousExchange?: ProtonTextExchange;
    previousExchanges?: ProtonTextExchange[];
    sources?: ProtonTextSource[];
  }
  | { kind: "translate"; language: string; scope: "selection" | "document"; markdown: string }
);

export type ProtonTextResult = {
  kind: "answer" | "replace_range" | "replace_document" | "insert_at";
  text: string;
  historySaved?: boolean;
};
