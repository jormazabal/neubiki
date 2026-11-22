import { useEffect } from "react";
import { tickProtonBackup } from "../../lib/api/protonBackup";

export function useProtonBackupTick(accountId: string | undefined, rootId: string | undefined, active: boolean) {
  useEffect(() => {
    if (!active || !accountId || !rootId) return;
    const scope = { accountId, rootId };
    let pending: AbortController | null = null;
    const tick = () => {
      if (pending || document.hidden || !navigator.onLine) return;
      const request = new AbortController();
      pending = request;
      void tickProtonBackup(scope, request.signal).catch(() => {
        // Package status is available in the scheduled-backup controls.
      }).finally(() => { if (pending === request) pending = null; });
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); pending?.abort(); };
  }, [accountId, rootId, active]);
}
