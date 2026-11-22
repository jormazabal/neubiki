import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { reviewProtonReplacementSuggestion, runProtonReplacementSuggestion } from "../../lib/api/protonReplacementSuggestion";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { ProtonReplacementSuggestion } from "./ProtonReplacementSuggestion";

vi.mock("../../lib/api/protonReplacementSuggestion", () => ({
  reviewProtonReplacementSuggestion: vi.fn(), runProtonReplacementSuggestion: vi.fn(),
}));

const anchor = { accountId: "acct", rootId: "root", nodeId: "active", baseRevisionId: "active~saved" };
const sources = ["Propuesta.md", "Árbol.md"].map((name, index) =>
  ({ name, nodeId: `source${index}`, revisionId: `source${index}~saved` }));
const quote = { model: "test-model", estimatedEur: .018, quoteId: "reviewed", sourceNames: sources.map(source => source.name) };

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("reviews explicit saved source revisions and only uses a reviewed phrase in the replacement field", async () => {
  vi.mocked(reviewProtonReplacementSuggestion).mockResolvedValue(quote);
  vi.mocked(runProtonReplacementSuggestion).mockResolvedValue({ replacement: "equipo", usageRecorded: true });
  const use = vi.fn();
  render(<UiLocaleProvider language="en"><ProtonReplacementSuggestion anchor={anchor} query="grupo"
    sources={sources} onUse={use} onClose={vi.fn()} /></UiLocaleProvider>);
  expect(screen.getByText("Árbol.md")).toBeVisible();
  expect(runProtonReplacementSuggestion).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Usar el término del manual" } });
  fireEvent.click(screen.getByRole("button", { name: "Review cost" }));
  expect(await screen.findByText("test-model")).toBeVisible();
  const input = { ...anchor, query: "grupo", intent: "Usar el término del manual",
    sources: sources.map(({ nodeId, revisionId }) => ({ nodeId, revisionId })) };
  expect(reviewProtonReplacementSuggestion).toHaveBeenCalledWith(input);
  expect(runProtonReplacementSuggestion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and request suggestion" }));
  expect(await screen.findByText("equipo")).toBeVisible();
  expect(runProtonReplacementSuggestion).toHaveBeenCalledWith(input, quote.quoteId);
  expect(use).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use in replacement field" }));
  expect(use).toHaveBeenCalledWith("equipo");
});

it("invalidates a quotation when edited and does not resend an unconfirmed suggestion", async () => {
  vi.mocked(reviewProtonReplacementSuggestion).mockResolvedValue(quote);
  vi.mocked(runProtonReplacementSuggestion).mockRejectedValue(new Error("Resultado no recibido"));
  render(<ProtonReplacementSuggestion anchor={anchor} query="grupo" sources={sources} onUse={vi.fn()} onClose={vi.fn()} />);
  const field = screen.getByRole("textbox");
  fireEvent.change(field, { target: { value: "Primera indicación" } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar coste" }));
  await screen.findByText("test-model");
  fireEvent.change(field, { target: { value: "Indicación revisada" } });
  expect(screen.queryByRole("button", { name: "Confirmar y solicitar propuesta" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revisar coste" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirmar y solicitar propuesta" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(runProtonReplacementSuggestion).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Confirmar y solicitar propuesta" })).not.toBeInTheDocument();
});
