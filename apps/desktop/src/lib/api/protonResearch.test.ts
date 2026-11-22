import { afterEach,expect,it,vi } from "vitest";
import { requestJson } from "./client";
import { checkProtonResearch,removeProtonResearchReport,reviewProtonResearch,runProtonResearch } from "./protonResearch";
vi.mock("./client",()=>({requestJson:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
it("serializes only public question, document identity and opted-in source references",async()=>{
  vi.mocked(requestJson).mockResolvedValue({});
  const input={accountId:"a",rootId:"root",nodeId:"node",baseRevisionId:"node~rev",question:"Public question",markdown:"Private draft",retainPublicReport:true,sources:[{nodeId:"source",revisionId:"source~rev",name:"Private name",text:"Private text"}]};
  await reviewProtonResearch(input);await runProtonResearch(input,{quoteId:"quote",attemptId:"attempt"});
  const expected={accountId:"a",rootId:"root",nodeId:"node",baseRevisionId:"node~rev",question:"Public question",retainPublicReport:true,sources:[{nodeId:"source",revisionId:"source~rev"}]};
  expect(JSON.parse(vi.mocked(requestJson).mock.calls[0][1]?.body as string)).toEqual(expected);
  expect(JSON.parse(vi.mocked(requestJson).mock.calls[1][1]?.body as string)).toEqual({...expected,quoteId:"quote",attemptId:"attempt",confirmed:true});
  expect(vi.mocked(requestJson).mock.calls[1][1]?.timeoutMs).toBe(240_000);
});
it("omits sources when none are selected and keeps the public-only timeout",async()=>{
  vi.mocked(requestJson).mockResolvedValue({});
  await runProtonResearch({accountId:"a",rootId:"root",nodeId:"node",baseRevisionId:"rev",question:"Question"},{quoteId:"quote",attemptId:"attempt"});
  const options=vi.mocked(requestJson).mock.calls[0][1];
  expect(JSON.parse(options?.body as string)).not.toHaveProperty("sources");
  expect(JSON.parse(options?.body as string)).not.toHaveProperty("retainPublicReport");
  expect(options?.timeoutMs).toBe(120_000);
});

it("looks up attempts with document identity and an optional receipt ID only",async()=>{
  vi.mocked(requestJson).mockResolvedValue({attempts:[]});
  const identity={accountId:"a",rootId:"root",nodeId:"node"};
  const address={...identity,baseRevisionId:"rev",markdown:"Private draft",question:"Public question"};
  await checkProtonResearch(address,"attempt");
  expect(requestJson).toHaveBeenCalledWith("/api/proton/ai/research-status",{
    method:"POST",body:JSON.stringify({...identity,attemptId:"attempt"}),
  });
  await checkProtonResearch(address);
  expect(requestJson).toHaveBeenLastCalledWith("/api/proton/ai/research-status",{
    method:"POST",body:JSON.stringify(identity),
  });
});

it("sends only the exact receipt scope and confirmation when removing a local report",async()=>{
  vi.mocked(requestJson).mockResolvedValue({attempts:[]});
  const identity={accountId:"a",rootId:"root",nodeId:"node"};
  const address={...identity,markdown:"Private draft"};
  await removeProtonResearchReport(address,"attempt");
  expect(requestJson).toHaveBeenCalledWith("/api/proton/ai/research-report-delete",{
    method:"POST",body:JSON.stringify({...identity,attemptId:"attempt",confirmed:true}),
  });
});
