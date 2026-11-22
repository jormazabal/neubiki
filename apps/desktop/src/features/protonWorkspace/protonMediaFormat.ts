export type ProtonMediaFormat = { kind: "audio" | "video"; mime: string };

const formats: Record<string, ProtonMediaFormat> = {
  mp3: { kind: "audio", mime: "audio/mpeg" },
  wav: { kind: "audio", mime: "audio/wav" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  flac: { kind: "audio", mime: "audio/flac" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  mp4: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
};

export function protonMediaFormat(name: string): ProtonMediaFormat | null {
  return formats[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

/** Verify the container header before exposing local bytes to the native media decoder. */
export function matchesMediaHeader(bytes: Uint8Array, mime: string) {
  const text = (from: number, length: number) => String.fromCharCode(...bytes.subarray(from, from + length));
  if (mime === "audio/wav") return text(0, 4) === "RIFF" && text(8, 4) === "WAVE";
  if (mime === "audio/ogg") return text(0, 4) === "OggS";
  if (mime === "audio/flac") return text(0, 4) === "fLaC";
  if (mime === "audio/mpeg") return text(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mime === "audio/mp4" || mime === "video/mp4") return text(4, 4) === "ftyp";
  return mime === "video/webm" && [0x1a, 0x45, 0xdf, 0xa3].every((byte, index) => bytes[index] === byte);
}
