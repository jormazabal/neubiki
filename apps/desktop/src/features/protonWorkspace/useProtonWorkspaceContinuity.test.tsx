import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { readDocument } from "../../lib/api/protonWorkspace";
import type { ProtonDocument } from "../../types/protonWorkspace";
import { protonContinuityStorageKey, useProtonWorkspaceContinuity } from "./useProtonWorkspaceContinuity";

vi.mock("../../lib/api/protonWorkspace", () => ({ readDocument: vi.fn() }));

const scope = { accountId: "account-a", rootId: "root-1" };
const initial = {
  nodeIds: [] as string[], activeId: null as string | null, showTree: true,
  leftOpen: true, rightOpen: true, leftWidth: 246, rightWidth: 342,
};

function saved() {
  const snapshot = { ...initial, nodeIds: ["first", "second"], activeId: "second", showTree: false, rightOpen: false };
  window.localStorage.setItem(protonContinuityStorageKey, JSON.stringify([
    { scopeKey: JSON.stringify(["other-account", scope.rootId]), snapshot: { ...snapshot, nodeIds: ["foreign"], activeId: "foreign" } },
    { scopeKey: JSON.stringify([scope.accountId, scope.rootId]), snapshot },
  ]));
}

function response(nodeId: string): ProtonDocument {
  const revisionId = `${nodeId}~new`;
  return {
    node: { nodeId, name: "nota.md", type: "file", revisionId }, revisionId,
    markdown: "Contenido de la revisión actual", draft: null, contentBase64: null,
  };
}

beforeEach(() => {
  window.localStorage.removeItem(protonContinuityStorageKey);
  vi.mocked(readDocument).mockReset();
  saved();
});

it("restaura solo la cuenta y raíz listas, prioriza la pestaña activa y conserva la que sigue disponible", async () => {
  vi.mocked(readDocument).mockRejectedValueOnce(new Error("No está disponible")).mockResolvedValueOnce(response("first"));
  const onRestore = vi.fn();
  const { rerender } = renderHook(({ ready }) => useProtonWorkspaceContinuity({
    enabled: true, ready, scope, snapshot: initial, supportsFile: () => true, canApply: () => true, onRestore,
  }), { initialProps: { ready: false } });

  expect(readDocument).not.toHaveBeenCalled();
  rerender({ ready: true });
  await waitFor(() => expect(onRestore).toHaveBeenCalledWith({
    tabs: [{ address: { ...scope, nodeId: "first" }, document: response("first") }],
    layout: { showTree: false, leftOpen: true, rightOpen: false, leftWidth: 246, rightWidth: 342 },
    activeId: "first", unavailableCount: 1,
  }));
  expect(vi.mocked(readDocument).mock.calls.map(([address]) => address)).toEqual([
    { ...scope, nodeId: "second" }, { ...scope, nodeId: "first" },
  ]);
});

it("descarta la restauración tardía cuando el usuario abre una pestaña y guarda únicamente preferencias e identificadores", async () => {
  let finish: (document: ProtonDocument) => void = () => {};
  vi.mocked(readDocument).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const onRestore = vi.fn();
  const { rerender } = renderHook(({ manual }) => useProtonWorkspaceContinuity({
    enabled: true, ready: true, scope,
    snapshot: manual ? { ...initial, nodeIds: ["manual"], activeId: "manual" } : initial,
    supportsFile: () => true, canApply: () => true, onRestore,
  }), { initialProps: { manual: false } });

  rerender({ manual: true });
  await act(async () => finish(response("second")));
  expect(onRestore).not.toHaveBeenCalled();
  expect(readDocument).toHaveBeenCalledTimes(1);
  const stored = window.localStorage.getItem(protonContinuityStorageKey) ?? "";
  expect(stored).toContain("manual");
  expect(stored).not.toContain("Contenido de la revisión actual");
  expect(stored).not.toContain("second~new");
});
