import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspaceAppearance, saveWorkspaceAppearance } from "../../lib/api/workspaceAppearance";
import { getSurfaceTones, headingSizes, profilePreview, surfaceInks } from "../../lib/theme/workspaceTheme";
import { workspacePalettes } from "../../lib/theme/workspacePalettes";
import { appearanceProfiles, defaultWorkspaceAppearance, normalizeWorkspaceAppearance, workspaceColors,
  type WorkspaceProfile } from "../../types/workspaceAppearance";
import { useWorkspaceAppearance } from "./useWorkspaceAppearance";
import { WorkspaceAppearanceForm } from "./WorkspaceAppearanceForm";

vi.mock("../../lib/api/workspaceAppearance", () => ({
  loadWorkspaceAppearance: vi.fn(),
  saveWorkspaceAppearance: vi.fn(),
}));

function Settings() {
  return <WorkspaceAppearanceForm {...useWorkspaceAppearance()} />;
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { resolve, promise };
}

beforeEach(() => {
  vi.mocked(loadWorkspaceAppearance).mockReset().mockResolvedValue({ value: defaultWorkspaceAppearance, migrate: false });
  vi.mocked(saveWorkspaceAppearance).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("workspace appearance", () => {
  it("preserves the stored interface language, saves it through the appearance owner and updates assistive language", async () => {
    expect(normalizeWorkspaceAppearance({language:"en"}).language).toBe("en");
    expect(normalizeWorkspaceAppearance({language:"unsupported"}).language).toBe("es");
    render(<Settings />);
    const language=screen.getByRole("combobox",{name:"Idioma de la interfaz"});
    await waitFor(()=>expect(language).toBeEnabled());
    fireEvent.change(language,{target:{value:"en"}});
    expect(screen.getByRole("combobox",{name:"Interface language"})).toHaveValue("en");
    expect(document.documentElement.lang).toBe("en");
    await waitFor(()=>expect(saveWorkspaceAppearance).toHaveBeenCalledWith(expect.objectContaining({language:"en"})));
    await waitFor(()=>expect(screen.getByRole("status")).toHaveTextContent("Changes saved"));
  });
  it("updates Android bars from the frame while keeping the editor scheme separate", async () => {
    const setWorkspaceFrame = vi.fn();
    const setTheme = vi.fn();
    vi.stubGlobal("NeubikiAppearance", { setTheme, setWorkspaceFrame });
    render(<Settings />);
    const reading = screen.getByRole("radio", { name: "Lectura" });
    await waitFor(() => expect(reading).toBeEnabled());
    expect(setWorkspaceFrame).toHaveBeenLastCalledWith(workspacePalettes.orange.dark.frame, true);
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(screen.getByRole("radio", { name: "Contraste" }));
    expect(setWorkspaceFrame).toHaveBeenLastCalledWith("#000000", true);
    fireEvent.click(reading);
    fireEvent.click(screen.getByRole("radio", { name: "Oliva" }));
    expect(setWorkspaceFrame).toHaveBeenLastCalledWith(workspacePalettes.olive.light.frame, false);
    fireEvent.click(screen.getByRole("radio", { name: "Nocturno" }));
    expect(setWorkspaceFrame).toHaveBeenLastCalledWith(workspacePalettes.olive.dark.frame, true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    const calls = setWorkspaceFrame.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Escala de la interfaz"), { target: { value: "125" } });
    expect(setWorkspaceFrame).toHaveBeenCalledTimes(calls);
    expect(setTheme).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados"));
  });

  it("changes profile, colors and typography independently and serializes the latest save", async () => {
    const first = deferred();
    vi.mocked(saveWorkspaceAppearance).mockReturnValueOnce(first.promise);
    const view = render(<Settings />);
    const night = screen.getByRole("radio", { name: "Nocturno" });
    await waitFor(() => expect(night).toBeEnabled());
    expect(screen.getAllByRole("radio")).toHaveLength(16);
    fireEvent.click(night);
    fireEvent.click(screen.getByRole("radio", { name: "Oliva" }));
    fireEvent.change(screen.getByLabelText("Tamaño de los títulos"), { target: { value: "24" } });
    expect(document.documentElement.dataset.workspaceProfile).toBe("night");
    expect(document.documentElement.style.getPropertyValue("--note-h1")).toBe("24px");
    expect(screen.getByLabelText("Tamaño del texto normal")).toHaveValue("16");
    expect(saveWorkspaceAppearance).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Guardando");
    await act(async () => first.resolve());
    expect(saveWorkspaceAppearance).toHaveBeenCalledTimes(2);
    expect(saveWorkspaceAppearance).toHaveBeenLastCalledWith({
      ...defaultWorkspaceAppearance, profile: "night", primaryColor: "olive", noteHeadingSizePx: 24,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados");
    view.unmount();
    expect(document.documentElement.dataset.workspaceProfile).toBeUndefined();
  });

  it("reports a failed write, retries the visible value and restores the initial settings", async () => {
    vi.mocked(saveWorkspaceAppearance).mockRejectedValueOnce(new Error("disk full"));
    render(<Settings />);
    const reading = screen.getByRole("radio", { name: "Lectura" });
    await waitFor(() => expect(reading).toBeEnabled());
    fireEvent.click(reading);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron guardar");
    expect(reading).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados"));
    fireEvent.click(screen.getByRole("button", { name: "Restablecer apariencia" }));
    await waitFor(() => expect(saveWorkspaceAppearance).toHaveBeenLastCalledWith(defaultWorkspaceAppearance));
  });

  it("resolves the old System preference only when there is no stored profile", () => {
    expect(normalizeWorkspaceAppearance({ themeMode: "system", primaryColor: "lime" }, true))
      .toMatchObject({ profile: "night", primaryColor: "olive" });
    expect(normalizeWorkspaceAppearance({ themeMode: "light" }, true).profile).toBe("reading");
    expect(normalizeWorkspaceAppearance({ themeMode: "system", profile: "classic" }, true).profile).toBe("classic");
    expect(normalizeWorkspaceAppearance({ profile: "invalid", noteTextSize: 90, noteLineHeight: 1.55 }))
      .toMatchObject({ profile: "classic", noteTextSize: 28, noteLineHeight: 1.5 });
  });

  it("compacts legacy heading sizes and offers options at least as large as the body text", async () => {
    expect(normalizeWorkspaceAppearance({ noteHeadingSize: 28 }).noteHeadingSizePx).toBe(22);
    expect(normalizeWorkspaceAppearance({ noteHeadingSize: 48 }).noteHeadingSizePx).toBe(30);
    expect(normalizeWorkspaceAppearance({ noteHeadingSize: 28, noteHeadingSizePx: 28 }).noteHeadingSizePx).toBe(28);
    expect(headingSizes(16, 22)).toEqual([22, 21, 19, 18, 17, 16]);
    expect(headingSizes(24, 18)).toEqual([24, 24, 24, 24, 24, 24]);

    render(<Settings />);
    const headings = screen.getByRole<HTMLSelectElement>("combobox", { name: "Tamaño de los títulos" });
    await waitFor(() => expect(headings).toBeEnabled());
    expect(headings).toHaveValue("22");
    expect(headings.options[0].value).toBe("18");
    expect(headings.options[headings.options.length - 1].value).toBe("30");
    fireEvent.change(screen.getByLabelText("Tamaño del texto normal"), { target: { value: "24" } });
    expect(headings).toHaveValue("24");
    expect(headings.options[0].value).toBe("24");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados"));
  });

  it("matches the sidebar preview to the frame and retains contrast in all 48 combinations", () => {
    for (const color of workspaceColors) {
      const palette = workspacePalettes[color];
      expect(ratio(palette.swatch, palette.mark)).toBeGreaterThanOrEqual(4.5);
      for (const profile of Object.keys(appearanceProfiles) as WorkspaceProfile[]) {
        const frameMode = profile === "reading" ? "light" : "dark";
        expect(profilePreview(profile, color)).toHaveProperty("--preview-rail", getSurfaceTones(color, profile, frameMode).frame);
        const modes = profile === "night" ? ["dark"] as const : profile === "reading" ? ["light"] as const : ["dark", "light"] as const;
        for (const mode of modes) {
          const tones = getSurfaceTones(color, profile, mode);
          const inks = surfaceInks[mode];
          const mixed = modes.length === 2;
          const backgrounds = mixed ? mode === "dark" ? [tones.frame] : [tones.editor, tones.tools]
            : [tones.frame, tones.editor, tones.tools];
          if (profile === "contrast") expect(backgrounds.every(bg => bg === (mode === "dark" ? "#000000" : "#FFFFFF"))).toBe(true);
          for (const bg of [...backgrounds, tones.elevated, tones.hover, tones.selected]) {
            for (const fg of [inks.text, inks.muted, tones.ink]) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
            expect(ratio(tones.border, bg)).toBeGreaterThanOrEqual(3);
            for (const action of [tones.action, tones.actionHover, tones.pressed]) {
              expect(ratio(action, bg)).toBeGreaterThanOrEqual(3);
              expect(ratio(action, inks.onAction)).toBeGreaterThanOrEqual(4.5);
            }
          }
          expect(ratio("#FFFFFF", tones.logo)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

function ratio(first: string, second: string) {
  const luminance = (hex: string) => hex.slice(1).match(/../g)!.reduce((sum, value, index) => {
    const srgb = parseInt(value, 16) / 255;
    const linear = srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4;
    return sum + linear * [.2126, .7152, .0722][index];
  }, 0);
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
}
