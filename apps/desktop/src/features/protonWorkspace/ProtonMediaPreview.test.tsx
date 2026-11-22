import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProtonMediaPreview } from "./ProtonMediaPreview";
import { matchesMediaHeader, protonMediaFormat } from "./protonMediaFormat";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("creates a bounded local media URL without autoplay and releases it after replacement", () => {
  const create = vi.fn().mockReturnValueOnce("blob:one").mockReturnValueOnce("blob:two");
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const { container, rerender, unmount } = render(<ProtonMediaPreview name="Audio.wav" contentBase64={btoa("RIFF0000WAVEdata")} onReload={vi.fn()} />);
  const audio = container.querySelector("audio")!;
  expect(audio).toHaveAttribute("controls");
  expect(audio).not.toHaveAttribute("autoplay");
  expect(audio).toHaveAttribute("preload", "metadata");
  rerender(<ProtonMediaPreview name="Audio.wav" contentBase64={btoa("RIFF0000WAVEdata2")} onReload={vi.fn()} />);
  expect(revoke).toHaveBeenCalledWith("blob:one");
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:two");
});

it("rejects mismatched headers before decoder use and exposes decoder errors", () => {
  const create = vi.fn().mockReturnValue("blob:media");
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  const { container, rerender } = render(<ProtonMediaPreview name="Clip.mp4" contentBase64={btoa("<html>invalid</html>")} onReload={vi.fn()} />);
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("no pudo reproducir");
  rerender(<ProtonMediaPreview name="Clip.mp4" contentBase64={btoa("0000ftypisom")} onReload={vi.fn()} />);
  fireEvent.error(container.querySelector("video")!);
  expect(screen.getByRole("alert")).toBeVisible();
  expect(container.querySelector("video")).toBeNull();
});

it("only recognizes supported container signatures", () => {
  expect(protonMediaFormat("Clip.MP4")?.kind).toBe("video");
  expect(protonMediaFormat("page.html")).toBeNull();
  expect(matchesMediaHeader(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "video/webm")).toBe(true);
  expect(matchesMediaHeader(new Uint8Array([]), "audio/mpeg")).toBe(false);
});
