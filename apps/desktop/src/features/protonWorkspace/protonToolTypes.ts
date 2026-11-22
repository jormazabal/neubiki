import type { ComponentType } from "react";
import type { ProtonDocumentKey, ProtonNode } from "../../types/protonWorkspace";
import type { MarkdownEditorSelection } from "../editor/editorTypes";

export type ProtonToolTarget = {
  address: ProtonDocumentKey;
  baseRevisionId: string;
  documentName?: string;
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
  editorKey?: number;
  sourceScope?: { root: ProtonNode; address: ProtonDocumentKey; revisionId: string };
  aiSettingsRevision?: number;
  onCheckAiUsage?: () => void;
  capture: () => ProtonToolTarget | null;
  apply: (target: ProtonToolTarget, edit: ProtonToolEdit) => boolean;
};

export type ProtonDocumentTool = {
  id: "assistant" | "translation" | "images";
  label: string;
  panel: ComponentType<ProtonDocumentToolProps>;
};
