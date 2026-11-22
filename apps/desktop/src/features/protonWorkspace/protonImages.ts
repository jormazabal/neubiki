import { readAsset } from "../../lib/api/protonWorkspace";
import type { ProtonDocumentKey } from "../../types/protonWorkspace";

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function relativeAssetPath(source: string) {
  const path = source.trim().split(/[?#]/, 1)[0];
  if (!path || /^(?:\/|[\w+.-]+:)|\\/.test(path)) return null;
  try {
    const segments = path.split("/").map(decodeURIComponent);
    return segments.some(part => !part || /[\/\\\0]/.test(part)) ? null : segments.join("/");
  } catch {
    return null;
  }
}

export function imageObjectUrl(dataBase64: string, contentType: string) {
  if (!imageTypes.has(contentType)) return null;
  const data = Uint8Array.from(atob(dataBase64), character => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([data], { type: contentType }));
}

export function protonImageCache(document: ProtonDocumentKey) {
  const request = new AbortController();
  const cache = new Map<string, Promise<string | null>>();
  return {
    resolve(source: string) {
      const relativePath = relativeAssetPath(source);
      if (!relativePath || request.signal.aborted) return Promise.resolve(null);
      let entry = cache.get(relativePath);
      if (!entry) {
        entry = readAsset(document, relativePath, request.signal)
          .then(asset => request.signal.aborted ? null : imageObjectUrl(asset.contentBase64, asset.contentType))
          .catch(() => null);
        cache.set(relativePath, entry);
      }
      return entry;
    },
    dispose() {
      request.abort();
      for (const entry of cache.values()) void entry.then(url => { if (url) URL.revokeObjectURL(url); });
      cache.clear();
    },
  };
}
