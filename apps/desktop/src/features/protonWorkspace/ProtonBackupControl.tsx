import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { readProtonBackup, updateProtonBackup, type ProtonBackupSchedule } from "../../lib/api/protonBackup";
import type { ProtonBatchScope } from "../../types/protonExportBatch";
import { useUiLocale } from "../../lib/i18n/UiLocale";

const text = {
  es: {
    waiting: "Hay una copia preparada para revisar en este dispositivo.",
    preparing: "La última preparación sigue pendiente de confirmación.",
    prepared: "La última copia se preparó en este dispositivo.",
    failed: "La última preparación falló. Se volverá a comprobar cuando la aplicación esté abierta.",
    title: "Copias programadas", description: "Prepara un paquete de las revisiones guardadas cuando Neubiki esté abierto en esta carpeta y conectado a Proton. Las copias preparadas se revisan en este dispositivo.",
    reading: "Consultando programación…", retry: "Volver a consultar", frequency: "Frecuencia",
    off: "Desactivada", daily: "Cada día", weekly: "Cada semana", save: "Guardar frecuencia", next: "Próxima comprobación",
    saved: "Programación guardada.", readError: "No se pudo consultar la programación.",
    saveError: "No se pudo guardar la programación.", unknown: "No se confirmó el intervalo.",
  },
  en: {
    waiting: "A backup is ready for review on this device.",
    preparing: "The latest preparation is waiting for confirmation.",
    prepared: "The latest backup was prepared on this device.",
    failed: "The latest preparation failed. Neubiki will check again while the app is open.",
    title: "Scheduled backups", description: "Prepare a package of saved revisions while Neubiki has this folder open and is connected to Proton. Prepared backups are reviewed on this device.",
    reading: "Reading schedule…", retry: "Check again", frequency: "Frequency",
    off: "Off", daily: "Daily", weekly: "Weekly", save: "Save frequency", next: "Next check",
    saved: "Schedule saved.", readError: "The schedule could not be read.",
    saveError: "The schedule could not be saved.", unknown: "The interval could not be confirmed.",
  },
} as const;

export function ProtonBackupControl({ scope, disabled }: { scope: ProtonBatchScope; disabled?: boolean }) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const locality = useUiLocale();
  const copy = text[locality];
  const [schedule, setSchedule] = useState<ProtonBackupSchedule | null>(null);
  const [frequency, setFrequency] = useState("off");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const writing = useRef(false);
  const { accountId, rootId } = scope;
  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError("");
    void readProtonBackup({ accountId, rootId }, request.signal).then(value => {
      if (request.signal.aborted) return;
      setSchedule(value);
      setFrequency(value?.intervalDays ? String(value.intervalDays) : "off");
    }).catch(cause => {
      if (!request.signal.aborted) setError(runtimeErrorMessage(cause, copy.readError));
    }).finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [accountId, rootId, retry, copy.readError]);

  async function save() {
    if (!schedule || writing.current || disabled) return;
    writing.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const newInterval = frequency === "1" ? 1 : frequency === "7" ? 7 : null;
      const next = await updateProtonBackup(scope, schedule.revision, newInterval);
      if (!next) throw new Error(copy.unknown);
      setSchedule(next);
      setNotice(copy.saved);
    } catch (cause) {
      setError(runtimeErrorMessage(cause, copy.saveError));
    } finally { writing.current = false; setSaving(false); }
  }

  return <details className="space-y-2 rounded-xl border border-line p-3 text-sm">
    <summary className="cursor-pointer font-medium">{copy.title}</summary>
    <p className="text-xs text-ink-secondary">{copy.description}</p>
    {loading && <p role="status">{copy.reading}</p>}
    {error && <InlineNotice tone="error" announce="alert"
      action={<Button size="compact" onClick={() => setRetry(value => value + 1)} disabled={saving}>{copy.retry}</Button>}>{error}</InlineNotice>}
    {notice && <p role="status">{notice}</p>}
    {schedule && <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1">{copy.frequency}
          <select value={frequency} onChange={event => setFrequency(event.target.value)} className="ui-field" disabled={disabled || saving || loading}>
            <option value="off">{copy.off}</option><option value="1">{copy.daily}</option><option value="7">{copy.weekly}</option>
          </select>
        </label>
        <Button size="compact" disabled={disabled || saving || loading || frequency === String(schedule.intervalDays ?? "off")}
          onClick={() => void save()}>{copy.save}</Button>
      </div>
      {schedule.nextDue && <p className="text-xs text-ink-secondary">{copy.next} {new Intl.DateTimeFormat(locality === "es" ? "es-ES" : "en-GB", {
        dateStyle: "medium", timeStyle: "short",
      }).format(new Date(schedule.nextDue * 1000))}</p>}
      {schedule.status && <p className="text-xs text-ink-secondary">{copy[schedule.status]}</p>}
    </>}
  </details>;
}
