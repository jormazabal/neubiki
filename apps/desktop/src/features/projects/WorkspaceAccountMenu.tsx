import { ArchiveRestore, BarChart3, ChevronLeft, ChevronRight, Cloud, FileClock, LogOut, RefreshCw, ScrollText, Settings, Sparkles, UserPlus, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceMenuAction } from "./ProjectActions";

type Item = { label: string; icon: LucideIcon; detail?: string; badge?: string | number; disabled?: boolean; run: () => void };
type Group = "account" | "ai" | "recovery" | "updates";
type Props = {
  className: string; english: boolean; narrow: boolean; name: string; initials: string; version: string;
  authenticated: boolean; accountError?: string | null; actions: WorkspaceMenuAction[]; drafts: number; checking: boolean;
  protonName?: string; githubName?: string; onProton?: () => void;
  onRun: (action: () => void) => void; onLogin: () => void; onLogout: () => void;
  onSettings: () => void; onRecovery: () => void; onUpdates: () => void; onReleaseNotes: () => void;
  onSync: () => void; onUsage: () => void;
};

/** Click-open groups retain their layer across pointer gaps; mobile uses a back stack. */
export function WorkspaceAccountMenu(p: Props) {
  const [open, setOpen] = useState<Group | null>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const t = (es: string, en: string) => p.english ? en : es;
  const activity = p.actions.find(a => a.id === "activity");
  const results = p.actions.find(a => a.id === "ai-results");
  const trash = p.actions.find(a => a.id === "trash");
  const labels = { account: t("Mi cuenta", "My account"), ai: t("Inteligencia artificial", "Artificial intelligence"), recovery: t("Recuperación", "Recovery"), updates: t("Novedades y actualizaciones", "What's new and updates") };
  const groups: Record<Group, Item[]> = {
    account: [
      ...(p.onProton ? [{label: "Proton Drive", icon: Cloud, detail: p.protonName || t("Configurar conexión", "Set up connection"), run: p.onProton}] : []),
      {label: p.authenticated ? t("Cerrar sesión de GitHub", "Sign out of GitHub") : t("Conectar GitHub", "Connect GitHub"),
        icon: p.authenticated ? LogOut : UserPlus, detail: p.authenticated ? p.githubName : undefined, run: p.authenticated ? p.onLogout : p.onLogin},
    ],
    ai: [...(results ? [{ ...results, run: results.onSelect }] : []), { label: t("Uso y consumo", "Usage and costs"), icon: BarChart3, run: p.onUsage }],
    recovery: [...(trash ? [{ ...trash, detail: t("Archivos eliminados", "Deleted files"), run: trash.onSelect }] : []), { label: t("Borradores recuperables", "Recoverable drafts"), detail: t("Cambios sin guardar", "Unsaved changes"), icon: FileClock, badge: p.drafts || undefined, run: p.onRecovery }],
    updates: [{ label: t("Novedades", "What's new"), icon: ScrollText, run: p.onReleaseNotes }, { label: t("Buscar actualizaciones", "Check for updates"), icon: RefreshCw, disabled: p.checking, run: p.onUpdates }],
  };
  function close() { setOpen(null); anchor.current?.focus(); }
  function toggle(group: Group, button: HTMLButtonElement) { anchor.current = button; setOpen(current => current === group ? null : group); }
  function groupButton(group: Group, Icon: LucideIcon, detail?: string, badge?: string | number) {
    return <button role={p.narrow ? undefined : "menuitem"} aria-label={labels[group]} aria-haspopup="menu" aria-expanded={open === group} onClick={e => toggle(group, e.currentTarget)} onKeyDown={e => { if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); anchor.current = e.currentTarget; setOpen(group); } }}>
      <Icon size={17}/><span className="workspace-menu-copy"><span>{labels[group]}</span>{detail && <small>{detail}</small>}</span>{badge && <span className="workspace-account-badge">{badge}</span>}<ChevronRight size={15}/>
    </button>;
  }
  function run(item: Item) { setOpen(null); item.run === p.onUsage ? item.run() : p.onRun(item.run); }
  useLayoutEffect(() => { if (p.narrow) root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [open, p.narrow]);
  return <div ref={root} className={`${p.className} workspace-account-menu workspace-account-compact${p.narrow ? " workspace-account-mobile" : ""}`} role={p.narrow ? undefined : "menu"} aria-label={t("Opciones de cuenta", "Account options")} onKeyDown={e=>{if(p.narrow && open && (e.key==="Escape"||e.key==="ArrowLeft")){e.preventDefault();e.stopPropagation();close();}}}>
    {p.narrow && open ? <>
      <button onClick={close}><ChevronLeft size={17}/>{labels[open]}</button>
      <div className="workspace-account-separator"/>
      {groups[open].map(item => <MenuItem key={item.label} item={item} narrow onRun={() => run(item)}/>)}
    </> : <>
      <button className="workspace-account-identity" role={p.narrow ? undefined : "menuitem"} aria-label={labels.account} aria-haspopup="menu" aria-expanded={open === "account"} onClick={e => toggle("account", e.currentTarget)} onKeyDown={e=>{if(e.key==="ArrowRight"){e.preventDefault();e.stopPropagation();anchor.current=e.currentTarget;setOpen("account");}}}>
        <span className="workspace-account-avatar">{p.initials}</span><span className="workspace-menu-copy"><strong>{p.name}</strong><small>{p.protonName ? "Proton Drive" : p.githubName ? "GitHub" : t("Cuentas conectadas", "Connected accounts")}</small></span><ChevronRight size={15}/>
      </button>
      {p.accountError && <p role="alert" className="px-3 text-xs text-red-700">{p.accountError}</p>}
      <div className="workspace-account-separator"/>
      {activity && <MenuItem item={{...activity,run:activity.onSelect}} narrow={p.narrow} onRun={()=>p.onRun(activity.onSelect)}/>}
      {groupButton("ai", Sparkles, t("Resultados y uso", "Results and usage"), results?.badge)}
      {groupButton("recovery", ArchiveRestore, undefined, p.drafts || undefined)}
      <div className="workspace-account-separator"/>
      <MenuItem item={{label:t("Sincronización", "Sync"),icon:RefreshCw,run:p.onSync}} narrow={p.narrow} onRun={()=>p.onRun(p.onSync)}/>
      <MenuItem item={{label:t("Configuración", "Settings"),icon:Settings,run:p.onSettings}} narrow={p.narrow} onRun={()=>p.onRun(p.onSettings)}/>
      <div className="workspace-account-separator"/>
      <button className="workspace-account-update" role={p.narrow ? undefined : "menuitem"} aria-haspopup="menu" aria-expanded={open === "updates"} onClick={e=>toggle("updates",e.currentTarget)} onKeyDown={e=>{if(e.key==="ArrowRight"){e.preventDefault();e.stopPropagation();anchor.current=e.currentTarget;setOpen("updates");}}}><span>v{p.version}</span><span>{labels.updates}</span></button>
    </>}
    {!p.narrow && open && anchor.current && createPortal(<AccountMenuLayer key={open} label={labels[open]} anchor={anchor.current} items={groups[open]} onBack={close} onRun={run}/>, document.body)}
  </div>;
}

function MenuItem({item,narrow,onRun}:{item:Item;narrow:boolean;onRun:()=>void}) {
  return <button role={narrow?undefined:"menuitem"} aria-label={item.label} disabled={item.disabled} onClick={onRun}><item.icon size={17}/><span className="workspace-menu-copy"><span>{item.label}</span>{item.detail&&<small>{item.detail}</small>}</span>{item.badge&&<span className="workspace-account-badge">{item.badge}</span>}</button>;
}

function AccountMenuLayer({label,anchor,items,onBack,onRun}:{label:string;anchor:HTMLButtonElement;items:Item[];onBack:()=>void;onRun:(item:Item)=>void}) {
  const ref=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({left:0,top:0});
  useLayoutEffect(()=>{
    function place(){const r=anchor.getBoundingClientRect(),panel=ref.current!.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(r.right+6+panel.width<=innerWidth-8?r.right+6:r.left-panel.width-6,innerWidth-panel.width-8)),top:Math.max(8,Math.min(r.top,innerHeight-panel.height-8))});}
    place();ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
    return()=>{window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};
  },[anchor]);
  function keys(e:KeyboardEvent){
    if(e.key==="Escape"||e.key==="ArrowLeft"){e.preventDefault();e.stopPropagation();onBack();}
    if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){e.preventDefault();e.stopPropagation();const buttons=Array.from(ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));const i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==="Home"?0:e.key==="End"?buttons.length-1:(i+(e.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length]?.focus();}
  }
  return <div ref={ref} role="menu" aria-label={label} data-workspace-account-layer className="workspace-account-menu workspace-account-layer" style={position} onMouseDown={e=>e.stopPropagation()} onKeyDown={keys}>{items.map(item=><MenuItem key={item.label} item={item} narrow={false} onRun={()=>onRun(item)}/>)}</div>;
}
