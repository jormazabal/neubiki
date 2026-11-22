import {afterEach,expect,it,vi} from "vitest";
import {requestJson} from "./client";
import {reviewProtonSemantic,runProtonSemantic} from "./protonSemantic";
import type {ProtonSemanticQuote,ProtonSemanticRequest} from "../../types/protonSemantic";
vi.mock("./client",()=>({requestJson:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
it("sends only exact source references and scoped purpose plus reviewed consent",async()=>{
  vi.mocked(requestJson).mockResolvedValue({});
  const input={accountId:"a",rootId:"root",nodeId:"active",baseRevisionId:"rev",query:"Purpose",markdown:"Private draft",sources:[{nodeId:"source",revisionId:"source~rev",name:"Private name",text:"Private text"}]};
  const quote={quoteId:"quote",issuedAt:1000,expiresAt:1300,estimatedEur:.1,sourceCount:1,model:"model"};
  await reviewProtonSemantic(input);await runProtonSemantic(input,quote);
  const expected={accountId:"a",rootId:"root",nodeId:"active",baseRevisionId:"rev",query:"Purpose",sources:[{nodeId:"source",revisionId:"source~rev"}]};
  expect(JSON.parse(vi.mocked(requestJson).mock.calls[0][1]?.body as string)).toEqual(expected);
  expect(JSON.parse(vi.mocked(requestJson).mock.calls[1][1]?.body as string)).toEqual({...expected,quoteId:"quote",issuedAt:1000,confirmed:true});
});
it("takes project execution references only from the displayed quote",async()=>{
  const input:ProtonSemanticRequest={accountId:"a",rootId:"root",nodeId:"active",baseRevisionId:"rev",
    query:"Purpose",scope:"project",sources:[{nodeId:"ignored",revisionId:"other"}]};
  const quote:ProtonSemanticQuote={quoteId:"quote",issuedAt:1000,expiresAt:1300,estimatedEur:.1,sourceCount:1,model:"model",
    project:{complete:false,excerptedFiles:1,coverage:{scannedFolders:1,eligibleFiles:1,unsupportedFiles:0,
      unavailableFiles:0,omittedFiles:0,failedFolders:0,limited:false},
      sources:[{nodeId:"source",revisionId:"source~rev",name:"No private name on wire",excerpted:true}]}};
  await reviewProtonSemantic(input);
  await runProtonSemantic(input,quote);
  const readBody=(index:number)=>JSON.parse(vi.mocked(requestJson).mock.calls[index][1]?.body as string);
  expect(readBody(0)).toEqual({...input,sources:[]});
  expect(readBody(1)).toEqual({...input,sources:[{nodeId:"source",revisionId:"source~rev"}],issuedAt:1000,quoteId:"quote",confirmed:true});
  await expect(runProtonSemantic(input,{...quote,project:undefined})).rejects.toThrow();
  expect(requestJson).toHaveBeenCalledTimes(2);
});
