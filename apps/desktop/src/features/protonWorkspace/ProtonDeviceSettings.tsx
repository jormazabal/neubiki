import { useEffect, useRef, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { StatusTag } from "../../components/ui/StatusTag";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { getProtonDeviceStorage, type DeviceStorageFamily, type ProtonDeviceStorage } from "../../lib/api/protonDeviceStorage";
import { SafeDiagnosticsPanel } from "../settings/SafeDiagnosticsPanel";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { useDeviceSettingsCopy } from "../../lib/i18n/deviceSettingsCopy";
import { getProtonErrorMessage } from "../../lib/i18n/protonErrors";

function fileSize(bytes: number, sizeFormat: Intl.NumberFormat) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = units.findIndex((_, index) => bytes < 1024 ** (index + 1));
  if (unit < 0) return `${sizeFormat.format(bytes / 1024 ** 4)} TiB`;
  return `${sizeFormat.format(bytes / 1024 ** unit)} ${units[unit]}`;
}

async function copyReport(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function StorageRow({ family }: { family: DeviceStorageFamily }) {
  const language = useUiLocale();
  const c = useDeviceSettingsCopy().storage;
  const sizeFormat = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  return <div className="flex min-w-0 items-baseline justify-between gap-3 py-2.5">
    <dt className="min-w-0">
      <span className="font-medium">{c.families[family.id]}</span>
      {family.state !== "unavailable" && <span className="block text-xs text-ink-secondary">
        {family.files === 1 ? c.oneFile : c.manyFiles.replace("{count}",sizeFormat.format(family.files))}
      </span>}
    </dt>
    <dd className="shrink-0 text-right tabular-nums">
      {family.state === "unavailable" ? <StatusTag tone="warning">{c.unavailable}</StatusTag>
        : <>{family.state === "partial" && <span className="block text-xs text-ink-secondary">{c.atLeast}</span>}{fileSize(family.logicalBytes,sizeFormat)}</>}
    </dd>
  </div>;
}

export function ProtonDeviceSettings({ native }: { native: boolean }) {
  const language = useUiLocale();
  const c = useDeviceSettingsCopy().storage;
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle:"medium",timeStyle:"short" });
  const [usage, setUsage] = useState<ProtonDeviceStorage | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measurementError, setMeasurementError] = useState<{ cause: unknown } | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function measure() {
    if (!native || active.current) return;
    const request = new AbortController();
    active.current = request;
    setMeasuring(true);
    setMeasurementError(null);
    try {
      const result = await getProtonDeviceStorage(request.signal);
      if (request.signal.aborted) return;
      setUsage(result);
    } catch (cause) {
      if (!request.signal.aborted) setMeasurementError({ cause });
    } finally {
      if (active.current === request) active.current = null;
      if (!request.signal.aborted) setMeasuring(false);
    }
  }

  const incomplete = usage?.families.some(family => family.state !== "complete");

  return <div className="grid max-w-3xl gap-4">
    <section aria-label={c.title} className="space-y-3 rounded-xl border border-line bg-panel p-4 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-lg">
          <h2 className="flex items-center gap-2 font-semibold"><HardDrive aria-hidden="true" size={17} /> {c.title}</h2>
          <p className="mt-1 text-xs text-ink-secondary">{c.description}</p>
        </div>
        <Button size="compact" disabled={!native || measuring} onClick={() => void measure()}>
          <RefreshCw aria-hidden="true" size={15} /> {measuring ? c.measuring : usage ? c.refresh : c.measure}
        </Button>
      </header>
      {!native && <p className="text-ink-secondary">{c.nativeOnly}</p>}
      {measuring && <StatusTag role="status" activity="working">{c.working}</StatusTag>}
      {measurementError && <InlineNotice tone="error" announce="alert">
        {getProtonErrorMessage(measurementError.cause, usage ? c.refreshFailed : c.readFailed, language)}
      </InlineNotice>}
      {usage && <div aria-busy={measuring}>
        {incomplete && <InlineNotice tone="warning" announce="status">{c.partial}</InlineNotice>}
        <dl className="divide-y divide-line">{usage.families.map(family => <StorageRow key={family.id} family={family} />)}</dl>
        <p className="text-xs text-ink-secondary">{c.checkedAt} <time dateTime={usage.checkedAt}>{dateFormat.format(new Date(usage.checkedAt))}</time></p>
      </div>}
    </section>
    {native && <SafeDiagnosticsPanel english={language === "en"} copyText={copyReport} />}
  </div>;
}
