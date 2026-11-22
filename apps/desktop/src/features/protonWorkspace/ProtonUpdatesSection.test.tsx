import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { deviceSettingsCopy } from "../../lib/i18n/deviceSettingsCopy";
import { ProtonUpdatesSection } from "./ProtonUpdatesSection";
import type { useProtonUpdater } from "./useProtonUpdater";

type Controller=ReturnType<typeof useProtonUpdater>;
const controller=(state:Controller["state"],busy=false):Controller=>({state,busy,
  check:vi.fn().mockResolvedValue(undefined),install:vi.fn().mockResolvedValue(undefined),returnToSettings:vi.fn().mockResolvedValue(undefined)});
afterEach(cleanup);
it("keeps both specialist dictionaries complete",()=>{
  const keys=(value:object,prefix=""):string[]=>Object.entries(value).flatMap(([key,item])=>typeof item==="string"?[`${prefix}${key}`]:keys(item,`${prefix}${key}.`));
  expect(keys(deviceSettingsCopy.en)).toEqual(keys(deviceSettingsCopy.es));
});
it("retains Spanish defaults",()=>{
  const c=controller({phase:"idle"});
  render(<ProtonUpdatesSection controller={c} native disabled={false} pendingSettings={false}/>);
  fireEvent.click(screen.getByRole("button",{name:"Buscar actualizaciones"}));
  expect(c.check).toHaveBeenCalledOnce();
});
it("describes a channel-free installation in English without offering installation",()=>{
  const c=controller({phase:"unsupported"});
  render(<UiLocaleProvider language="en"><ProtonUpdatesSection controller={c} native disabled={false} pendingSettings={false}/></UiLocaleProvider>);
  expect(screen.getByRole("status")).toHaveTextContent("This installation has no update channel.");
  expect(screen.queryByRole("button",{name:"Download and install"})).toBeNull();
  expect(c.check).not.toHaveBeenCalled();expect(c.install).not.toHaveBeenCalled();
});
it("keeps the unsaved-settings gate and original release notes with English controls",()=>{
  const c=controller({phase:"available",update:{currentVersion:"0.7.0",version:"0.8.0",notes:"Notas originales sin traducir"}});
  const view=render(<UiLocaleProvider language="en"><ProtonUpdatesSection controller={c} native disabled={false} pendingSettings/></UiLocaleProvider>);
  expect(screen.getByText("Notas originales sin traducir")).toBeVisible();
  expect(screen.getByRole("button",{name:"Download and install"})).toBeDisabled();
  expect(screen.getByText("Save or discard your Settings changes before installing.")).toBeVisible();
  view.rerender(<UiLocaleProvider language="en"><ProtonUpdatesSection controller={c} native disabled={false} pendingSettings={false}/></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("button",{name:"Download and install"}));
  expect(c.install).toHaveBeenCalledOnce();
});
it("labels progress and system-installer return while retaining external errors",()=>{
  const update={currentVersion:"0.7.0",version:"0.8.0"};
  const c=controller({phase:"downloading",update,progress:{downloadedBytes:1024,percent:50}},true);
  const view=render(<UiLocaleProvider language="en"><ProtonUpdatesSection controller={c} native disabled={false} pendingSettings={false}/></UiLocaleProvider>);
  expect(screen.getByRole("progressbar",{name:"Update progress"})).toHaveAttribute("value","50");
  const installer=controller({phase:"installer",update,error:"Error original del instalador"},true);
  view.rerender(<UiLocaleProvider language="en"><ProtonUpdatesSection controller={installer} native disabled={false} pendingSettings={false}/></UiLocaleProvider>);
  expect(screen.getByRole("alert")).toHaveTextContent("Error original del instalador");
  fireEvent.click(screen.getByRole("button",{name:"Return to Settings"}));
  expect(installer.returnToSettings).toHaveBeenCalledOnce();
});
