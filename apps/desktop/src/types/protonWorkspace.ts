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

export type ProtonDraft = {
  baseRevisionId: string;
  markdown: string;
  generation: number;
  state: "draft" | "unknown" | "conflict";
};

export type ProtonDocument = {
  node: ProtonNode;
  revisionId: string;
  markdown: string | null;
  contentBase64: string | null;
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
