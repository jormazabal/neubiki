import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { FloatingLayer, placeFloatingLayer } from "./FloatingLayer";

afterEach(cleanup);
function Panel({ hidden }: { hidden: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  return <section hidden={hidden}><button ref={anchor}>Abrir</button><FloatingLayer anchorRef={anchor} width={240}><button>Acción flotante</button></FloatingLayer></section>;
}

const viewport = { left: 0, top: 0, width: 1000, height: 700 };
describe("floating layer placement", () => {
  it("escapes the panel but follows its visibility when it closes and reopens", async () => {
    const { container, rerender } = render(<Panel hidden={false}/>);
    expect(container.contains(screen.getByRole("button", { name: "Acción flotante" }))).toBe(false);
    rerender(<Panel hidden/>);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Acción flotante" })).not.toBeInTheDocument());
    rerender(<Panel hidden={false}/>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Acción flotante" })).toBeVisible());
  });
  it("opens below a trigger near the top and above one near the bottom", () => {
    const size = { width: 240, height: 300 };
    expect(placeFloatingLayer({ left: 850, right: 890, top: 30, bottom: 60 }, size, viewport, false, "start")).toMatchObject({ left: 752, top: 66 });
    expect(placeFloatingLayer({ left: 850, right: 890, top: 650, bottom: 680 }, size, viewport, false, "end")).toMatchObject({ left: 650, top: 344 });
  });
  it("flips nested menus away from either window edge", () => {
    const size = { width: 240, height: 200 };
    expect(placeFloatingLayer({ left: 760, right: 980, top: 600, bottom: 632 }, size, viewport, true, "start")).toEqual({ left: 514, top: 492, overlap: false });
    expect(placeFloatingLayer({ left: 8, right: 228, top: 200, bottom: 232 }, size, viewport, true, "start")).toEqual({ left: 234, top: 200, overlap: false });
  });
  it("uses a bounded overlapping layer when neither side fits", () => {
    expect(placeFloatingLayer({ left: 100, right: 340, top: 200, bottom: 230 }, { width: 256, height: 250 }, { ...viewport, width: 500 }, true, "start")).toEqual({ left: 100, top: 200, overlap: true });
  });
  it("keeps oversized content inside the visible viewport when a keyboard reduces it", () => {
    expect(placeFloatingLayer({ left: 350, right: 390, top: 500, bottom: 532 }, { width: 760, height: 640 }, { left: 0, top: 100, width: 390, height: 300 }, false, "start")).toMatchObject({ left: 8, top: 108 });
  });
});
