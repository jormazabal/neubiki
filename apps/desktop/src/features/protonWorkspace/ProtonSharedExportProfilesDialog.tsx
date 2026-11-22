import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { getExportProfiles } from "../../lib/api/portabilityWorkspace";
import { checkSharedExportProfiles, publishSharedExportProfiles, readSharedExportProfiles, type SharedExportProfiles, type SharedProfilesScope } from "../../lib/api/protonSharedProfiles";
import type { ExportProfiles } from "../../types/portabilityWorkspace";
import { protonSharedProfilesCopy } from "./protonSharedProfilesCopy";

type Props = { scope: SharedProfilesScope; connected: boolean; canWrite: boolean; onClose: () => void; onPending?: (pending: boolean) => void; fallbackFocus?: () => HTMLElement | null };
export function ProtonSharedExportProfilesDialog(props: Props) {
  return <ProfilesContent key={JSON.stringify([props.scope.accountId, props.scope.rootId])} {...props} />;
}
function ProfilesContent({ scope, connected, canWrite, onClose, onPending, fallbackFocus }: Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const t = protonSharedProfilesCopy[useUiLocale()];
  const [local, setLocal] = useState<ExportProfiles>();
  const [remote, setRemote] = useState<SharedExportProfiles>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!connected) return;
    const request = new AbortController();
    setBusy(true); setError("");
    void Promise.all([getExportProfiles(), readSharedExportProfiles(scope, request.signal)]).then(([local, remote]) => {
      if (!request.signal.aborted) { setLocal(local); setRemote(remote); setUncertain(remote.outcome === "unknown"); setBusy(false); }
    }, cause => { if (!request.signal.aborted) { setError(runtimeErrorMessage(cause, t.loadFailed)); setBusy(false); } });
    return () => request.abort();
  }, [scope.accountId, scope.rootId, connected, refresh]);

  async function publish() {
    if (!local?.revision || !remote || !connected || !canWrite || pending.current || uncertain) return;
    pending.current = true; onPending?.(true); setBusy(true); setError(""); setNotice(""); setConfirm(false);
    try {
      const next = await publishSharedExportProfiles(scope, remote, local.revision);
      if (!live.current) return;
      setRemote(next); setUncertain(next.outcome === "unknown");
      if (next.outcome === "confirmed") setNotice(t.published);
    } catch (cause) { if (live.current) { setUncertain(true); setError(runtimeErrorMessage(cause, t.publishFailed)); } }
    finally { pending.current = false; onPending?.(false); if (live.current) setBusy(false); }
  }
  async function check() {
    if (!connected || busy) return;
    setBusy(true); setError("");
    try {
      const next = await checkSharedExportProfiles(scope);
      if (!live.current) return;
      setRemote(next); setUncertain(next.outcome === "unknown");
    } catch (cause) { if (live.current) setError(runtimeErrorMessage(cause, t.loadFailed)); }
    finally { if (live.current) setBusy(false); }
  }
  function close() { if (!pending.current) onClose(); }
  function list(catalog: ExportProfiles["profiles"] | undefined, empty: string) {
    return catalog?.length ? <ul className="max-h-48 divide-y divide-line overflow-auto text-sm">{catalog.map(profile => <li key={profile.id} className="py-2">
      <strong className="break-words">{profile.name}</strong><p className="text-xs text-ink-secondary">{profile.cover ? t.cover : t.noCover} · {profile.contents ? t.contents : t.noContents}</p>
    </li>)}</ul> : <p className="text-sm text-ink-secondary">{empty}</p>;
  }
  return createPortal(<ModalFrame label={t.title} onClose={close} fallbackFocus={fallbackFocus}>
    <section className="proton-confirm-dialog space-y-3 p-5">
      <DialogHeading title={t.title} closeLabel={t.close} busy={pending.current} onClose={close} />
      <p className="text-sm">{t.help}</p><p className="text-xs text-ink-secondary">{t.safety}</p>
      {!connected && <InlineNotice tone="warning">{t.offline}</InlineNotice>}
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {notice && <InlineNotice tone="neutral" announce="status">{notice}</InlineNotice>}
      {uncertain && <InlineNotice tone="warning" action={<Button disabled={!connected || busy} onClick={() => void check()}>{t.check}</Button>}>{t.pending}</InlineNotice>}
      {busy && <p role="status">{pending.current ? t.publishing : t.loading}</p>}
      {local && remote && <div className="grid gap-4 sm:grid-cols-2">
        <section aria-label={t.device}><h3 className="text-sm font-semibold">{t.device}</h3>{list(local.profiles, t.emptyDevice)}</section>
        <section aria-label={t.project}><h3 className="text-sm font-semibold">{t.project}</h3>{list(remote.profiles, t.emptyProject)}</section>
      </div>}
      <p className="text-xs text-ink-secondary">{t.limit}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={!connected || busy} onClick={() => setRefresh(value => value + 1)}>{t.refresh}</Button>
        <Button variant="primary" disabled={!connected || !canWrite || !local?.revision || !remote || busy || uncertain} onClick={() => setConfirm(true)}>{t.publish}</Button>
      </div>
      {confirm && local && remote && <ModalFrame label={t.confirmTitle} onClose={() => setConfirm(false)} className="!z-[90]">
        <section className="proton-confirm-dialog space-y-3 p-5">
          <DialogHeading title={t.confirmTitle} closeLabel={t.close} onClose={() => setConfirm(false)} />
          <p className="text-sm">{t.confirmHelp(local.profiles.length, remote.profiles.length)}</p>
          {list(local.profiles, t.emptyDevice)}
          <div className="flex justify-end gap-2"><Button onClick={() => setConfirm(false)}>{t.cancel}</Button><Button variant="primary" onClick={() => void publish()}>{t.confirm}</Button></div>
        </section>
      </ModalFrame>}
    </section>
  </ModalFrame>, document.body);
}
