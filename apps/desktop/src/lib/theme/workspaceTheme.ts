import type { CSSProperties } from "react";
import type { WorkspaceAppearance, WorkspaceColor, WorkspaceProfile } from "../../types/workspaceAppearance";
import { applyNativeAppearance } from "../runtime/nativeAppearance";
import { workspacePalettes, type SurfaceMode } from "./workspacePalettes";

const neutralSurfaces = {
  light: { frame: "#FFFFFF", editor: "#FFFFFF", tools: "#FFFFFF", elevated: "#FFFFFF",
    divider: "#DEDEDE", border: "#676767", hover: "#F0F0F0", selected: "#E7E7E7" },
  dark: { frame: "#000000", editor: "#000000", tools: "#000000", elevated: "#171717",
    divider: "#333333", border: "#959595", hover: "#222222", selected: "#353535" },
};

export const surfaceInks = {
  light: { text: "#1E211F", muted: "#525B55", disabled: "#7C817C", onAction: "#FFFFFF",
    connectionBg: "#E7F5F0", connection: "#185444", successBg: "#E8F5EB", success: "#174F30",
    warningBg: "#FFF3D4", warning: "#6E470B", errorBg: "#FCEBEB", error: "#8C2529" },
  dark: { text: "#F1F3EE", muted: "#C1C8BE", disabled: "#81877E", onAction: "#161A15",
    connectionBg: "#183A30", connection: "#BCEBD9", successBg: "#173B27", success: "#ADE8BB",
    warningBg: "#3F300F", warning: "#FFE29A", errorBg: "#481F24", error: "#FFD2D3" },
};

export function getSurfaceTones(color: WorkspaceColor, profile: WorkspaceProfile, mode: SurfaceMode) {
  const tones = workspacePalettes[color][mode];
  return profile === "contrast" ? { ...tones, ...neutralSurfaces[mode] } : tones;
}

export function profilePreview(profile: WorkspaceProfile, color: WorkspaceColor): CSSProperties {
  const frame = getSurfaceTones(color, profile, profile === "reading" ? "light" : "dark");
  const content = getSurfaceTones(color, profile, profile === "night" ? "dark" : "light");
  return {
    "--preview-rail": frame.frame, "--preview-rail-ink": frame.ink, "--preview-editor": content.editor,
    "--preview-tools": content.tools, "--preview-ink": content.ink, "--preview-logo": frame.logo,
    "--preview-divider": content.divider,
  } as CSSProperties;
}

export function applyNativeWorkspaceFrame(profile: WorkspaceProfile, color: WorkspaceColor) {
  const frameMode = profile === "reading" ? "light" : "dark";
  applyNativeAppearance(frameMode, getSurfaceTones(color, profile, frameMode).frame);
}

export function headingSizes(body: number, title: number) {
  const difference = Math.max(0, title - body);
  return [1, .75, .56, .38, .19, 0].map(ratio => Math.round(body + ratio * difference));
}

export function applyWorkspaceAppearance(appearance: WorkspaceAppearance) {
  const root = document.documentElement;
  const previous = { profile: root.dataset.workspaceProfile, theme: root.dataset.theme, font: root.dataset.noteFont, language:root.lang };
  const vars = new Map<string, string>();
  const add = (key: string, value: string) => {
    if (!vars.has(key)) vars.set(key, root.style.getPropertyValue(key));
    root.style.setProperty(key, value);
  };
  const dark = appearance.profile === "night";
  root.dataset.workspaceProfile = appearance.profile;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.noteFont = appearance.noteFont;
  root.lang = appearance.language;

  for (const mode of ["light", "dark"] as const) {
    const tokens = { ...getSurfaceTones(appearance.primaryColor, appearance.profile, mode), ...surfaceInks[mode] };
    for (const [name, value] of Object.entries(tokens)) {
      add(`--appearance-${mode}-${name}`, value.match(/[\da-f]{2}/gi)!.map(c => parseInt(c, 16)).join(" "));
    }
  }
  const interfaceScale = appearance.zoomPercent / 100;
  add("--appearance-scale", String(interfaceScale));
  add("--note-inverse-scale", String(1 / interfaceScale));
  add("--note-size", `${appearance.noteTextSize}px`);
  add("--note-leading", String(appearance.noteLineHeight));
  headingSizes(appearance.noteTextSize, appearance.noteHeadingSizePx)
    .forEach((size, index) => add(`--note-h${index + 1}`, `${size}px`));

  return () => {
    root.lang = previous.language;
    for (const [key, value] of vars) {
      if (value) root.style.setProperty(key, value);
      else root.style.removeProperty(key);
    }
    for (const [key, value] of Object.entries({ workspaceProfile: previous.profile, theme: previous.theme, noteFont: previous.font })) {
      if (value === undefined) delete root.dataset[key];
      else root.dataset[key] = value;
    }
  };
}
