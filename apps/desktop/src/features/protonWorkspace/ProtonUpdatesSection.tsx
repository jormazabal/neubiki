import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { APP_VERSION } from "../../lib/appVersion";
import type { useProtonUpdater } from "./useProtonUpdater";
import { useDeviceSettingsCopy } from "../../lib/i18n/deviceSettingsCopy";

export function ProtonUpdatesSection({ controller, native, disabled, pendingSettings }: {
  controller: ReturnType<typeof useProtonUpdater>;
  native: boolean;
  disabled: boolean;
  pendingSettings: boolean;
}) {
  const c = useDeviceSettingsCopy().updates;
  const { state, check, install, returnToSettings } = controller;
  const update = "update" in state ? state.update : undefined;
  return <div className="proton-settings-section">
    <p className="text-sm text-ink-secondary">{c.installed} {APP_VERSION}</p>
    {update && <div className="space-y-2">
      <h2 className="font-semibold">Neubiki {update.version}</h2>
      {update.notes && <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm">{update.notes}</p>}
    </div>}
    {state.phase === "current" && <InlineNotice tone="neutral" announce="status">{c.current}</InlineNotice>}
    {state.phase === "unsupported" && <InlineNotice tone="neutral" announce="status">{c.unsupported}</InlineNotice>}
    {state.phase === "error" && <InlineNotice tone="error" announce="alert">{state.message}</InlineNotice>}
    {state.phase === "available" && <>
      {pendingSettings && <InlineNotice tone="warning">{c.pendingSettings}</InlineNotice>}
      <Button variant="primary" disabled={disabled || pendingSettings} onClick={() => void install()}>{c.install}</Button>
    </>}
    {(state.phase === "downloading" || state.phase === "installing") && <div className="space-y-2">
      <p role="status">{state.phase === "downloading" ? c.downloading : c.installing}</p>
      <ProgressBar label={c.progress} value={state.progress?.percent} />
    </div>}
    {state.phase === "installer" && <>
      {state.error ? <InlineNotice tone="error" announce="alert">{state.error}</InlineNotice>
        : <InlineNotice tone="neutral" announce="status">{c.installer}</InlineNotice>}
      <Button onClick={() => void returnToSettings()}>{c.back}</Button>
    </>}
    {(!controller.busy || state.phase === "checking") && state.phase !== "available" && state.phase !== "unsupported" &&
      <Button variant="primary" disabled={!native || disabled || controller.busy} onClick={() => void check()}>
        {state.phase === "checking" ? c.checking : c.check}
      </Button>}
  </div>;
}
