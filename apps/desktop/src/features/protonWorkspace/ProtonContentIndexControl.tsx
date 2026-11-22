import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { StatusTag } from "../../components/ui/StatusTag";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { ApiError } from "../../lib/api/client";
import { readProtonContentIndex, configureProtonContentIndex, clearProtonContentIndex } from "../../lib/api/protonContentIndex";
import { useContentIndexCopy } from "../../lib/i18n/contentIndexCopy";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import type { ProtonContentIndexScope, ProtonContentIndexStatus } from "../../types/protonContentIndex";

type Props=ProtonContentIndexScope & {connected:boolean; refreshKey?:number};
export function ProtonContentIndexControl(props:Props) {
  return <ScopedContentIndex key={JSON.stringify([props.accountId,props.rootId])} {...props}/>;
}
function ScopedContentIndex({accountId,rootId,connected,refreshKey=0}:Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const c=useContentIndexCopy(),language=useUiLocale();
  const [status,setStatus]=useState<ProtonContentIndexStatus|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [needsCheck,setNeedsCheck]=useState(false);
  const [unreadable,setUnreadable]=useState(false);
  const [confirmation,setConfirmation]=useState<"clear"|"disable"|null>(null);
  const mounted=useRef(false),active=useRef(false);
  const statusTrigger=useRef<HTMLButtonElement>(null);
  const observedRefresh=useRef(refreshKey);
  const scope={accountId,rootId};
  function failure(cause:unknown,fallback:string) {
    return cause instanceof ApiError && cause.code==="proton-content-index-response" ? c.invalid : runtimeErrorMessage(cause,fallback);
  }
  function readFailure(cause:unknown) {
    const known= cause instanceof ApiError && cause.code==="proton-content-index-unavailable";
    setUnreadable(known);
    if(known){setStatus(null);setNeedsCheck(false);}
    setError(failure(cause,c.readFailed));
  }
  useEffect(()=>{
    mounted.current=true;
    const request=new AbortController();
    active.current=true;setBusy(true);
    void readProtonContentIndex({accountId,rootId},request.signal).then(result=>{
      if(mounted.current&&!request.signal.aborted)setStatus(result);
    },cause=>{if(mounted.current&&!request.signal.aborted)readFailure(cause);})
      .finally(()=>{if(mounted.current&&!request.signal.aborted){active.current=false;setBusy(false);}});
    return()=>{mounted.current=false;request.abort();};
  },[accountId,rootId]);
  async function check() {
    if(active.current)return;active.current=true;setBusy(true);setError("");setNotice("");
    try {
      const result=await readProtonContentIndex(scope);
      if(mounted.current){setStatus(result);setNeedsCheck(false);setUnreadable(false);}
    }catch(cause){if(mounted.current)readFailure(cause);}
    finally{active.current=false;if(mounted.current)setBusy(false);}
  }
  useEffect(()=>{
    if (observedRefresh.current===refreshKey || active.current || !status?.enabled || needsCheck) return;
    observedRefresh.current=refreshKey;
    void check();
    // A completed content search requests a read; wait for the current index operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[refreshKey,busy,status?.enabled,needsCheck]);
  async function change(action:"enable"|"disable"|"clear") {
    if(active.current||(!status&&!(action==="clear"&&unreadable))||needsCheck)return;
    const expectedEnabled=unreadable?true:status!.enabled;
    active.current=true;setBusy(true);setError("");setNotice("");
    try {
      const result=action==="clear"?await clearProtonContentIndex(scope):await configureProtonContentIndex(scope,action==="enable");
      if(action==="clear"&&result.enabled!==expectedEnabled)throw new ApiError(502,"Invalid content index response",undefined,"unknown","proton-content-index-response");
      if(mounted.current){setStatus(result);setUnreadable(false);setConfirmation(null);setNotice(action==="clear"?c.cleared:c.savedPreference);}
    }catch(cause){if(mounted.current){setNeedsCheck(true);setConfirmation(null);setError(failure(cause,c.writeFailed));}}
    finally{active.current=false;if(mounted.current)setBusy(false);}
  }
  const number=new Intl.NumberFormat(language,{maximumFractionDigits:1});
  const size=status?status.byteLength>=1024*1024?`${number.format(status.byteLength/(1024*1024))} MiB`:status.byteLength>=1024?`${number.format(status.byteLength/1024)} KiB`:`${number.format(status.byteLength)} B`:"";
  return <>
    <details className="group rounded-xl border border-line bg-panel p-3 text-sm">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 font-medium">
        <span className="flex items-center gap-2"><ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180"/>{c.title}</span>{unreadable?<StatusTag tone="warning">{c.unavailable}</StatusTag>:status&&<StatusTag>{status.enabled?c.enabled:c.disabled}</StatusTag>}
      </summary>
      <section aria-label={c.title} className="space-y-3 pt-2" aria-busy={busy}>
        <p className="text-xs text-ink-secondary">{c.help}</p>
        <p className="text-xs text-ink-secondary">{c.disableHelp}</p>
        <label className="flex min-h-12 items-center gap-2">
          <input type="checkbox" checked={status?.enabled??false} disabled={busy||!status||needsCheck}
            onChange={event=>{if(event.target.checked)void change("enable");else setConfirmation("disable");}}/>
          {c.optIn}
        </label>
        <dl className="space-y-2 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2"><dt className="font-medium">{c.saved}</dt>
            <dd>{status?status.documentCount===0&&status.byteLength===0?c.empty:`${c.documents.replace("{count}",number.format(status.documentCount))} · ${size}`:error?c.unavailable:c.loading}</dd>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-2"><dt className="font-medium">{c.network}</dt>
            <dd><StatusTag tone={connected?"connection":"warning"}>{connected?c.connected:c.offline}</StatusTag></dd>
          </div>
        </dl>
        <p className="text-xs text-ink-secondary">{connected?c.verify:c.offlineHelp}</p>
        {busy&&<StatusTag role="status" activity="working">{c.working}</StatusTag>}
        {error&&<InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
        {needsCheck&&<InlineNotice tone="warning">{c.uncertain}</InlineNotice>}
        {notice&&<InlineNotice tone="neutral" announce="status">{notice}</InlineNotice>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button ref={statusTrigger} size="compact" disabled={busy} onClick={()=>{void check();}}>{c.refresh}</Button>
          <Button size="compact" variant="quiet" disabled={busy||needsCheck||(!unreadable&&(!status||status.documentCount===0&&status.byteLength===0))}
            onClick={()=>setConfirmation("clear")}>{c.clear}</Button>
        </div>
      </section>
    </details>
    {confirmation&&createPortal(<ModalFrame label={confirmation==="clear"?c.confirmClear:c.confirmDisable}
      onClose={()=>{if(!active.current)setConfirmation(null);}} fallbackFocus={()=>statusTrigger.current} className="!z-[130]" role="alertdialog">
      <section className="proton-confirm-dialog space-y-3 p-4 md:p-5">
        <DialogHeading title={confirmation==="clear"?c.confirmClear:c.confirmDisable} closeLabel={c.close} busy={busy}
          onClose={()=>{if(!active.current)setConfirmation(null);}}/>
        <p className="text-sm">{confirmation==="clear"?c.clearHelp:c.disableConfirmHelp}</p>
        <p className="text-xs text-ink-secondary">{c.scope}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button data-autofocus disabled={busy} onClick={()=>setConfirmation(null)}>{c.cancel}</Button>
          <Button variant="danger" disabled={busy} onClick={()=>{void change(confirmation);}}>{confirmation==="clear"?c.confirmClearAction:c.confirmDisableAction}</Button>
        </div>
      </section>
    </ModalFrame>,document.body)}
  </>;
}
