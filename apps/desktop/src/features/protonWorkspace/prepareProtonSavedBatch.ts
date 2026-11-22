import { exportCopy } from "../../lib/i18n/exportCopy";
import type { UiLanguage } from "../../lib/i18n/uiCopy";
import { getExportTemplate } from "../../lib/api/config";
import { readDocument } from "../../lib/api/protonWorkspace";
import { prepareProtonExportBatch } from "../../lib/api/protonExportBatch";
import type { ExportProfile, ExportProfiles } from "../../types/portabilityWorkspace";
import type { ProtonBatchScope } from "../../types/protonExportBatch";
import type { ProtonNode } from "../../types/protonWorkspace";
import type { ExportDiagramResolution } from "../../types/domain";
export async function prepareProtonSavedBatch(scope: ProtonBatchScope, nodes: ProtonNode[], format: "pdf" | "docx" | "md", catalog: ExportProfiles,
  profileId: string, progress: (text: string) => void, profileSource?: "device" | "project", language: UiLanguage = "es") {
  const c = exportCopy[language];
  const profile = format === "md" ? undefined : catalog.profiles.find(item => item.id === profileId);
  if (profileId && format !== "md" && !profile || profile && !catalog.revision) throw Error(c.profileRefresh);
  const resolution = format === "md" ? undefined : profile ? diagramResolution(profile) : (await getExportTemplate()).document.diagramResolution;
  const documents: Array<{ nodeId: string; revisionId: string; name: string; diagramAssets?: unknown }> = [];
  for (const [index, node] of nodes.entries()) {
    if (!node.revisionId) throw Error(c.sourceRefresh(node.name));
    progress(c.reviewing(index + 1, nodes.length, node.name));
    let diagramAssets: unknown;
    if (format !== "md" && resolution) {
      // Rendering uses only the saved text; the native preparation reads and verifies the same revision again.
      // A failed read/render remains an omission reported by the native per-file review.
      try {
        const saved = await readDocument({ ...scope, nodeId: node.nodeId });
        if (saved.revisionId === node.revisionId && saved.markdown !== null) {
          const { prepareMermaidDiagramAssets } = await import("../editor/mermaidDiagrams");
          diagramAssets = await prepareMermaidDiagramAssets(saved.markdown, resolution);
        }
      } catch { /* Native capture provides the authoritative per-file result. */ }
    }
    documents.push({ nodeId: node.nodeId, revisionId: node.revisionId, name: node.name, ...(diagramAssets ? { diagramAssets } : {}) });
  }
  progress(c.preparingBatch);
  return prepareProtonExportBatch(scope, documents, format, profile && catalog.revision ? { id: profile.id, revision: catalog.revision, ...(profileSource ? { source: profileSource } : {}) } : undefined);
}
function diagramResolution(profile: ExportProfile): ExportDiagramResolution {
  const value = (profile.style as { document?: { diagramResolution?: unknown } })?.document?.diagramResolution;
  return value === "low" || value === "high" ? value : "medium";
}
