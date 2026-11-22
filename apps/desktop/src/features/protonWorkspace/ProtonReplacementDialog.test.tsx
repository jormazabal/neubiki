import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { applyProtonReplacements, checkProtonReplacements, reviewProtonReplacements } from "../../lib/api/protonReplacements";
import { ProtonReplacementDialog } from "./ProtonReplacementDialog";

vi.mock("../../lib/api/protonReplacements", () => ({ applyProtonReplacements: vi.fn(), checkProtonReplacements: vi.fn(), reviewProtonReplacements: vi.fn() }));

it("protege antes de revisar y comprueba una aplicación incierta sin repetir el reemplazo", async () => {
  const review = { operationId: "owned-attempt", applied: false, items: [{ nodeId: "n", name: "A.md", occurrences: 1,
    before: "# Texto original", after: "# Texto revisado", state: "reviewed" as const }] };
  const onBeforeReview = vi.fn().mockResolvedValue(undefined);
  const onPrepared = vi.fn();
  vi.mocked(reviewProtonReplacements).mockResolvedValue(review);
  vi.mocked(applyProtonReplacements).mockRejectedValue(new Error("Respuesta perdida"));
  vi.mocked(checkProtonReplacements).mockResolvedValue({ ...review, applied: true, items: [{ ...review.items[0], state: "prepared" }] });
  render(<ProtonReplacementDialog workspace={{ accountId: "account", root: { nodeId: "root", name: "Proyecto", type: "folder" }, canWrite: true }}
    nodeIds={["n"]} query="original" replacement="revisado" onBeforeReview={onBeforeReview} onPrepared={onPrepared} onClose={vi.fn()} />);
  expect(await screen.findByText("# Texto revisado")).toBeVisible();
  expect(onBeforeReview.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(reviewProtonReplacements).mock.invocationCallOrder[0]);
  fireEvent.click(screen.getByRole("button", { name: "Preparar 1 borradores" }));
  fireEvent.click(await screen.findByRole("button", { name: "Comprobar resultado" }));
  expect(await screen.findByText(/A.md · Borrador preparado/)).toBeVisible();
  expect(applyProtonReplacements).toHaveBeenCalledTimes(1);
  expect(checkProtonReplacements).toHaveBeenCalledTimes(1);
  expect(onPrepared).toHaveBeenCalledWith(["n"]);
});
