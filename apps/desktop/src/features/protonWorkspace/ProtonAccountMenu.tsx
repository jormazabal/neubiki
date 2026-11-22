import { useEffect, useId, useRef, useState } from "react";
import { ChartNoAxesColumnIncreasing, ChevronUp, Cloud, FileClock, History, LogIn, LogOut, Mic, Settings, UserRound, UserRoundPlus } from "lucide-react";
import type { ProtonAccount } from "../../types/protonDirect";
import { useUiCopy } from "../../lib/i18n/UiLocale";

type Props = {
  account?: ProtonAccount;
  canConnect: boolean;
  pending: boolean;
  disabled: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSettings: () => void;
  onUsage: () => void;
  onRecordings?: () => void;
  onRecovery?: () => void;
  onAiHistory?: () => void;
  onMenuChange?: (open: boolean) => void;
};

export function ProtonAccountMenu({
  account, canConnect, pending, disabled, onConnect, onDisconnect, onSettings, onUsage, onRecordings, onRecovery, onAiHistory, onMenuChange,
}: Props) {
  const text = useUiCopy().navigation;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => { onMenuChange?.(open); }, [open, onMenuChange]);

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    trigger.current?.focus();
    action();
  }

  return <div ref={root} className="proton-account" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (!open || event.key !== "Escape") return;
    event.stopPropagation();
    setOpen(false);
    trigger.current?.focus();
  }}>
    <button ref={trigger} type="button" className="proton-account-trigger" aria-label={text.accountMenu}
      aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(current => !current)}>
      <span className="proton-account-avatar">{account?.label.trim().slice(0, 1).toUpperCase() || <UserRound size={17} />}</span>
      <span className="proton-account-copy">
        <strong title={account?.label}>{account?.label ?? text.myAccount}</strong>
        <small><Cloud size={12} /> {account ? "Proton Drive" : text.signedOut}</small>
      </span>
      <ChevronUp size={17} className="proton-account-chevron" />
    </button>
    {open && <div id={menuId} className="proton-account-popover" role="group" aria-label={text.accountOptions}>
      <button type="button" onClick={() => run(onUsage)}><ChartNoAxesColumnIncreasing size={16} /> {text.usage}</button>
      {onAiHistory && <button type="button" onClick={() => run(onAiHistory)}><History size={16} aria-hidden="true" /> {text.aiHistory}</button>}
      {onRecordings && <button type="button" onClick={() => run(onRecordings)}><Mic size={16} aria-hidden="true" /> {text.recordings}</button>}
      {onRecovery && <button type="button" onClick={() => run(onRecovery)}><FileClock size={16} aria-hidden="true" /> {text.recovery}</button>}
      <button type="button" onClick={() => run(onSettings)}><Settings size={16} /> {text.settings}</button>
      <hr />
      {account ? <>
        {canConnect && !pending && <button type="button" disabled={disabled}
          onClick={() => run(onConnect)}><UserRoundPlus size={16} /> {text.connectAnother}</button>}
        <button type="button" className="proton-account-signout" disabled={disabled}
          onClick={() => run(onDisconnect)}><LogOut size={16} /> {text.signOut}</button>
      </> : <button type="button" disabled={disabled || !canConnect || pending} onClick={() => run(onConnect)}>
        <LogIn size={16} /> {pending ? text.authorizationPending : text.signIn}
      </button>}
    </div>}
  </div>;
}
