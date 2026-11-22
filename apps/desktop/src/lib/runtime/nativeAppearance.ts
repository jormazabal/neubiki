import type { ResolvedThemeMode } from "../theme/appearance";

declare global {
  interface Window {
    NeubikiAppearance?: {
      setTheme(dark: boolean): void;
      setWorkspaceFrame?(color: string, dark: boolean): void;
    };
  }
}

/** Older hosts and browser previews keep their normal CSS appearance. */
export function applyNativeAppearance(theme: ResolvedThemeMode, frameColor?: string) {
  if (typeof window === "undefined") return;
  try {
    const bridge = window.NeubikiAppearance;
    if (frameColor && bridge?.setWorkspaceFrame) bridge.setWorkspaceFrame(frameColor, theme === "dark");
    else bridge?.setTheme(theme === "dark");
  }
  catch { /* A native appearance failure must not interrupt document startup. */ }
}
