import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "../../lib/api/protonWorkspace";
import { createDefaultHandwrittenContent } from "../handwritten/handwrittenModel";
import { hasUnprotectedEdits, useProtonDocument } from "./useProtonDocument";

vi.mock("../../lib/api/protonWorkspace", () => ({
  writeDraft: vi.fn(), saveDocument: vi.fn(), reconcileDocument: vi.fn(), readDocument: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("protects strokes and publishes the structured note against the opened revision", async () => {
  const address = { accountId: "a", rootId: "r", nodeId: "note" };
  const original = createDefaultHandwrittenContent("original", "Nota");
  const edited = { ...original, title: "Cambios", pages: [...original.pages, { ...original.pages[0], id: "page-2" }] };
  const protectedDraft = { baseRevisionId: "base", generation: 1, markdown: "", handwritten: edited, state: "draft" as const };
  vi.mocked(api.writeDraft).mockResolvedValue(protectedDraft);
  vi.mocked(api.saveDocument).mockResolvedValue({ state: "saved", revisionId: "confirmed", draft: null });
  const { result } = renderHook(() => useProtonDocument(vi.fn(), vi.fn()));
  act(() => result.current.open(address, {
    node: { nodeId: "note", name: "Legado.knote", type: "file" }, revisionId: "base", handwritten: original,
    markdown: null, contentBase64: null, draft: null,
  }));
  expect(hasUnprotectedEdits(result.current.getCurrent()!)).toBe(false);
  act(() => result.current.editHandwritten(edited));
  expect(hasUnprotectedEdits(result.current.getCurrent()!)).toBe(true);
  await act(async () => { await result.current.protect(); });
  expect(api.writeDraft).toHaveBeenCalledWith(address, {
    documentName: "Legado.knote", baseRevisionId: "base", expectedGeneration: null, handwritten: edited,
  });
  expect(result.current.getCurrent()?.draft?.handwritten).toEqual(edited);
  await act(async () => { await result.current.save(); });
  expect(api.saveDocument).toHaveBeenCalledWith(address, 1, expect.any(String));
  await waitFor(() => expect(result.current.getCurrent()?.document.revisionId).toBe("confirmed"));
  expect(result.current.getCurrent()?.document.handwritten).toEqual(edited);
  expect(result.current.getCurrent()?.document.node.name).toBe("Legado.knote");
  expect(hasUnprotectedEdits(result.current.getCurrent()!)).toBe(false);
});

it("refreshes prepared drafts without selecting another tab and protects tabs that cannot reload", async () => {
  const root = { accountId: "acct", rootId: "root" };
  const first = { ...root, nodeId: "first" };
  const second = { ...root, nodeId: "second" };
  const createDocument = (nodeId: string) => ({
    node: { nodeId, name: `${nodeId}.md`, type: "file" as const },
    revisionId: "base", markdown: "# Original", contentBase64: null, draft: null,
  });
  const draft = { baseRevisionId: "base", generation: 2, markdown: "# Propuesta", state: "draft" as const };
  vi.mocked(api.readDocument).mockImplementation(async address => {
    if (address.nodeId === second.nodeId) throw new Error("connection lost");
    return { ...createDocument(address.nodeId), draft };
  });
  const { result } = renderHook(() => useProtonDocument(vi.fn(), vi.fn()));
  act(() => {
    result.current.open(first, createDocument(first.nodeId));
    result.current.open(second, createDocument(second.nodeId));
  });
  await act(async () => {
    expect(await result.current.refreshPreparedDrafts([first.nodeId, second.nodeId])).toBe(false);
  });
  expect(result.current.getCurrent()?.address).toEqual(second);
  expect(result.current.getCurrent()?.needsDraftReload).toBe(true);
  expect(result.current.tabs.find(tab => tab.address.nodeId === first.nodeId)?.draft).toEqual(draft);
  act(() => result.current.edit("Cambio sobre vista antigua"));
  expect(result.current.getCurrent()?.markdown).toBe("# Original");
  expect(api.writeDraft).not.toHaveBeenCalled();
});
