import { afterEach,expect,it,vi } from "vitest";
import { requestJson } from "./client";
import { readProtonContentIndex,configureProtonContentIndex,clearProtonContentIndex } from "./protonContentIndex";
vi.mock("./client",async importOriginal=>({...await importOriginal<object>(),requestJson:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
const scope={accountId:"a",rootId:"root"};
it("sends only the scoped index contract for each action",async()=>{
  vi.mocked(requestJson).mockResolvedValue({enabled:true,documentCount:0,byteLength:0});
  await readProtonContentIndex(scope);await configureProtonContentIndex(scope,true);await clearProtonContentIndex(scope);
  expect(vi.mocked(requestJson).mock.calls.map(([path,options])=>[path,JSON.parse(options?.body as string)])).toEqual([
    ["/api/proton/workspace/content-index-status",scope],["/api/proton/workspace/content-index-configure",{...scope,enabled:true}],
    ["/api/proton/workspace/content-index-clear",scope],
  ]);
});
it.each([
  {enabled:"true",documentCount:0,byteLength:0},
  {enabled:true,documentCount:-1,byteLength:0},
  {enabled:true,documentCount:0,byteLength:Number.MAX_SAFE_INTEGER+1},
  {enabled:false,documentCount:1,byteLength:1},
])("rejects incompatible returned index state %j",async status=>{
  vi.mocked(requestJson).mockResolvedValue(status);
  await expect(readProtonContentIndex(scope)).rejects.toMatchObject({code:"proton-content-index-response"});
});
it("does not confirm a mismatched preference or a clear with retained data",async()=>{
  vi.mocked(requestJson).mockResolvedValue({enabled:false,documentCount:0,byteLength:0});
  await expect(configureProtonContentIndex(scope,true)).rejects.toMatchObject({code:"proton-content-index-response"});
  vi.mocked(requestJson).mockResolvedValue({enabled:true,documentCount:1,byteLength:1});
  await expect(clearProtonContentIndex(scope)).rejects.toMatchObject({code:"proton-content-index-response"});
});
