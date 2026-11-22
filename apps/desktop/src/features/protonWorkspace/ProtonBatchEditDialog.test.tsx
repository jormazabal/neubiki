import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { quoteProtonBatchEdit, runProtonBatchEdit } from "../../lib/api/protonBatchEdit";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { ProtonBatchEditDialog } from "./ProtonBatchEditDialog";

vi.mock("../../lib/api/protonBatchEdit", () => ({ quoteProtonBatchEdit: vi.fn(), runProtonBatchEdit: vi.fn() }));

const anchor = { accountId: "account", rootId: "root", nodeId: "first", baseRevisionId: "first~2" };
const files = [
  { nodeId: "first", revisionId: "first~2", name: "Decisión.md" },
  { nodeId: "second", revisionId: "second~2", name: "Otro archivo.md" },
];
const quote = { quoteId: "a".repeat(64), issuedAt: 1000, expiresAt: 1300, model: "fixture-model", estimatedEur: 0.023, documents: files };
const proposal = { ...files[0], status: "proposed" as const, after: "Revised text", baseDigest: "b".repeat(64) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(quoteProtonBatchEdit).mockResolvedValue(quote);
});

it("revises the changed translation cost before sending and compares only selected compatible proposals", async () => {
  const onCompare = vi.fn();
  vi.mocked(runProtonBatchEdit).mockResolvedValue({ usageRecorded: true, documents: [
    proposal, { ...files[1], status: "unavailable", after: null, baseDigest: "c".repeat(64) },
  ] });
  render(<UiLocaleProvider language="en"><ProtonBatchEditDialog anchor={anchor} files={files} connected onClose={vi.fn()} onCompare={onCompare} /></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Review cost" }));
  await screen.findByRole("button", { name: "Confirm and request proposals" });
  expect(runProtonBatchEdit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Operation" }), { target: { value: "translate" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Target language" }), { target: { value: "eu" } });
  expect(screen.queryByRole("button", { name: "Confirm and request proposals" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review cost" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm and request proposals" }));
  const input = { ...anchor, documents: files, task: "translate", language: "eu" };
  expect(runProtonBatchEdit).toHaveBeenCalledWith(input, quote);
  const compare = await screen.findByRole("button", { name: "Compare proposals" });
  expect(compare).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /Otro archivo.md/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Decisión.md/ }));
  fireEvent.click(compare);
  expect(onCompare).toHaveBeenCalledWith(input, [proposal]);
});

it("keeps an uncertain paid attempt closed to retry in the same dialog", async () => {
  vi.mocked(runProtonBatchEdit).mockRejectedValue(new Error("Respuesta interrumpida"));
  const onCompare = vi.fn();
  render(<ProtonBatchEditDialog anchor={anchor} files={files} connected onClose={vi.fn()} onCompare={onCompare} />);
  fireEvent.click(screen.getByRole("button", { name: "Revisar coste" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirmar y pedir propuestas" }));
  expect(await screen.findByText("Comprueba el consumo antes de volver a enviar este lote.")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Revisar coste|Confirmar y pedir propuestas/ })).not.toBeInTheDocument();
  expect(runProtonBatchEdit).toHaveBeenCalledTimes(1);
  expect(onCompare).not.toHaveBeenCalled();
});
