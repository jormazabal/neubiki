import type { ProtonBatchScope, ProtonExportBatch } from "./protonExportBatch";
import type { ProjectPackageManifest } from "./projectTransfer";
export type ProtonPackage = Omit<ProtonExportBatch, "format" | "sourceMetadata"> & {
  format: "project"; sourceMetadata: ProtonBatchScope & { kind: "proton-project-package"; includesPrivateDrafts: false; manifest: ProjectPackageManifest;
    results: Array<{ path: string; status: "included" | "omitted"; nodeId?: string; revisionId?: string; detail?: string }> };
};
