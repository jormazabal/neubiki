import { editTree, importProtonFile } from "./protonWorkspace";
import type { ProtonImportEntry } from "../../types/protonWorkspace";

export type ProtonImportResult = { confirmed: number; failure?: { path: string;
  reason?: "unconfirmedFolder" | "unconfirmedFile"; cause?: unknown } };

export async function importProtonTree(accountId: string, rootId: string, parentId: string, entries: ProtonImportEntry[],
  onProgress: (confirmed: number) => void): Promise<ProtonImportResult> {
  let confirmed = 0;
  let path = "";

  async function copy(entries: ProtonImportEntry[], parent: string, prefix: string): Promise<ProtonImportResult["failure"]> {
    for (const entry of entries) {
      path = `${prefix}${entry.name}`;
      if (entry.type === "folder") {
        const result = await editTree(accountId, rootId, { action: "create-folder", name: entry.name, parentId: parent });
        if (!("node" in result) || result.node.type !== "folder") return { path, reason: "unconfirmedFolder" };
        onProgress(++confirmed);
        const failure = await copy(entry.children, result.node.nodeId, `${path}/`);
        if (failure) return failure;
      } else {
        const result = await importProtonFile(accountId, rootId, parent, entry.file);
        if (result.node?.type !== "file" || result.node.name !== entry.name) return { path, reason: "unconfirmedFile" };
        onProgress(++confirmed);
      }
    }
  }

  try {
    const failure = await copy(entries, parentId, "");
    return failure ? { confirmed, failure } : { confirmed };
  } catch (cause) {
    return { confirmed, failure: { path, cause } };
  }
}
