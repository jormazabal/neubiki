import { maxProtonImportFileBytes } from "../../lib/api/protonWorkspace";
import type { ProtonImportEntry } from "../../types/protonWorkspace";

type Source = File | FileSystemEntry;
export type LoadProtonImport = () => Promise<ProtonImportEntry[]>;
export const hasDroppedFiles = (data: DataTransfer) => Array.from(data.types).includes("Files");

type SourceFailure = "empty" | "unreadable" | "scopeLimit" | "invalidName" | "unverifiedName" | "fileLimit" | "duplicateName";

export class ProtonImportSourceError extends Error {
  constructor(readonly reason: SourceFailure, readonly entryName = "") {
    super(reason);
  }
}

export function captureProtonDrop(data: DataTransfer): LoadProtonImport {
  // Chromium only exposes entries and files while the drop event is being dispatched.
  const items = Array.from(data.items ?? []).filter(item => item.kind === "file");
  const sources = items.length > 0
    ? items.map(item => item.webkitGetAsEntry?.() ?? item.getAsFile())
    : Array.from(data.files);
  return () => readSources(sources);
}

export function captureProtonFiles(files: FileList): LoadProtonImport {
  const sources = Array.from(files);
  return () => readSources(sources);
}

async function readSources(sources: Array<Source | null>): Promise<ProtonImportEntry[]> {
  if (!sources.length) throw new ProtonImportSourceError("empty");
  let count = 0;

  async function read(source: Source | null, depth: number): Promise<ProtonImportEntry> {
    if (!source) throw new ProtonImportSourceError("unreadable");
    if (++count > 500 || depth > 32) throw new ProtonImportSourceError("scopeLimit");
    const { name } = source;
    if (!name || name !== name.trim() || name.length > 255 || /[\\/:*?"<>|\p{Cc}]|\.$/u.test(name)) {
      throw new ProtonImportSourceError("invalidName", name);
    }
    if ("isDirectory" in source && source.isDirectory) {
      const reader = (source as FileSystemDirectoryEntry).createReader();
      const children: ProtonImportEntry[] = [];
      const names = new Set<string>();
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) children.push(await readUnique(child, depth + 1, names));
      }
      return { type: "folder", name, children };
    }
    const file = "isFile" in source
      ? await new Promise<File>((resolve, reject) => (source as FileSystemFileEntry).file(resolve, reject))
      : source;
    if (file.name !== name) throw new ProtonImportSourceError("unverifiedName", name);
    if (file.size > maxProtonImportFileBytes) throw new ProtonImportSourceError("fileLimit", name);
    return { type: "file", name, file };
  }

  async function readUnique(source: Source | null, depth: number, names: Set<string>) {
    const entry = await read(source, depth);
    const comparable = entry.name.normalize("NFC").toLowerCase();
    if (names.has(comparable)) throw new ProtonImportSourceError("duplicateName", entry.name);
    names.add(comparable);
    return entry;
  }

  const entries: ProtonImportEntry[] = [];
  const names = new Set<string>();
  for (const source of sources) entries.push(await readUnique(source, 1, names));
  return entries;
}
