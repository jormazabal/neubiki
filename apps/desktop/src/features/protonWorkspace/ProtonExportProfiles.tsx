import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { changeExportProfiles, getExportProfiles } from "../../lib/api/portabilityWorkspace";
import type { ExportProfile, ExportProfiles } from "../../types/portabilityWorkspace";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonExportProfileCopy } from "./protonExportProfileCopy";

type Props = {
  active: boolean;
  disabled: boolean;
  templatePending: boolean;
  resetKey: number;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};

export function ProtonExportProfiles({
  active, disabled, templatePending, resetKey, onDirtyChange, onBusyChange,
}: Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const t = protonExportProfileCopy[useUiLocale()];
  const [catalog, setCatalog] = useState<ExportProfiles>();
  const [name, setName] = useState("");
  const [cover, setCover] = useState(false);
  const [contents, setContents] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<ExportProfile>();
  const [uncertain, setUncertain] = useState<{ action: "capture" | "remove"; id: string }>();
  const pending = useRef(false);
  const mounted = useRef(false);
  const dirty = Boolean(name || cover || contents);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    setName(""); setCover(false); setContents(false); setConfirm(undefined);
  }, [resetKey]);

  useEffect(() => {
    if (!active || catalog || pending.current) return;
    void load();
  }, [active]);

  function start() {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setNotice("");
    return true;
  }

  function finish() {
    pending.current = false;
    if (mounted.current) {
      setBusy(false);
      onBusyChange(false);
    }
  }

  function clearFields() { setName(""); setCover(false); setContents(false); }

  async function load() {
    if (!start()) return;
    try {
      const next = await getExportProfiles();
      if (!mounted.current) return;
      setCatalog(next);
      if (uncertain) {
        const present = next.profiles.some(profile => profile.id === uncertain.id);
        if (uncertain.action === "capture" ? present : !present) {
          setNotice(uncertain.action === "capture" ? t.saved : t.deleted);
          if (uncertain.action === "capture") clearFields();
        } else {
          setNotice(t.absent);
        }
        setUncertain(undefined);
      }
    } catch (cause) {
      if (mounted.current) setError(runtimeErrorMessage(cause, t.readFailed));
    } finally { finish(); }
  }

  async function change(action: "capture" | "remove", id: string) {
    if (!catalog || disabled || templatePending && action === "capture" || uncertain || !start()) return;
    try {
      const next = await changeExportProfiles(catalog, action === "capture"
        ? { action, id, name: name.trim(), cover, contents } : { action, id });
      if (!mounted.current) return;
      setCatalog(next);
      setConfirm(undefined);
      if (action === "capture") clearFields();
      setNotice(action === "capture" ? t.saved : t.deleted);
    } catch (cause) {
      if (!mounted.current) return;
      setUncertain({ action, id });
      setConfirm(undefined);
      setError(runtimeErrorMessage(cause, t.changeFailed));
    } finally { finish(); }
  }

  const locked = disabled || busy;
  return <section className="mt-6 space-y-3 border-t border-line pt-5" aria-label={t.title}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{t.title}</h3>
      <Button size="compact" disabled={locked} onClick={() => void load()}>
        {uncertain ? t.check : catalog ? t.refresh : t.read}
      </Button>
    </div>
    <p className="text-xs text-ink-secondary">{t.help}</p>
    {error && <InlineNotice tone={uncertain ? "warning" : "error"} announce="alert">{error}</InlineNotice>}
    {notice && <InlineNotice tone="neutral" announce="status">{notice}</InlineNotice>}
    {busy && <p role="status" className="text-sm">{t.working}</p>}
    {catalog && <>
      {catalog.profiles.length > 0 ? <ul className="divide-y divide-line">
        {catalog.profiles.map(profile => <li key={profile.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium">{profile.name}</p>
            <p className="text-xs text-ink-secondary">{profile.cover ? t.withCover : t.withoutCover} · {profile.contents ? t.withContents : t.withoutContents}</p>
          </div>
          <Button size="compact" variant="quiet" disabled={locked || Boolean(uncertain)}
            aria-label={t.removeAction(profile.name)} onClick={() => setConfirm(profile)}>{t.remove}</Button>
        </li>)}
      </ul> : <p className="text-sm text-ink-secondary">{t.empty}</p>}
      <form className="space-y-3 rounded-xl border border-line p-3" onSubmit={event => {
        event.preventDefault();
        if (!name.trim() || name.trim().length > 100 || catalog.profiles.length >= 32) return;
        void change("capture", "export-profile-" + crypto.randomUUID());
      }}>
        <h4 className="text-sm font-semibold">{t.create}</h4>
        {templatePending && <p className="text-xs text-ink-secondary">{t.saveTemplateFirst}</p>}
        {catalog.profiles.length >= 32 && <p className="text-xs text-ink-secondary">{t.limit}</p>}
        <fieldset className="space-y-2" disabled={locked || Boolean(uncertain)}>
          <label className="grid gap-1 text-sm">{t.name}
            <input className="ui-field" maxLength={100} value={name} onChange={event => setName(event.target.value)} />
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={cover} onChange={event => setCover(event.target.checked)} /> {t.cover}
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={contents} onChange={event => setContents(event.target.checked)} /> {t.contents}
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            {dirty && <Button variant="quiet" onClick={clearFields}>{t.discard}</Button>}
            <Button type="submit" variant="primary" disabled={!name.trim() || templatePending || catalog.profiles.length >= 32}>{t.save}</Button>
          </div>
        </fieldset>
      </form>
    </>}
    {confirm && <ModalFrame label={t.deleteTitle} onClose={() => { if (!pending.current) setConfirm(undefined); }}>
      <section className="proton-confirm-dialog space-y-3 p-5">
        <DialogHeading title={t.delete} closeLabel={t.close} busy={busy} onClose={() => setConfirm(undefined)} />
        <p className="text-sm">{t.deleteHelp(confirm.name)}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button data-autofocus disabled={busy} onClick={() => setConfirm(undefined)}>{t.cancel}</Button>
          <Button variant="danger" disabled={busy} onClick={() => void change("remove", confirm.id)}>{t.delete}</Button>
        </div>
      </section>
    </ModalFrame>}
  </section>;
}
