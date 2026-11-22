import { afterEach, expect, it, vi } from "vitest";
import { requestJson } from "./client";
import { checkProtonSharedTemplates, importProtonTemplates, listProtonSharedTemplates, publishProtonTemplates, reviewProtonTemplateImport, reviewProtonTemplatePublish } from "./protonSharedTemplates";
vi.mock("./client", () => ({ requestJson: vi.fn() })); afterEach(() => vi.resetAllMocks());
const scope = { accountId: "account", rootId: "v~root" }; const digest = "a".repeat(64); const checkedAt = "2026-11-18T00:00:00Z";
const source = { nodeId: "v~catalog", name: "Actas.neubiki-templates.json", type: "file", revisionId: "v~catalog~r1" } as const;
const catalog = [{ index: 0, name: "Acta", description: "", markdown: "# Guardado", variables: [], resources: [] }];
const review = { ...scope, schemaVersion: 1, digest, reviewDigest: "b".repeat(64), checkedAt, byteLength: 100, catalog };
it("binds reviews to scope, exact source revision and the 8 MiB bounded catalogue", async () => {
  const input = { ...scope, nodeId: source.nodeId, revisionId: source.revisionId, entries: [] };
  vi.mocked(requestJson).mockResolvedValue({ ...review, source, outcomes: [] }); expect((await reviewProtonTemplateImport(input)).source).toEqual(source);
  vi.mocked(requestJson).mockResolvedValue({ ...review, source: { ...source, revisionId: "v~catalog~r2" }, outcomes: [] }); await expect(reviewProtonTemplateImport(input)).rejects.toThrow();
  vi.mocked(requestJson).mockResolvedValue({ ...review, source, outcomes: [], byteLength: 8 * 1024 ** 2 + 1 }); await expect(reviewProtonTemplateImport(input)).rejects.toThrow();
  vi.mocked(requestJson).mockResolvedValue({ ...review, accountId: "other", name: source.name }); await expect(reviewProtonTemplatePublish({ ...scope, name: source.name, entries: [{ id: "custom-a", revision: digest }] })).rejects.toThrow();
});
it("sends only reviewed identities and metadata, and rejects receipts for another operation", async () => {
  const publish = { ...scope, name: source.name, entries: [{ id: "custom-a", revision: digest }], operationId: "template-publish-qa", digest, reviewDigest: review.reviewDigest, acknowledge: true as const };
  vi.mocked(requestJson).mockResolvedValue({ ...scope, schemaVersion: 1, purpose: "publish", operationId: publish.operationId, digest, name: source.name, state: "confirmed", active: false, node: source, checkedAt });
  expect((await publishProtonTemplates(publish)).state).toBe("confirmed");
  expect(requestJson).toHaveBeenCalledWith("/api/proton/templates/shared/publish", { method: "POST", timeoutMs: 240000, body: JSON.stringify(publish) });
  expect(JSON.stringify(publish)).not.toContain("markdown"); expect(JSON.stringify(publish)).not.toContain("dataBase64");
  const input = { ...scope, nodeId: source.nodeId, revisionId: source.revisionId, entries: [{ index: 0, name: "Copia" }], operationId: "template-import-qa", digest, reviewDigest: review.reviewDigest, acknowledge: true as const, reviewedResources: true as const };
  vi.mocked(requestJson).mockResolvedValue({ ...scope, schemaVersion: 1, purpose: "import", operationId: "template-import-other", digest, state: "complete", active: false, source, outcomes: [], checkedAt });
  await expect(importProtonTemplates(input)).rejects.toThrow();
});
it("loads local receipts without requesting a remote listing and accepts a bounded missing receipt", async () => {
  vi.mocked(requestJson).mockResolvedValue({ ...scope, schemaVersion: 1, items: [], attempts: [], offset: 0, totalAttempts: 0, partial: false, checkedAt });
  await listProtonSharedTemplates(scope); expect(requestJson).toHaveBeenCalledWith("/api/proton/templates/shared/list", { method: "POST", timeoutMs: 240000, body: JSON.stringify(scope) });
  const input = { ...scope, purpose: "import" as const, operationId: "template-import-qa" };
  vi.mocked(requestJson).mockResolvedValue({ ...input, schemaVersion: 1, state: "not-recorded", active: false, checkedAt }); expect((await checkProtonSharedTemplates(input)).state).toBe("not-recorded");
});
