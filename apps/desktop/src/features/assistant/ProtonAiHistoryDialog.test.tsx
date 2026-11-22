import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { deleteProtonAiHistory, listProtonAiHistory, readProtonAiHistory } from "../../lib/api/protonAiHistory";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import type { ProtonAiHistorySummary } from "../../types/protonAiHistory";
import { ProtonAiHistoryDialog } from "./ProtonAiHistoryDialog";

vi.mock("../../lib/api/protonAiHistory", () => ({
  deleteProtonAiHistory: vi.fn(),
  listProtonAiHistory: vi.fn(),
  readProtonAiHistory: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

it("carga el resultado solo al abrirlo y exige confirmación antes de eliminarlo", async () => {
  const summary: ProtonAiHistorySummary = {
    id: "item-propio",
    kind: "assistant",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  vi.mocked(listProtonAiHistory).mockResolvedValue({ entries: [summary] });
  vi.mocked(readProtonAiHistory).mockResolvedValue({
    summary,
    content: { kind: "assistant", prompt: "Pregunta sintética", text: "Respuesta sintética" },
  });
  vi.mocked(deleteProtonAiHistory).mockResolvedValue(null);
  render(<ProtonAiHistoryDialog onClose={vi.fn()} />);

  const row = await screen.findByRole("button", { name: /Consulta de IA/ });
  expect(readProtonAiHistory).not.toHaveBeenCalled();
  fireEvent.click(row);
  expect(await screen.findByText("Respuesta sintética")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Eliminar…" }));
  expect(deleteProtonAiHistory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Eliminar entrada" }));
  expect(await screen.findByText("Entrada eliminada de este dispositivo.")).toBeVisible();
  expect(deleteProtonAiHistory).toHaveBeenCalledWith(summary.id);
  expect(screen.queryByText("Respuesta sintética")).toBeNull();
});

it("localizes the English history controls without rewriting the stored request or result", async () => {
  const summary: ProtonAiHistorySummary = {
    id: "local-entry",
    kind: "assistant",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  vi.mocked(listProtonAiHistory).mockResolvedValue({ entries: [summary] });
  vi.mocked(readProtonAiHistory).mockResolvedValue({
    summary,
    content: { kind: "assistant", prompt: "Consulta original en español", text: "Erantzuna euskaraz" },
  });
  render(<UiLocaleProvider language="en"><ProtonAiHistoryDialog onClose={vi.fn()} /></UiLocaleProvider>);

  expect(screen.getByRole("dialog", { name: "Private AI history" })).toBeVisible();
  fireEvent.click(await screen.findByRole("button", { name: /AI request/ }));
  expect(await screen.findByText("Consulta original en español")).toBeVisible();
  expect(screen.getByText("Erantzuna euskaraz")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Result" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
  expect(screen.getByRole("group", { name: "Confirm deletion" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(deleteProtonAiHistory).not.toHaveBeenCalled();
});
