import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Activity, GitCompareArrows, Trash2 } from "lucide-react";
import { WorkspaceAccountMenu } from "./WorkspaceAccountMenu";
afterEach(cleanup);
const props=()=>({className:"",english:false,narrow:false,name:"Joseba",initials:"JO",version:"3.0.1",authenticated:false,actions:[{id:"activity",label:"Actividad",icon:Activity,onSelect:vi.fn()},{id:"ai-results",label:"Resultados IA",icon:GitCompareArrows,onSelect:vi.fn(),badge:2},{id:"trash",label:"Papelera del proyecto",icon:Trash2,onSelect:vi.fn(),disabled:true}],drafts:3,checking:false,onRun:(fn:()=>void)=>fn(),onLogin:vi.fn(),onLogout:vi.fn(),onSettings:vi.fn(),onRecovery:vi.fn(),onUpdates:vi.fn(),onReleaseNotes:vi.fn(),onSync:vi.fn(),onUsage:vi.fn()});
it("opens a separate layer by click, keeps it through pointer gaps, and restores parent focus",async()=>{
  const p=props();render(<WorkspaceAccountMenu {...p}/>);const trigger=screen.getByRole("menuitem",{name:"Recuperación"});
  await userEvent.hover(trigger);expect(screen.queryByRole("menu",{name:"Recuperación"})).not.toBeInTheDocument();
  await userEvent.click(trigger);const menu=screen.getByRole("menu",{name:"Recuperación"});
  expect(menu.parentElement).toBe(document.body);expect(within(menu).getByRole("menuitem",{name:"Papelera del proyecto"})).toBeDisabled();
  await userEvent.unhover(trigger);expect(menu).toBeVisible();
  await userEvent.keyboard("{Escape}");expect(trigger).toHaveFocus();expect(menu).not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowRight}");await userEvent.click(screen.getByRole("menuitem",{name:"Borradores recuperables"}));expect(p.onRecovery).toHaveBeenCalledOnce();
});
it("keeps AI results and usage separate functional destinations within one group",async()=>{
  const p=props();render(<WorkspaceAccountMenu {...p}/>);
  await userEvent.click(screen.getByRole("menuitem",{name:"Inteligencia artificial"}));await userEvent.click(screen.getByRole("menuitem",{name:"Resultados IA"}));expect(p.actions[1].onSelect).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("menuitem",{name:"Inteligencia artificial"}));await userEvent.click(screen.getByRole("menuitem",{name:"Uso y consumo"}));expect(p.onUsage).toHaveBeenCalledOnce();
  expect(screen.queryByText("Asistente IA")).not.toBeInTheDocument();expect(screen.queryByText("Notas")).not.toBeInTheDocument();
});
it("uses a back level on narrow screens and preserves update actions",async()=>{
  const p=props();render(<WorkspaceAccountMenu {...p} narrow/>);
  await userEvent.click(screen.getByRole("button",{name:/Novedades y actualizaciones/}));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();await userEvent.click(screen.getByRole("button",{name:"Buscar actualizaciones"}));expect(p.onUpdates).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button",{name:"Recuperación"}));expect(screen.getByRole("button",{name:"Borradores recuperables"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Recuperación"}));expect(screen.getByRole("button",{name:"Configuración"})).toBeVisible();
});
