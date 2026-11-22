import { protonMediaFormat } from "./protonMediaFormat";

export function protonReferenceFormat(name: string): "pdf" | "text" | "docx" | "xlsx" | "audio" | "video" | null {
  const media = protonMediaFormat(name);
  if (media) return media.kind;
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.docx$/i.test(name)) return "docx";
  if (/\.xlsx$/i.test(name)) return "xlsx";
  if (/\.(txt|csv|tsv|log|json)$/i.test(name)) return "text";
  return null;
}

export function isProtonReferenceName(name: string) {
  return protonReferenceFormat(name) !== null;
}
