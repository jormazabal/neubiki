import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { checkProtonFavorites, closePendingProtonFavorite, readProtonFavorites, updateProtonFavorites, type ProtonFavoritesSnapshot } from "../../lib/api/protonFavorites";
import { useProtonFavorites } from "./useProtonFavorites";

vi.mock("../../lib/api/protonFavorites", () => ({ readProtonFavorites: vi.fn(), checkProtonFavorites: vi.fn(), closePendingProtonFavorite: vi.fn(), updateProtonFavorites: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const scope = { accountId: "account", rootId: "root" };
const initial: ProtonFavoritesSnapshot = { nodeId: null, revisionId: null, items: [], operationId: null, updatedAt: null,
  outcome: "confirmed", pendingOperationId: null, checkedAt: "2026-11-17T12:00:00Z" };

it("uses the observed metadata base and checks an uncertain write without replay or optimistic favorites", async () => {
  vi.mocked(readProtonFavorites).mockResolvedValue(initial);
  vi.mocked(updateProtonFavorites).mockResolvedValue({ ...initial, outcome: "unknown", pendingOperationId: "attempt" });
  vi.mocked(checkProtonFavorites).mockResolvedValue({ ...initial, nodeId: "metadata", revisionId: "metadata~rev", items: ["file"], operationId: "attempt" });
  const { result } = renderHook(() => useProtonFavorites({ scope, connected: true, canWrite: true }));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await act(async () => { await result.current.toggle("file"); });
  expect(updateProtonFavorites).toHaveBeenCalledWith(scope, initial, ["file"]);
  expect(result.current.ids).toEqual([]);
  expect(result.current.phase).toBe("unknown");
  expect(result.current.canToggle).toBe(false);
  await act(async () => { await result.current.toggle("file"); });
  expect(updateProtonFavorites).toHaveBeenCalledTimes(1);
  await act(async () => { await result.current.check(); });
  expect(checkProtonFavorites).toHaveBeenCalledWith(scope);
  expect(result.current.ids).toEqual(["file"]);
  expect(result.current.phase).toBe("ready");
  expect(updateProtonFavorites).toHaveBeenCalledTimes(1);
});

it("ignores a delayed snapshot from a previous Proton scope", async () => {
  let finish: (snapshot: ProtonFavoritesSnapshot) => void = () => {};
  vi.mocked(readProtonFavorites).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(initial);
  const { result, rerender } = renderHook(({ rootId }) => useProtonFavorites({ scope: { accountId: "account", rootId }, connected: true, canWrite: true }), { initialProps: { rootId: "old" } });
  rerender({ rootId: "new" });
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await act(async () => finish({ ...initial, items: ["foreign"] }));
  expect(result.current.ids).toEqual([]);
});

it("retains visible favorites in read-only mode and never sends a toggle", async () => {
  vi.mocked(readProtonFavorites).mockResolvedValue({ ...initial, items: ["file"] });
  const { result } = renderHook(() => useProtonFavorites({ scope, connected: true, canWrite: false }));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await act(async () => { await result.current.toggle("file"); });
  expect(result.current.ids).toEqual(["file"]);
  expect(result.current.canToggle).toBe(false);
  expect(updateProtonFavorites).not.toHaveBeenCalled();
});

it("retires only the freshly reviewed attempt and leaves Proton's list authoritative", async () => {
  const pending: ProtonFavoritesSnapshot = {...initial, outcome: "unknown", pendingOperationId: "attempt"};
  const reviewed: ProtonFavoritesSnapshot = {...pending, nodeId: "metadata", revisionId: "metadata~rev", items: ["proton"], canReviewPending: true};
  vi.mocked(readProtonFavorites).mockResolvedValue(pending);
  vi.mocked(checkProtonFavorites).mockResolvedValue(reviewed);
  vi.mocked(closePendingProtonFavorite).mockResolvedValue({...initial, nodeId: "metadata", revisionId: "metadata~rev",
    items: ["proton"], closedWithoutConfirmation: "2026-11-18T10:00:00Z"});
  const { result } = renderHook(() => useProtonFavorites({ scope, connected: true, canWrite: true }));
  await waitFor(() => expect(result.current.phase).toBe("unknown"));
  expect(result.current.pendingReview).toBeNull();
  await act(async () => { await result.current.check(); });
  expect(result.current.pendingReview?.revisionId).toBe("metadata~rev");
  await act(async () => { await result.current.check("old-review"); });
  expect(closePendingProtonFavorite).not.toHaveBeenCalled();
  await act(async () => { await result.current.check(result.current.pendingReview!.key); });
  expect(closePendingProtonFavorite).toHaveBeenCalledTimes(1);
  expect(closePendingProtonFavorite).toHaveBeenCalledWith(scope, reviewed);
  expect(result.current.ids).toEqual(["proton"]);
  expect(result.current.phase).toBe("ready");
  expect(result.current.closedWithoutConfirmation).toBe("2026-11-18T10:00:00Z");
  expect(updateProtonFavorites).not.toHaveBeenCalled();
});
