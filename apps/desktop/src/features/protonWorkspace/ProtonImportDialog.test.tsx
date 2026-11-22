import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import type { ProtonNode } from "../../types/protonWorkspace";
import { ProtonImportDialog } from "./ProtonImportDialog";
import { captureProtonFiles } from "./protonImportSources";

const destination: ProtonNode[] = [{ nodeId: "root", type: "folder", name: "Proyecto de reunión" }];
const fallbackFocus = () => null;
afterEach(cleanup);

it("reviews the original names in English and stops after an unconfirmed upload", async () => {
  const file = new File(["original"], "Información.txt");
  const load = async () => [{ type: "file" as const, name: file.name, file }];
  const onApply = vi.fn().mockResolvedValue({ confirmed: 0, failure: { path: file.name, reason: "unconfirmedFile" } });
  render(<UiLocaleProvider language="en">
    <ProtonImportDialog destination={destination} load={load} onApply={onApply} onClose={vi.fn()}
      fallbackFocus={fallbackFocus} disabled={false} />
  </UiLocaleProvider>);
  const dialog = within(screen.getByRole("dialog", { name: "Import to Proton Drive" }));
  expect(dialog.getByText(destination[0].name)).toBeVisible();
  expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  fireEvent.click(await dialog.findByText("1 item to copy"));
  expect(dialog.getByText(file.name)).toBeInTheDocument();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "Import" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent(`Stopped at “${file.name}”. Proton did not confirm that the file was uploaded.`);
  expect(dialog.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  expect(onApply).toHaveBeenCalledWith([{ type: "file", name: file.name, file }], expect.any(Function));
});

it("updates a selection validation message when the locale changes", async () => {
  const file = new File(["original"], "Información.");
  const load = vi.fn(captureProtonFiles({ 0: file, length: 1 } as unknown as FileList));
  const dialog = <ProtonImportDialog destination={destination} load={load} onApply={vi.fn()}
    onClose={vi.fn()} fallbackFocus={fallbackFocus} disabled={false} />;
  const { rerender } = render(<UiLocaleProvider language="es">{dialog}</UiLocaleProvider>);
  expect(await screen.findByRole("alert")).toHaveTextContent("«Información.» no tiene un nombre compatible");
  rerender(<UiLocaleProvider language="en">{dialog}</UiLocaleProvider>);
  expect(screen.getByRole("alert")).toHaveTextContent("“Información.” has a name the Proton tree cannot use.");
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  expect(load).toHaveBeenCalledTimes(1);
});
