import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { listProtonFavoriteItems } from "../../lib/api/protonFavorites";
import { ProtonFavoritesDialog } from "./ProtonFavoritesDialog";

vi.mock("../../lib/api/protonFavorites", () => ({ listProtonFavoriteItems: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("requires the current list and a second action to close a pending attempt", async () => {
  const page = { items: [], total: 0, offset: 0, nextOffset: null, missing: 0, unavailable: 0,
    partial: false, revisionId: "r1", checkedAt: "2026-11-18T09:00:00Z" };
  vi.mocked(listProtonFavoriteItems).mockResolvedValueOnce(page).mockResolvedValue({ ...page, revisionId: "r2" });
  const scope = { accountId: "account", rootId: "root" };
  const onClosePending = vi.fn();
  const props = { scope, connected: true, canToggle: false, pending: false, unknown: true, updatedAt: null,
    onOpen: vi.fn(), onToggle: vi.fn(), onCheck: vi.fn(), onClose: vi.fn(), onClosePending };
  const { rerender } = render(<ProtonFavoritesDialog {...props} pendingReview={{ key: "review", revisionId: "r2" }} />);
  await screen.findByText("Todavía no hay favoritos. Puedes añadir archivos desde su menú de opciones.");
  expect(screen.getByRole("button", { name: "Revisar la lista actual" })).toBeDisabled();

  rerender(<ProtonFavoritesDialog {...props} pendingReview={{ key: "review", revisionId: "r2" }} pending />);
  expect(listProtonFavoriteItems).toHaveBeenCalledTimes(1);
  rerender(<ProtonFavoritesDialog {...props} pendingReview={{ key: "review", revisionId: "r2" }} />);
  await screen.findByText("Todavía no hay favoritos. Puedes añadir archivos desde su menú de opciones.");
  fireEvent.click(screen.getByRole("button", { name: "Revisar la lista actual" }));
  expect(screen.getByRole("button", { name: "Volver" })).toHaveFocus();
  expect(onClosePending).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Volver" }));
  expect(screen.getByRole("button", { name: "Revisar la lista actual" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Revisar la lista actual" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar con la lista de Proton" }));
  expect(onClosePending).toHaveBeenCalledTimes(1);
  expect(onClosePending).toHaveBeenCalledWith("review");
});
