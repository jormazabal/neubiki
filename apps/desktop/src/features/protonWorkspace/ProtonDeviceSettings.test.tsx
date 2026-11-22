import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getProtonDeviceStorage } from "../../lib/api/protonDeviceStorage";
import { ProtonDeviceSettings } from "./ProtonDeviceSettings";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";

vi.mock("../../lib/api/protonDeviceStorage", () => ({ getProtonDeviceStorage: vi.fn() }));
afterEach(()=>{cleanup();vi.resetAllMocks();});

it("distingue una medición parcial de un almacén no disponible y conserva la última medición si falla la consulta", async () => {
  vi.mocked(getProtonDeviceStorage).mockResolvedValueOnce({
    schemaVersion: 1,
    checkedAt: "2026-11-17T11:30:00Z",
    families: [
      { id: "proton-recovery", state: "complete", files: 1, logicalBytes: 1024 },
      { id: "ai-history", state: "partial", files: 2, logicalBytes: 512 },
      { id: "recordings", state: "unavailable" },
    ],
  }).mockRejectedValueOnce(new Error("C:\\private\\ruta de diagnóstico"));
  render(<ProtonDeviceSettings native />);
  expect(getProtonDeviceStorage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Medir almacenamiento" }));
  expect(await screen.findByText("1 KiB")).toBeVisible();
  expect(screen.getByText("Al menos")).toBeVisible();
  expect(screen.getByText("No disponible")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Actualizar medición" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Se muestra la última medición");
  expect(screen.getByText("1 KiB")).toBeVisible();
  expect(screen.queryByText(/ruta de diagnóstico/)).toBeNull();
});

it("uses English storage units, measurement states and the existing diagnostics locale",async()=>{
  vi.mocked(getProtonDeviceStorage).mockResolvedValueOnce({schemaVersion:1,checkedAt:"2026-11-18T11:30:00Z",families:[
    {id:"proton-recovery",state:"complete",files:1250,logicalBytes:1536},
    {id:"ai-history",state:"partial",files:1,logicalBytes:512},
    {id:"recordings",state:"unavailable"},
  ]}).mockRejectedValueOnce(new Error("C:\\private\\diagnostic"));
  const view=render(<UiLocaleProvider language="en"><ProtonDeviceSettings native/></UiLocaleProvider>);
  expect(screen.getByRole("button",{name:"Prepare report"})).toBeVisible();
  expect(getProtonDeviceStorage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Measure storage"}));
  expect(await screen.findByText("1.5 KiB")).toBeVisible();
  expect(screen.getByText("1,250 files measured")).toBeVisible();
  expect(screen.getByText("Proton drafts and recovery")).toBeVisible();
  expect(screen.getByText("At least")).toBeVisible();
  expect(screen.getByText("Unavailable")).toBeVisible();
  expect(view.container.querySelector("time")).toHaveAttribute("dateTime","2026-11-18T11:30:00Z");
  fireEvent.click(screen.getByRole("button",{name:"Refresh measurement"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("The last measurement is shown");
  expect(screen.getByText("1.5 KiB")).toBeVisible();
  expect(screen.queryByText(/private/)).toBeNull();
});

it("keeps the installed-runtime requirement in English",()=>{
  render(<UiLocaleProvider language="en"><ProtonDeviceSettings native={false}/></UiLocaleProvider>);
  expect(screen.getByRole("button",{name:"Measure storage"})).toBeDisabled();
  expect(screen.getByText("Available in the installed application.")).toBeVisible();
  expect(screen.queryByRole("button",{name:"Prepare report"})).toBeNull();
  expect(getProtonDeviceStorage).not.toHaveBeenCalled();
});
