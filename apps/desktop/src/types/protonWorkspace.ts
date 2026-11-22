import type { HandwrittenNoteContent } from "./domain";

export type ProtonNode = {
  nodeId: string;
  name: string;
  type: "file" | "folder";
  revisionId?: string | null;
};

export type ProtonWorkspace = {
  accountId: string;
  root: ProtonNode;
  canWrite: boolean;
};

export type ProtonDocumentKey = { accountId: string; rootId: string; nodeId: string };
export type ProtonDocumentJump = {
  query: string;
  revisionId?: string | null;
  pageId?: string | null;
  pageNumber?: number | null;
  line?: number | null;
  sheetId?: string | null;
  row?: number | null;
  column?: number | null;
};

type ProtonTreeSource = { nodeId: string; expectedName: string };
export type ProtonTreeEdit = { parentId: string } & (
  | { action: "create-folder" | "create-document" | "create-note"; name: string }
  | ({ action: "rename" | "duplicate"; name: string } & ProtonTreeSource)
  | ({ action: "move"; targetParentId: string } & ProtonTreeSource)
  | ({ action: "trash" } & ProtonTreeSource)
);
export type ProtonTreeEditResult = { node: ProtonNode } | { trashedId: string };
export type ProtonImportEntry = { type: "folder"; name: string; children: ProtonImportEntry[] }
  | { type: "file"; name: string; file: File };

export type ProtonDraft = {
  baseRevisionId: string;
  markdown: string;
  handwritten?: HandwrittenNoteContent | null;
  generation: number;
  state: "draft" | "unknown" | "conflict";
};

export type ProtonDocument = {
  node: ProtonNode;
  revisionId: string;
  ancestorIds?: string[] | null;
  markdown: string | null;
  contentBase64: string | null;
  handwritten?: HandwrittenNoteContent;
  draft: ProtonDraft | null;
};

export type ProtonSaveResult = {
  state: "saved" | "observed" | "unknown" | "conflict";
  revisionId: string | null;
  draft: ProtonDraft | null;
};

export type ProtonAsset = {
  node: ProtonNode;
  revisionId: string;
  contentType: string;
  contentBase64: string;
};

export type ProtonEvents = { cursor: string | null; changed: boolean; requiresRefresh: boolean };
