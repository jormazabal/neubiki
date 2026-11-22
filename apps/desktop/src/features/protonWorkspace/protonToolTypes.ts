import type { ComponentType } from "react";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";
import type { MarkdownEditorSelection } from "../editor/editorTypes";

export type ProtonToolTarget = {
  address: ProtonDocumentKey;
  baseRevisionId: string;
  editorKey: number;
  draftGeneration: number | null;
  markdown: string;
  selection: (MarkdownEditorSelection & { markdown: string }) | null;
};

export type ProtonToolEdit = {
  kind: "replace_document" | "replace_range" | "insert_at";
  markdown: string;
};

export type ProtonDocumentToolProps = {
  available: boolean;
  capture: () => ProtonToolTarget | null;
  apply: (target: ProtonToolTarget, edit: ProtonToolEdit) => boolean;
};

export type ProtonDocumentTool = {
  id: "assistant" | "translation" | "images";
  label: string;
  panel: ComponentType<ProtonDocumentToolProps>;
};
