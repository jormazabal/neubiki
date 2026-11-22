import {requestJson} from "./client";
import type {ProtonSemanticRequest,ProtonSemanticQuote,ProtonSemanticResult} from "../../types/protonSemantic";
function payload(input:ProtonSemanticRequest){
  const {accountId,rootId,nodeId,baseRevisionId,query}=input;
  const document={accountId,rootId,nodeId,baseRevisionId,query};
  return input.scope==="project"
    ? {...document,scope:input.scope,sources:[]}
    : {...document,sources:input.sources.map(({nodeId,revisionId})=>({nodeId,revisionId}))};
}
export function reviewProtonSemantic(input:ProtonSemanticRequest){
  return requestJson<ProtonSemanticQuote>("/api/proton/ai/semantic-review",{method:"POST",body:JSON.stringify(payload(input)),timeoutMs:120_000});
}
export async function runProtonSemantic(input:ProtonSemanticRequest,quote:ProtonSemanticQuote){
  const body=payload(input);
  const sources=input.scope==="project"
    ? quote.project?.sources.map(({nodeId,revisionId})=>({nodeId,revisionId}))
    : body.sources;
  if(!sources?.length||sources.length!==quote.sourceCount)throw new Error("Invalid semantic source review");
  return requestJson<ProtonSemanticResult>("/api/proton/ai/semantic-run",{method:"POST",body:JSON.stringify({...body,sources,issuedAt:quote.issuedAt,quoteId:quote.quoteId,confirmed:true}),timeoutMs:180_000});
}
