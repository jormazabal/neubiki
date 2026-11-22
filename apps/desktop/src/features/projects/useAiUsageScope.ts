import {useEffect,useRef,useState} from "react";
import {getAiUsageSummary} from "../../lib/api/ai";
import {getProtonErrorMessage} from "../../lib/i18n/protonErrors";
import type {UiLanguage} from "../../lib/i18n/uiCopy";
import type {AiUsageSummaryResponse} from "../../types/domain";
import type {AiUsageQuery} from "../../types/aiUsage";

const key=(query:AiUsageQuery)=>JSON.stringify([query.month,query.projectId]);
/** A local query never replaces the global summary held by the workspace. */
type Issue = {kind:"month"|"scope"} | {kind:"read";cause:unknown};
const errorCopy = {
  es: {month:"Elige un mes válido antes de consultar.", scope:"El resultado no confirma el alcance elegido. Se conserva la consulta y no se atribuye otro resumen al proyecto.", read:"No se pudo consultar el consumo. El importe sigue sin confirmar."},
  en: {month:"Choose a valid month before checking.", scope:"The result does not match the selected scope. Your selection is preserved.", read:"Usage could not be checked. The amount is unconfirmed."},
};
export function useAiUsageScope(initial:AiUsageSummaryResponse|null, language:UiLanguage="es"){
  const[query,setQuery]=useState<AiUsageQuery>(()=>({month:initial?.month??new Date().toISOString().slice(0,7),projectId:""}));
  const[confirmed,setConfirmed]=useState<{key:string;summary:AiUsageSummaryResponse}|null>(null);
  const[loading,setLoading]=useState(false),[issue,setIssue]=useState<Issue|null>(null);
  const generation=useRef(0),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  async function load(next:AiUsageQuery=query){
    const current=++generation.current;setQuery(next);setIssue(null);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(next.month)){setLoading(false);setIssue({kind:"month"});return;}
    setLoading(true);
    try{const summary=await getAiUsageSummary(next.month,next.projectId||undefined);
      if(!alive.current||generation.current!==current)return;
      if(summary.month!==next.month||(summary.projectId??"")!==next.projectId){setIssue({kind:"scope"});return;}
      setConfirmed({key:key(next),summary});
    }catch(cause){if(alive.current&&generation.current===current)setIssue({kind:"read",cause});}
    finally{if(alive.current&&generation.current===current)setLoading(false);}
  }
  const summary=confirmed?.key===key(query)?confirmed.summary:!query.projectId&&!initial?.projectId&&initial?.month===query.month?initial:null;
  const projects=initial?.availableProjects??confirmed?.summary.availableProjects??[];
  const copy=errorCopy[language];
  const error=issue?.kind==="read"?getProtonErrorMessage(issue.cause,copy.read,language):issue?copy[issue.kind]:"";
  return{query,summary,projects,loading,error,load};
}
