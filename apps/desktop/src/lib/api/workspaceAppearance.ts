import { normalizeWorkspaceAppearance, type WorkspaceAppearance } from "../../types/workspaceAppearance";
import { requestJson } from "./client";

type ConfigPayload = { appearance?: Record<string, unknown> };

export async function loadWorkspaceAppearance(systemDark: boolean) {
  const raw = (await requestJson<ConfigPayload>("/api/config")).appearance ?? {};
  return {
    value: normalizeWorkspaceAppearance(raw, systemDark),
    migrate: (raw.profile === undefined && raw.themeMode !== undefined)
      || (raw.noteHeadingSizePx === undefined && raw.noteHeadingSize !== undefined),
  };
}

export async function saveWorkspaceAppearance(appearance: WorkspaceAppearance) {
  const config = await requestJson<ConfigPayload>("/api/config", {
    method: "PUT",
    body: JSON.stringify({ appearance }),
  });
  if (!config.appearance || Object.entries(appearance).some(([key, value]) => config.appearance?.[key] !== value)) {
    throw new Error("El runtime no confirmó las preferencias de apariencia.");
  }
}
