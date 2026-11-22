import type { ProtonDocumentKey } from "../../types/protonWorkspace";
import { requestJson } from "./client";

export type ProtonGeneratedImage = {
  contentBase64: string;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  usageRecorded: boolean;
  historySaved?: boolean;
};

const maxImageBytes = 8 * 1024 * 1024;
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function generateProtonImage(address: ProtonDocumentKey, baseRevisionId: string, prompt: string, retainHistory = false) {
  const image = await requestJson<ProtonGeneratedImage>("/api/proton/ai/image", {
    method: "POST",
    body: JSON.stringify({ ...address, baseRevisionId, prompt, ...(retainHistory ? { retainHistory: true } : {}) }),
    timeoutMs: 240_000,
  });
  if (!imageTypes.has(image.contentType) || typeof image.contentBase64 !== "string" || !image.contentBase64) {
    throw new Error("El proveedor no devolvió una imagen compatible.");
  }
  return image;
}

export async function uploadProtonImageContent(address: ProtonDocumentKey, contentBase64: string) {
  const result = await requestJson<{ relativePath: string }>("/api/proton/workspace/upload-image", {
    method: "POST",
    body: JSON.stringify({ ...address, contentBase64 }),
    timeoutMs: 240_000,
  });
  if (!/^assets\/neubiki-[0-9a-f]{64}\.(?:png|jpg|webp|gif)$/.test(result.relativePath)) {
    throw new Error("Proton no confirmó una ruta de imagen válida.");
  }
  return result.relativePath;
}

export async function uploadProtonWorkspaceImage(address: ProtonDocumentKey, file: File) {
  if (file.size === 0 || file.size > maxImageBytes) {
    throw new Error("Elige una imagen de hasta 8 MiB.");
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("No se pudo leer la imagen."));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
  return uploadProtonImageContent(address, data.slice(data.indexOf(",") + 1));
}
