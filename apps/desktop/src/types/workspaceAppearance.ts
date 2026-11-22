export const appearanceProfiles = {
  classic: { label: "Clásico", description: "Lateral oscuro, editor claro" },
  contrast: { label: "Contraste", description: "Fondos negro y blanco" },
  night: { label: "Nocturno", description: "Superficies oscuras" },
  reading: { label: "Lectura", description: "Superficies claras" },
} as const;

export const noteFonts = {
  "source-sans-3": "Source Sans 3",
  atkinson: "Atkinson Hyperlegible Next",
  "noto-serif": "Noto Serif",
  "noto-mono": "Noto Sans Mono",
} as const;

export const noteLineHeights = [1.3, 1.5, 1.75, 2] as const;
export const noteHeadingSizeLimits = { min: 18, max: 30 } as const;
export const workspaceColors = ["red", "orange", "amber", "yellow", "olive", "green", "teal", "cyan", "blue", "violet", "magenta", "wine"] as const;

export type WorkspaceProfile = keyof typeof appearanceProfiles;
export type WorkspaceColor = typeof workspaceColors[number];
export type NoteFont = keyof typeof noteFonts;
export type NoteLineHeight = typeof noteLineHeights[number];
export type WorkspaceAppearance = {
  language: "es" | "en";
  profile: WorkspaceProfile;
  primaryColor: WorkspaceColor;
  zoomPercent: number;
  noteFont: NoteFont;
  noteTextSize: number;
  noteHeadingSizePx: number;
  noteLineHeight: NoteLineHeight;
};

export const defaultWorkspaceAppearance: WorkspaceAppearance = {
  language: "es",
  profile: "classic",
  primaryColor: "orange",
  zoomPercent: 100,
  noteFont: "source-sans-3",
  noteTextSize: 16,
  noteHeadingSizePx: 22,
  noteLineHeight: 1.5,
};

export function normalizeWorkspaceAppearance(source: Record<string, unknown>, systemDark = false): WorkspaceAppearance {
  const defaults = defaultWorkspaceAppearance;
  const color = source.primaryColor === "lime" ? "olive" : source.primaryColor === "indigo" ? "blue"
    : source.primaryColor === "rose" ? "wine" : source.primaryColor;
  const legacyProfile = source.themeMode === "dark" || (source.themeMode === "system" && systemDark) ? "night"
    : source.themeMode === "light" ? "reading" : defaults.profile;
  const headingSize = source.noteHeadingSizePx === undefined
    ? bounded(source.noteHeadingSize, 28, 48, 28) - 6
    : source.noteHeadingSizePx;
  return {
    language: source.language === "en" ? "en" : "es",
    profile: source.profile === undefined ? legacyProfile : choice(source.profile, Object.keys(appearanceProfiles), defaults.profile),
    primaryColor: choice(color, workspaceColors, defaults.primaryColor),
    zoomPercent: bounded(source.zoomPercent, 85, 125, defaults.zoomPercent, 5),
    noteFont: choice(source.noteFont, Object.keys(noteFonts), defaults.noteFont),
    noteTextSize: bounded(source.noteTextSize, 12, 28, defaults.noteTextSize),
    noteHeadingSizePx: bounded(headingSize, noteHeadingSizeLimits.min, noteHeadingSizeLimits.max, defaults.noteHeadingSizePx),
    noteLineHeight: choice(source.noteLineHeight, noteLineHeights, defaults.noteLineHeight),
  };
}

function choice<T>(value: unknown, values: readonly unknown[], fallback: T): T {
  return values.includes(value) ? value as T : fallback;
}

function bounded(value: unknown, min: number, max: number, fallback: number, step = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value / step) * step)) : fallback;
}
