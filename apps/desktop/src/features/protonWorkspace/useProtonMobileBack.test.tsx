import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useState } from "react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { useProtonMobileBack } from "./useProtonMobileBack";

const native = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ onBackButtonPress: native.register }));
vi.mock("../../lib/runtime/platform", () => ({ isTauriRuntime: () => true, isMobileDeviceRuntime: () => true }));

it("routes Android Back to the active modal before leaving the workspace view", async () => {
  const onBack = vi.fn();
  const unregister = vi.fn().mockResolvedValue(undefined);
  let back: (() => void) | undefined;
  native.register.mockImplementation(async handler => { back = handler; return { unregister }; });

  function Workspace() {
    const [open, setOpen] = useState(true);
    useProtonMobileBack(true, onBack);
    return <>
      <button type="button">Documento</button>
      {open && <ModalFrame label="Revisión" onClose={() => setOpen(false)}>
        <button type="button">Cerrar revisión</button>
      </ModalFrame>}
    </>;
  }

  const view = render(<Workspace />);
  await waitFor(() => expect(native.register).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("dialog", { name: "Revisión" })).toBeVisible();
  act(() => back?.());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onBack).not.toHaveBeenCalled();
  act(() => back?.());
  expect(onBack).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(unregister).toHaveBeenCalledTimes(1);
});
