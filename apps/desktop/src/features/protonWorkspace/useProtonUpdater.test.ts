import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkForUpdate, installUpdate } from "../../lib/runtime/updater";
import { useProtonUpdater } from "./useProtonUpdater";
import { createElement, type ReactNode } from "react";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../lib/runtime/platform", () => ({ isTauriRuntime: () => true, isMobileDeviceRuntime: () => false }));
vi.mock("../../lib/runtime/updater", () => ({ checkForUpdate: vi.fn(), installUpdate: vi.fn() }));

it("keeps a candidate without an update channel from consulting the provider", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(false);
  const { result } = renderHook(() => useProtonUpdater({ freeze: vi.fn(), unfreeze: vi.fn(), protect: async () => true, hasPendingSettings: () => false }));
  await act(() => result.current.check());
  expect(result.current.state.phase).toBe("unsupported");
  expect(checkForUpdate).not.toHaveBeenCalled();
});

it("protects work before install and releases the reservation after a failed install", async () => {
  const calls: string[] = [];
  vi.mocked(invoke).mockImplementation(async command => {
    calls.push(command);
    if (command === "desktop_update_channel_enabled") return true;
    if (command === "prepare_runtime_restart") return "restart-1";
    return undefined;
  });
  vi.mocked(checkForUpdate).mockResolvedValue({ supported: true, update: { currentVersion: "0.7.0", version: "0.8.0" } });
  vi.mocked(installUpdate).mockImplementation(async (progress, beforeInstall) => {
    progress?.({ downloadedBytes: 20, percent: 100 });
    await beforeInstall?.();
    calls.push("install");
    throw new Error("Instalación interrumpida.");
  });
  const { result } = renderHook(() => useProtonUpdater({
    freeze: () => calls.push("freeze"), unfreeze: () => calls.push("unfreeze"),
    protect: async () => { calls.push("protect"); return true; }, hasPendingSettings: () => false,
  }));
  await act(() => result.current.check());
  await act(() => result.current.install());
  expect(calls).toEqual(["desktop_update_channel_enabled", "freeze", "protect", "prepare_runtime_restart",
    "install", "release_runtime_restart", "unfreeze"]);
  expect(result.current.state).toEqual({ phase: "error", message: "No se pudo completar la actualización." });
});

it("localizes the visible error after changing language without checking again",async()=>{
  vi.mocked(invoke).mockRejectedValueOnce(new Error("No channel metadata"));
  let language: "en" | "es" = "en";
  const {result,rerender}=renderHook(()=>useProtonUpdater({freeze:vi.fn(),unfreeze:vi.fn(),protect:async()=>true,hasPendingSettings:()=>false}),{
    wrapper:({children}:{children:ReactNode})=>createElement(UiLocaleProvider,{language,children}),
  });
  await act(()=>result.current.check());
  expect(result.current.state).toEqual({phase:"error",message:"Updates could not be checked. Try again."});
  language = "es";
  rerender();
  expect(result.current.state).toEqual({phase:"error",message:"No se pudieron consultar las actualizaciones. Vuelve a intentarlo."});
});
