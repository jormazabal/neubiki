import { onBackButtonPress } from "@tauri-apps/api/app";
import { useEffect, useRef } from "react";
import { isMobileDeviceRuntime, isTauriRuntime } from "../../lib/runtime/platform";

function sendEscape(scope: HTMLElement) {
  const active = document.activeElement;
  const target = active instanceof HTMLElement && scope.contains(active) ? active : scope;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

export function useProtonMobileBack(intercept: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!intercept || !isTauriRuntime() || !isMobileDeviceRuntime()) return;
    let stopped = false;
    let unsubscribe: (() => Promise<void>) | undefined;
    void onBackButtonPress(() => {
      if (stopped) return;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
      const activeDialog = dialogs.reverse().find(dialog => !dialog.closest("[hidden],[inert]"));
      if (activeDialog) {
        sendEscape(activeDialog);
        return;
      }
      const focused = document.activeElement;
      const menu = focused?.closest<HTMLElement>('[role="menu"]')
        ?? document.querySelector<HTMLElement>(".proton-tree-context")
        ?? document.querySelector<HTMLElement>(".proton-account-popover");
      if (menu) {
        sendEscape(menu);
        return;
      }
      const mode = document.querySelector<HTMLElement>(".proton-workspace-mode");
      const tools = document.querySelector<HTMLElement>('.proton-document-pane[data-tool-open="true"]');
      const context = mode ?? (window.innerWidth < 768 ? tools : null);
      if (context) sendEscape(context);
      else latest.current();
    }).then(listener => {
      if (stopped) return listener.unregister();
      unsubscribe = () => listener.unregister();
    }).catch(() => { /* All navigational actions also have visible controls. */ });
    return () => { stopped = true; void unsubscribe?.().catch(() => undefined); };
  }, [intercept]);
}
