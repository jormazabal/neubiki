/** Fixed layers measure viewport pixels, while their CSS offsets are scaled by zoom. */
export function floatingViewportPixels(pixels: number) {
  return document.documentElement.dataset.workspaceProfile
    ? `calc(${pixels}px / var(--appearance-portal-scale, 1))`
    : `${pixels}px`;
}
