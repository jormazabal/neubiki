import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { readProtonResourceCatalog, type ProtonResourceCatalog } from "../../lib/api/protonResources";
import { readDocument } from "../../lib/api/protonWorkspace";
import { renderProtonNotePage, type ProtonNotePageRender } from "../../lib/api/protonNoteEmbed";
import { uploadProtonImageContent } from "../../lib/api/protonImageAssets";
import { markdownImage } from "../../lib/markdownImage";
import type { HandwrittenNoteContent } from "../../types/domain";
import type { ProtonToolTarget } from "./protonToolTypes";
import { useHandwrittenCopy } from "../../lib/i18n/handwrittenCopy";

export function ProtonNoteEmbedDialog({ target, validate, onInsert, onClose }: {
  target:ProtonToolTarget; validate:()=>boolean; onInsert:(markdown:string)=>boolean; onClose:()=>void;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const {embed:c,common} = useHandwrittenCopy();
  const [catalog,setCatalog]=useState<ProtonResourceCatalog|null>(null);
  const [source,setSource]=useState<{nodeId:string;revisionId:string;note:HandwrittenNoteContent}|null>(null);
  const [pageId,setPageId]=useState("");
  const [preview,setPreview]=useState<ProtonNotePageRender|null>(null);
  const [asset,setAsset]=useState("");
  const [reviewed,setReviewed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [unknown,setUnknown]=useState(false);
  const live=useRef(false),pending=useRef(false);
  useEffect(()=>{
    live.current=true;
    const controller=new AbortController();
    void readProtonResourceCatalog(target.address.accountId,target.address.rootId,controller.signal)
      .then(result=>{if(live.current)setCatalog(result);},cause=>{if(!controller.signal.aborted)setError(runtimeErrorMessage(cause,c.catalogFailed));});
    return()=>{live.current=false;controller.abort();};
  },[target.address.accountId,target.address.rootId]);
  async function run(task:()=>Promise<void>) {
    if(pending.current)return;pending.current=true;setBusy(true);setError("");
    try{await task();}catch(cause){if(live.current)setError(runtimeErrorMessage(cause,c.unconfirmed));}
    finally{pending.current=false;if(live.current)setBusy(false);}
  }
  function check(){if(!validate())throw new Error(c.targetChanged);}
  async function select(nodeId:string) {
    setPreview(null);setSource(null);setPageId("");setAsset("");setReviewed(false);
    if(!nodeId)return;
    check();
    const document=await readDocument({...target.address,nodeId});
    if(!live.current)return;
    if(!document.handwritten)throw new Error(c.sourceChanged);
    setSource({nodeId,revisionId:document.revisionId,note:document.handwritten});
    setPageId(document.handwritten.pages[0]?.id??"");
  }
  async function render() {
    if(!source||!pageId)return;check();
    const result=await renderProtonNotePage(target.address,target.baseRevisionId,{...source,pageId});
    if(live.current){setPreview(result);setAsset("");setReviewed(false);}
  }
  async function insert() {
    if(!preview||!reviewed||unknown)return;check();
    let path=asset;
    if(!path){
      setUnknown(true);
      path=await uploadProtonImageContent(target.address,preview.contentBase64);
      if(!live.current)return;setAsset(path);setUnknown(false);
    }
    check();
    // Interface language never rewrites the generated document caption.
    const alt=`${preview.sourceName} · página ${preview.pageNumber}`;
    const label=preview.sourceName.replace(/[\r\n]/g," ").replace(/[\\[\]`*_!&<>]/g,"\\$&");
    if(!onInsert(`${markdownImage(alt,path)}\n\nPágina ${preview.pageNumber} de [${label}](${preview.sourceRelativePath})\n`))
      throw new Error(c.insertChanged);
    onClose();
  }
  const notes=catalog?.resources.filter(item=>item.kind==="handwritten")??[];
  return createPortal(<ModalFrame label={c.title} onClose={()=>{if(!pending.current)onClose();}}>
    <section className="proton-confirm-dialog !max-w-3xl space-y-3 p-4 md:p-5">
      <DialogHeading title={c.title} closeLabel={common.close} onClose={()=>{if(!pending.current)onClose();}} busy={busy}/>
      <p className="text-sm">{c.destination}: <strong>{target.documentName??c.markdown}</strong></p>
      <p className="text-sm text-ink-secondary">{c.help}</p>
      {error&&<InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {catalog?.partial&&<InlineNotice tone="warning">{c.partial}</InlineNotice>}
      {!catalog&&!error&&<p role="status">{c.loading}</p>}
      {catalog&&<label className="grid gap-1 text-sm font-medium">{c.source}
        <select className="ui-field" value={source?.nodeId??""} disabled={busy||unknown} onChange={event=>{void run(()=>select(event.target.value));}}>
          <option value="">{c.choose}</option>{notes.map(item=><option key={item.node.nodeId} value={item.node.nodeId}>
            {[...item.parents.slice(1).map(parent=>parent.name),item.node.name].join(" / ")}
          </option>)}
        </select>
      </label>}
      {catalog&&!notes.length&&<p className="text-sm">{c.empty}</p>}
      {source&&<label className="grid gap-1 text-sm font-medium">{c.page}
        <select className="ui-field" value={pageId} disabled={busy||unknown} onChange={event=>{setPageId(event.target.value);setPreview(null);setAsset("");setReviewed(false);}}>
          {source.note.pages.map((page,index)=><option key={page.id} value={page.id}>{index+1}. {page.title||common.untitled}</option>)}
        </select>
      </label>}
      {source&&!unknown&&<Button disabled={busy||!pageId} onClick={()=>{void run(render);}}>{c.preview}</Button>}
      {preview&&<><img src={`data:image/png;base64,${preview.contentBase64}`} alt={c.imageAlt} className="max-h-96 max-w-full rounded-xl border border-line object-contain"/>
        <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy||unknown} onChange={event=>setReviewed(event.target.checked)}/>{c.review}</label></>}
      {asset&&<p className="break-all text-xs text-ink-secondary">{c.confirmed}: {asset}</p>}
      {unknown&&<InlineNotice tone="warning">{c.unknown}</InlineNotice>}
      <footer className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={onClose}>{common.close}</Button>
        <Button variant="primary" disabled={busy||!preview||!reviewed||unknown} onClick={()=>{void run(insert);}}>{busy?c.preparing:c.insert}</Button>
      </footer>
    </section>
  </ModalFrame>,document.body);
}
