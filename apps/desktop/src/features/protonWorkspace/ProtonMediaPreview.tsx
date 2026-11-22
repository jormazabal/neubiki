import { useEffect, useState } from "react";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { Button } from "../../components/ui/Button";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonExplorationCopy } from "./protonExplorationCopy";
import { matchesMediaHeader, protonMediaFormat } from "./protonMediaFormat";

const maxBytes = 16 * 1024 * 1024;

export function ProtonMediaPreview({ name, contentBase64, busy, onReload }: {
  name: string;
  contentBase64: string;
  busy?: boolean;
  onReload: () => void;
}) {
  const t = protonExplorationCopy[useUiLocale()];
  const format = protonMediaFormat(name);
  const [resource, setResource] = useState<{ source: string; url: string | null }>();
  const [failedSource, setFailedSource] = useState<string>();
  useEffect(() => {
    let url: string | null = null;
    try {
      if (!format || contentBase64.length > Math.ceil(maxBytes / 3) * 4) throw new Error("Unsupported media");
      const binary = atob(contentBase64);
      if (binary.length === 0 || binary.length > maxBytes) throw new Error("Media size exceeded");
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      if (!matchesMediaHeader(bytes, format.mime)) throw new Error("Invalid media header");
      url = URL.createObjectURL(new Blob([bytes], { type: format.mime }));
    } catch { /* Render an error for this exact media revision. */ }
    setResource({ source: contentBase64, url });
    setFailedSource(undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [contentBase64, format?.mime]);

  const current = resource?.source === contentBase64 ? resource : undefined;
  const unavailable = current?.url === null || failedSource === contentBase64;
  return <section aria-label={t.playbackNamed(name)} className="flex h-full min-h-0 flex-col gap-3 p-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <p className="break-words text-sm font-medium">{name}</p>
      <Button size="compact" disabled={busy} onClick={onReload}>{t.reloadProton}</Button>
    </header>
    {!current && <p role="status" className="text-sm text-ink-secondary">{t.playbackLoading}</p>}
    {unavailable && <InlineNotice tone="warning" announce="alert">{t.playbackError}</InlineNotice>}
    {current?.url && !unavailable && (format?.kind === "video"
      ? <video key={current.url} aria-label={name} controls playsInline preload="metadata" className="min-h-0 w-full flex-1 object-contain"
        src={current.url} onError={() => setFailedSource(contentBase64)} />
      : <audio key={current.url} aria-label={name} controls preload="metadata" className="w-full"
        src={current.url} onError={() => setFailedSource(contentBase64)} />)}
  </section>;
}
