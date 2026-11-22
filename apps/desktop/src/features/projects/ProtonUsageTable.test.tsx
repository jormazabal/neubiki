import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ProtonUsageTable } from "./ProtonUsageTable";

afterEach(cleanup);

it("sorts interactions without changing the reported total or replacing an unavailable cost", async () => {
  render(<ProtonUsageTable firstColumn="Modelo" rows={[
    { key: "a", label: "Modelo A", interactions: 4, tokens: "600", cost: "—" },
    { key: "b", label: "Modelo B", interactions: 8, tokens: "900", cost: "0,05 €" },
  ]} totals={{ key: "total", label: "Total", interactions: 12, tokens: "1.500", cost: "0,05 €" }} />);
  const table = screen.getByRole("table");
  const rows = () => within(table).getAllByRole("row");
  expect(rows()[1]).toHaveTextContent("Modelo B");
  await userEvent.click(within(table).getByRole("button", { name: "Interacciones" }));
  expect(within(table).getByRole("columnheader", { name: "Interacciones" })).toHaveAttribute("aria-sort", "ascending");
  expect(rows()[1]).toHaveTextContent("Modelo A");
  expect(within(rows()[1]).getByText("—")).toBeVisible();
  const totalRow = within(rows()[rows().length - 1]);
  expect(totalRow.getByRole("rowheader", { name: "Total" })).toBeVisible();
  expect(totalRow.getByRole("cell", { name: "12" })).toBeVisible();
});
