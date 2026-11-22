import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { tickProtonBackup } from "../../lib/api/protonBackup";
import { useProtonBackupTick } from "./useProtonBackupTick";

vi.mock("../../lib/api/protonBackup", () => ({ tickProtonBackup: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it("checks the selected scope only while the app is visible and connected", () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.mocked(tickProtonBackup).mockReturnValue(new Promise(() => {}));
  const { rerender, unmount } = renderHook(({ active }) => useProtonBackupTick("account", "root", active),
    { initialProps: { active: false } });
  expect(tickProtonBackup).not.toHaveBeenCalled();

  rerender({ active: true });
  expect(tickProtonBackup).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  online.mockReturnValue(false);
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(tickProtonBackup).not.toHaveBeenCalled();

  online.mockReturnValue(true);
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(tickProtonBackup).toHaveBeenCalledWith({ accountId: "account", rootId: "root" }, expect.any(AbortSignal));
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(tickProtonBackup).toHaveBeenCalledOnce();
  const signal = vi.mocked(tickProtonBackup).mock.calls[0][1];
  unmount();
  expect(signal.aborted).toBe(true);
});
