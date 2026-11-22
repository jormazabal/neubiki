import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { isMobileDeviceRuntime, isTauriRuntime } from "../../lib/runtime/platform";
import { protectUpdateInstallation, releaseUpdateInstallation } from "../../lib/runtime/updateProtection";
import { checkForUpdate, installUpdate, type AvailableUpdate, type UpdateDownloadProgress } from "../../lib/runtime/updater";
import { useDeviceSettingsCopy } from "../../lib/i18n/deviceSettingsCopy";
import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";

type UpdateState =
  | { phase: "idle" | "checking" | "unsupported" | "current" }
  | { phase: "available"; update: AvailableUpdate }
  | { phase: "downloading" | "installing"; update: AvailableUpdate; progress?: UpdateDownloadProgress }
  | { phase: "installer"; update: AvailableUpdate; error?: string }
  | { phase: "error"; message: string };

type Protection = Pick<Parameters<typeof protectUpdateInstallation>[0], "freeze" | "unfreeze" | "protect" | "hasPendingSettings">;
type UpdateIssue = { cause: unknown; fallback: "checkFailed" | "restoreFailed" | "failed" };
type ControllerState = Exclude<UpdateState, { phase: "installer" | "error" }>
  | { phase: "installer"; update: AvailableUpdate; issue?: UpdateIssue }
  | { phase: "error"; issue: UpdateIssue };

export function useProtonUpdater(protection: Protection) {
  const c = useDeviceSettingsCopy().updates;
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const [controllerState, setState] = useState<ControllerState>({ phase: "idle" });
  const state: UpdateState = controllerState.phase === "error"
    ? { phase: "error", message: runtimeErrorMessage(controllerState.issue.cause, c[controllerState.issue.fallback]) }
    : controllerState.phase === "installer"
      ? { phase: "installer", update: controllerState.update,
        error: controllerState.issue ? runtimeErrorMessage(controllerState.issue.cause, c[controllerState.issue.fallback]) : undefined }
      : controllerState;
  const active = useRef(false);
  const reservation = useRef<string | null>(null);

  async function check() {
    if (active.current || reservation.current || !isTauriRuntime()) return;
    active.current = true;
    setState({ phase: "checking" });
    try {
      if (!isMobileDeviceRuntime() && !await invoke<boolean>("desktop_update_channel_enabled")) {
        setState({ phase: "unsupported" });
        return;
      }
      const { supported, update } = await checkForUpdate();
      if (update) setState({ phase: "available", update });
      else setState({ phase: supported ? "current" : "unsupported" });
    } catch (cause) {
      setState({ phase: "error", issue: { cause, fallback: "checkFailed" } });
    } finally {
      active.current = false;
    }
  }

  async function release() {
    if (!reservation.current) return;
    await releaseUpdateInstallation(reservation.current);
    reservation.current = null;
    protection.unfreeze();
  }

  async function install() {
    const update = state.phase === "available" ? state.update : undefined;
    if (!update || active.current || reservation.current || protection.hasPendingSettings()) return;
    active.current = true;
    setState({ phase: "downloading", update });
    try {
      await installUpdate(progress => {
        setState({ phase: progress.percent === 100 ? "installing" : "downloading", update, progress });
      }, async () => {
        reservation.current = await protectUpdateInstallation(protection);
        if (!isMobileDeviceRuntime()) setState({ phase: "installing", update });
      });
      setState({ phase: "installer", update });
    } catch (cause) {
      const issue = { cause, fallback: "failed" } as const;
      try {
        await release();
        // A new check is required after a failure to refresh the pending native update.
        setState({ phase: "error", issue });
      } catch {
        setState({ phase: "installer", update, issue });
      }
    } finally {
      active.current = false;
    }
  }

  async function returnToSettings() {
    if (active.current || state.phase !== "installer") return;
    active.current = true;
    try {
      await release();
      setState({ phase: "idle" });
    } catch (cause) {
      setState({ phase: "installer", update: state.update, issue: { cause, fallback: "restoreFailed" } });
    } finally {
      active.current = false;
    }
  }

  return { state, check, install, returnToSettings, busy: ["checking", "downloading", "installing", "installer"].includes(state.phase) };
}
