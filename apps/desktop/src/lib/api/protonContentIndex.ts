import { ApiError, requestJson } from "./client";
import type { ProtonContentIndexScope, ProtonContentIndexStatus } from "../../types/protonContentIndex";
const invalidResponse=()=>new ApiError(502,"Invalid content index response",undefined,"unknown","proton-content-index-response");

function checkedStatus(value:ProtonContentIndexStatus):ProtonContentIndexStatus {
  if (!value || typeof value.enabled!=="boolean" || !Number.isSafeInteger(value.documentCount) || value.documentCount<0
    || !Number.isSafeInteger(value.byteLength) || value.byteLength<0
    || !value.enabled && (value.documentCount!==0 || value.byteLength!==0)) {
    throw invalidResponse();
  }
  return value;
}
async function post(action:string,body:ProtonContentIndexScope & {enabled?:boolean},signal?:AbortSignal) {
  return checkedStatus(await requestJson<ProtonContentIndexStatus>(`/api/proton/workspace/${action}`,{
    method:"POST",body:JSON.stringify(body),signal,timeoutMs:60_000,
  }));
}
export function readProtonContentIndex(scope:ProtonContentIndexScope,signal?:AbortSignal) {
  return post("content-index-status",scope,signal);
}
export async function configureProtonContentIndex(scope:ProtonContentIndexScope,enabled:boolean) {
  const result=await post("content-index-configure",{...scope,enabled});
  if(result.enabled!==enabled)throw invalidResponse();
  return result;
}
export async function clearProtonContentIndex(scope:ProtonContentIndexScope) {
  const result=await post("content-index-clear",scope);
  if(result.documentCount!==0||result.byteLength!==0)throw invalidResponse();
  return result;
}
