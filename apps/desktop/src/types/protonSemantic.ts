import type { ProtonDocumentKey } from "./protonWorkspace";
type ProtonSemanticSourceRef={nodeId:string;revisionId:string};
export type ProtonSemanticRequest=ProtonDocumentKey & {baseRevisionId:string;query:string;scope?:"project";sources:ProtonSemanticSourceRef[]};
export type ProtonSemanticProjectReview={
  complete:boolean;
  excerptedFiles:number;
  coverage:{
    scannedFolders:number;
    eligibleFiles:number;
    unsupportedFiles:number;
    unavailableFiles:number;
    omittedFiles:number;
    failedFolders:number;
    limited:boolean;
  };
  sources:(ProtonSemanticSourceRef & {name:string;excerpted:boolean})[];
};
export type ProtonSemanticQuote={quoteId:string;issuedAt:number;expiresAt:number;model:string;estimatedEur:number;sourceCount:number;project?:ProtonSemanticProjectReview};
export type ProtonSemanticResult={state:"completed"|"unconfirmed";limitedToSelection:boolean;usageRecorded:boolean;
  results:{nodeId:string;revisionId:string;name:string;relevance:"high"|"medium"|"low"|"none";explanation:string;evidence:string|null}[]};
