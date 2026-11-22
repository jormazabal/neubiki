import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import {useRef,useState} from "react";
import {createPortal} from "react-dom";
import {Button} from "../../components/ui/Button";
import {ModalFrame} from "../../components/ui/ModalFrame";
import {SegmentedControl} from "../../components/ui/SegmentedControl";
import {DialogHeading} from "../../components/patterns/DialogHeading";
import {InlineNotice} from "../../components/patterns/InlineNotice";
import {reviewProtonSemantic,runProtonSemantic} from "../../lib/api/protonSemantic";
import {semanticProjectCopy,useSemanticCopy} from "../../lib/i18n/semanticCopy";
import {useUiLocale} from "../../lib/i18n/UiLocale";
import type {ProtonSemanticProjectReview,ProtonSemanticQuote,ProtonSemanticRequest,ProtonSemanticResult} from "../../types/protonSemantic";
import type {ProtonNode} from "../../types/protonWorkspace";
import type {ProtonToolTarget} from "../protonWorkspace/protonToolTypes";
import {ProtonAiSourcesDialog,type SelectedAiSource} from "./ProtonAiSourcesDialog";

export function ProtonSemanticSearchDialog({target,root,availableSources=[],onClose}:{
  target:ProtonToolTarget;root:ProtonNode;availableSources?:SelectedAiSource[];onClose:()=>void;
}){
  return <SemanticContent key={JSON.stringify([target.address,target.baseRevisionId,target.editorKey])}
    target={target} root={root} availableSources={availableSources} onClose={onClose}/>;
}
function SemanticContent({target,root,availableSources,onClose}:{target:ProtonToolTarget;root:ProtonNode;availableSources:SelectedAiSource[];onClose:()=>void}){
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const c=useSemanticCopy(),locale=useUiLocale();
  const p=semanticProjectCopy[locale];
  const [scope,setScope]=useState<"selected"|"project">("selected");
  const [query,setQuery]=useState("");
  const [sources,setSources]=useState(()=>availableSources.filter(source=>source.kind==="text").slice(0,3));
  const [picker,setPicker]=useState(false),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[consent,setConsent]=useState(false);
  const [quote,setQuote]=useState<ProtonSemanticQuote|null>(null),[result,setResult]=useState<ProtonSemanticResult|null>(null),[error,setError]=useState("");
  const active=useRef(false),sourceTrigger=useRef<HTMLButtonElement>(null);
  const project=scope==="project";
  const title=project?p.title:c.title;
  const input:ProtonSemanticRequest={...target.address,baseRevisionId:target.baseRevisionId,query:query.trim(),
    ...(project?{scope,sources:[]}:{sources:sources.map(({nodeId,revisionId})=>({nodeId,revisionId}))})};
  const canReview=Boolean(input.query)&&(project||sources.length>0);
  const expired=quote&&Date.now()/1000>quote.expiresAt;
  function changed(){setQuote(null);setConsent(false);setError("");}
  async function review(){
    if(active.current||!canReview||sent)return;
    active.current=true;setBusy(true);changed();
    try{
      const reviewed=await reviewProtonSemantic(input);
      if(project&&(!reviewed.sourceCount||reviewed.project?.sources.length!==reviewed.sourceCount))throw new Error(p.preparingError);
      setQuote(reviewed);
    }catch(cause){setError(runtimeErrorMessage(cause,project?p.preparingError:c.reviewError));}
    finally{active.current=false;setBusy(false);}
  }
  async function run(){
    if(active.current||!quote||!consent||sent)return;
    if(Date.now()/1000>quote.expiresAt){setError(c.expired);setQuote(null);setConsent(false);return;}
    active.current=true;setBusy(true);setSent(true);setError("");
    try{setResult(await runProtonSemantic(input,quote));}catch(cause){setError(runtimeErrorMessage(cause,c.runError));}
    finally{active.current=false;setBusy(false);}
  }
  function closePicker(){setPicker(false);requestAnimationFrame(()=>sourceTrigger.current?.focus());}
  return createPortal(<ModalFrame label={title} onClose={()=>{if(!active.current)onClose();}} className="!z-[130]">
    <section className="proton-confirm-dialog !w-full !max-w-2xl space-y-3 p-4 md:p-5">
      <DialogHeading title={title} closeLabel={c.close} busy={busy} onClose={onClose}/>
      <fieldset disabled={busy||sent} className="min-w-0">
        <SegmentedControl label={p.scopeLabel} value={scope}
          options={[{value:"selected",label:p.selectedScope},{value:"project",label:p.projectScope}]}
          onChange={value=>{setScope(value);changed();}}/>
      </fieldset>
      <p className="text-sm text-ink-secondary">{project?p.intro:c.scope}</p>
      <label className="grid gap-1 text-sm font-medium">{c.purpose}<textarea data-autofocus className="ui-field" rows={3} maxLength={2000} value={query}
        disabled={busy||sent} onChange={event=>{setQuery(event.target.value);changed();}}/></label>
      {!project&&<>
        <Button ref={sourceTrigger} disabled={busy||sent} onClick={()=>setPicker(true)}>{c.choose}</Button>
        {sources.length>0?<ul aria-label={c.selected} className="space-y-1 break-words text-sm">{sources.map(source=><li key={source.nodeId}>{source.name}</li>)}</ul>
          :<p className="text-sm text-ink-secondary">{c.noneSelected}</p>}
      </>}
      <p className="text-xs text-ink-secondary">{project?p.privacy:c.privacy}</p>
      {error&&<InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {busy&&<p role="status" className="text-sm">{sent ? (project?p.ranking:c.running) : (project?p.scanning:c.working)}</p>}
      {quote&&!result&&<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-line p-3 text-xs">
        <dt>{c.model}</dt><dd className="break-words">{quote.model}</dd>
        <dt>{c.cost}</dt><dd>{new Intl.NumberFormat(locale,{style:"currency",currency:"EUR",maximumFractionDigits:4}).format(quote.estimatedEur)}</dd>
        <dt>{c.count}</dt><dd>{quote.sourceCount}</dd>
        <dt>{c.expires}</dt><dd>{new Date(quote.expiresAt*1000).toLocaleTimeString(locale)}</dd>
      </dl>}
      {quote?.project&&<ProjectCoverage review={quote.project} copy={p} showSources={!result}/>}
      {quote&&!sent&&<label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy}
        onChange={event=>setConsent(event.target.checked)}/>{c.consent}</label>}
      {expired&&!sent&&<InlineNotice tone="warning">{c.expired}</InlineNotice>}
      {result&&<section className="space-y-3" aria-label={title}>
        <p className="text-xs text-ink-secondary">{project?p.results:c.bounded}</p>
        {!result.usageRecorded&&<InlineNotice tone="warning">{c.usage}</InlineNotice>}
        {result.state==="unconfirmed"?<InlineNotice tone="warning" announce="status">{c.unconfirmed}</InlineNotice>:
          <ol className="max-h-[42dvh] space-y-3 overflow-auto">{result.results.map((item,index)=><li key={item.nodeId} className="space-y-1 rounded-xl border border-line p-3 text-sm">
            <h3 className="break-words font-semibold">{index+1}. {item.name}</h3>
            <p className="font-medium">{c[item.relevance]}</p><p className="whitespace-pre-wrap break-words">{item.explanation}</p>
            {item.evidence?<blockquote className="whitespace-pre-wrap break-words border-l-2 border-line pl-3" aria-label={c.evidence}>{item.evidence}</blockquote>:<p className="text-xs text-ink-secondary">{c.noEvidence}</p>}
            <p className="break-all text-xs text-ink-secondary">{c.revision}: {item.revisionId}</p>
          </li>)}</ol>}
      </section>}
      <footer className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={onClose}>{c.close}</Button>
        {!sent&&<Button disabled={busy||!canReview} onClick={()=>void review()}>{project?p.review:c.review}</Button>}
        {quote&&!sent&&<Button variant="primary" disabled={busy||!consent||Boolean(expired)} onClick={()=>void run()}>{c.confirm}</Button>}
      </footer>
    </section>
    {picker&&<ProtonAiSourcesDialog root={root} address={target.address} initial={sources} visionEnabled={false} textOnly
      onClose={closePicker} onConfirm={selection=>{setSources(selection.filter(source=>source.kind==="text"));changed();closePicker();}}/>}
  </ModalFrame>,document.body);
}

function ProjectCoverage({review,copy,showSources}:{
  review:ProtonSemanticProjectReview;copy:typeof semanticProjectCopy.es;showSources:boolean;
}){
  const coverage=review.coverage;
  const metrics=[
    [copy.folders,coverage.scannedFolders],
    [copy.eligible,coverage.eligibleFiles],
    [copy.unsupported,coverage.unsupportedFiles],
    [copy.unavailable,coverage.unavailableFiles],
    [copy.omitted,coverage.omittedFiles],
    [copy.failed,coverage.failedFolders],
    [copy.excerpted,review.excerptedFiles],
  ] as const;
  return <div className="space-y-2">
    <InlineNotice tone={review.complete?"success":"warning"} announce="status">{review.complete?copy.complete:copy.partial}</InlineNotice>
    {showSources&&<>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs text-ink-secondary sm:grid-cols-[1fr_auto_1fr_auto]">
        {metrics.filter(([,count],index)=>index<2||count>0).map(([label,count])=>
          <div className="contents" key={label}><dt>{label}</dt><dd className="text-right tabular-nums">{count}</dd></div>)}
      </dl>
      {coverage.limited&&<p className="text-xs text-ink-secondary">{copy.limited}</p>}
      <h3 className="text-sm font-medium">{copy.sources}</h3>
      <ul aria-label={copy.sources} tabIndex={0} className="max-h-[24dvh] divide-y divide-line overflow-auto rounded-xl border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        {review.sources.map(source=><li key={source.nodeId} className="space-y-1 px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="min-w-0 break-words text-sm font-medium">{source.name}</span>
            <span className="text-xs text-ink-secondary">{source.excerpted?copy.excerpt:copy.fullText}</span></div>
          <p className="break-all text-xs text-ink-secondary">{copy.revision} · {source.revisionId}</p>
        </li>)}
      </ul>
    </>}
  </div>;
}
