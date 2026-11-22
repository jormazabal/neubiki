import { afterEach, expect, it, vi } from "vitest";
import { requestJson } from "./client";
import { prepareProtonTemplateCapture, saveProtonTemplateCapture, checkProtonTemplateCapture, validateProtonTemplateCapture } from "./protonTemplateCapture";
import type { ProtonTemplateCapturePreview, ProtonTemplateCaptureRequest } from "../../types/protonTemplateCapture";
vi.mock("./client", () => ({ requestJson: vi.fn() })); afterEach(() => vi.resetAllMocks());
const source = { accountId: "acct", rootId: "v~root", nodeId: "v~doc", revisionId: "v~doc~r1" };
const preview: ProtonTemplateCapturePreview = { schemaVersion: 1, source: { ...source, name: "Acta.md" }, digest: "a".repeat(64), markdown: "# Guardado", resources: [], privateDraftsIncluded: false, complete: true, checkedAt: "2026-11-18T00:00:00Z" };
it("binds preparation to source and revision and rejects drafts or another source", async () => {
  vi.mocked(requestJson).mockResolvedValue(preview); expect(await prepareProtonTemplateCapture(source)).toEqual(preview);
  expect(requestJson).toHaveBeenCalledWith("/api/proton/templates/source/prepare", { method: "POST", timeoutMs: 240000, body: JSON.stringify(source) });
  expect(() => validateProtonTemplateCapture({ ...preview, source: { ...preview.source, revisionId: "v~doc~r2" } }, source)).toThrow();
  expect(() => validateProtonTemplateCapture({ ...preview, privateDraftsIncluded: true } as unknown as ProtonTemplateCapturePreview, source)).toThrow();
});
it("sends reviewed identity and metadata without document bytes and verifies the idempotent receipt", async () => {
  const input: ProtonTemplateCaptureRequest = { ...source, operationId: "template-capture-qa", digest: preview.digest, name: "Acta", description: "", acknowledge: true };
  vi.mocked(requestJson).mockResolvedValue({ schemaVersion: 1, operationId: input.operationId, digest: input.digest, state: "saved", checkedAt: preview.checkedAt,
    template: { id: "custom-template-capture-qa", name: "Acta", description: "", captureDigest: preview.digest, revision: "b".repeat(64) } });
  expect((await saveProtonTemplateCapture(input)).state).toBe("saved");
  expect(requestJson).toHaveBeenCalledWith("/api/proton/templates/capture", { method: "POST", timeoutMs: 240000, body: JSON.stringify(input) });
  expect(JSON.stringify(input)).not.toContain("markdown"); expect(JSON.stringify(input)).not.toContain("resources");
  vi.mocked(requestJson).mockResolvedValue({ schemaVersion: 1, operationId: "another", digest: input.digest, state: "not-recorded", template: null, checkedAt: preview.checkedAt });
  await expect(checkProtonTemplateCapture(input)).rejects.toThrow();
});
