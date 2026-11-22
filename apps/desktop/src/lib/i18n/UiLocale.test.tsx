import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UiLocaleProvider } from "./UiLocale";
import { uiCopy } from "./uiCopy";
import { ProtonAccountMenu } from "../../features/protonWorkspace/ProtonAccountMenu";

afterEach(cleanup);
it("keeps both dictionaries structurally complete",()=>{
  function keys(value:object,prefix=""):string[]{return Object.entries(value).flatMap(([key,item])=>typeof item==="string"?[`${prefix}${key}`]:keys(item,`${prefix}${key}.`));}
  expect(keys(uiCopy.en)).toEqual(keys(uiCopy.es));
});
it("updates account navigation from a controlled language while retaining user text",()=>{
  const content=<ProtonAccountMenu account={{id:"account",label:"Cuenta de Joseba"} as never} canConnect pending={false} disabled={false}
    onConnect={vi.fn()} onDisconnect={vi.fn()} onSettings={vi.fn()} onUsage={vi.fn()} onRecovery={vi.fn()}/>;
  const view=render(<UiLocaleProvider language="es">{content}<p>Mi documento conserva su título</p></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("button",{name:"Menú de cuenta"}));
  expect(screen.getByRole("button",{name:"Recuperar borradores"})).toBeVisible();
  view.rerender(<UiLocaleProvider language="en">{content}<p>Mi documento conserva su título</p></UiLocaleProvider>);
  expect(screen.getByRole("button",{name:"Recover drafts"})).toBeVisible();
  expect(screen.getByText("Cuenta de Joseba")).toBeVisible();
  expect(screen.getByText("Mi documento conserva su título")).toBeVisible();
});
