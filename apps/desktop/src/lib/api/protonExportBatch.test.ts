import { expect, it } from "vitest";
import { validateProtonExportBatch } from "./protonExportBatch";
import type { ProtonExportBatch } from "../../types/protonExportBatch";
it("rejects a review from another root or claiming private drafts", () => {
  const scope = { accountId: "a", rootId: "r" };
  const value = { schemaVersion: 1, id: "export-batch-qa", projectId: "proton-qa", revision: "a".repeat(64), phase: "prepared", format: "md", profileName: null,
    documents: [{ source: "Acta.md", filename: "Acta.md", bytes: 4, sha256: "b".repeat(64) }], archiveSha256: "c".repeat(64), archiveBytes: 40,
    checkedAt: "2026-11-17T12:00:00Z", frozen: true, includesConfirmedDrafts: false,
    sourceMetadata: { ...scope, kind: "proton-saved-revisions", includesPrivateDrafts: false, results: [{ nodeId: "d", revisionId: "d~v", name: "Acta.md", status: "included" }] } } as ProtonExportBatch;
  expect(validateProtonExportBatch(value, scope)).toEqual(value);
  expect(() => validateProtonExportBatch(value, { ...scope, rootId: "other" })).toThrow(/carpeta/);
  expect(() => validateProtonExportBatch({ ...value, includesConfirmedDrafts: true } as unknown as ProtonExportBatch, scope)).toThrow(/carpeta/);
});
