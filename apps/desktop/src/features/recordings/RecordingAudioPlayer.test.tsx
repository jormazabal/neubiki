import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {RecordingAudioPlayer} from "./RecordingAudioPlayer";
import {recordingAudio,recordingRequest} from "../../lib/api/recordings";
import {UiLocaleProvider} from "../../lib/i18n/UiLocale";
vi.mock("../../lib/api/recordings",()=>({recordingAudio:vi.fn(),recordingRequest:vi.fn()}));beforeEach(()=>{vi.mocked(recordingAudio).mockReset().mockResolvedValue("AA==");vi.mocked(recordingRequest).mockReset().mockResolvedValue({} as never);vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();vi.stubGlobal("URL",{createObjectURL:vi.fn(()=>"blob:audio"),revokeObjectURL:vi.fn()});});afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("recording source playback",()=>{
 it("reads at most30seconds per block and never advances beyond the selected capture fragment",async()=>{const view=render(<div><input aria-label="Acta detrás"/><RecordingAudioPlayer session={{id:"owned",samples:24000*100}} range={{start:24000*2,samples:24000*63}} onClose={vi.fn()}/></div>);expect((screen.getByRole("textbox",{name:"Acta detrás",hidden:true}) as HTMLInputElement).inert).toBe(true);await waitFor(()=>expect(recordingAudio).toHaveBeenCalledWith("owned",24000*2,24000*30));expect(recordingRequest).toHaveBeenCalledWith("lease",expect.objectContaining({id:"owned"}));fireEvent.ended(view.container.querySelector("audio")!);await waitFor(()=>expect(recordingAudio).toHaveBeenCalledWith("owned",24000*32,24000*30));fireEvent.ended(view.container.querySelector("audio")!);await waitFor(()=>expect(recordingAudio).toHaveBeenCalledWith("owned",24000*62,24000*3));expect(recordingAudio).toHaveBeenCalledTimes(3);view.unmount();expect(recordingRequest).toHaveBeenCalledWith("release",expect.objectContaining({id:"owned"}));});
 it("refuses an invalid selection with localized playback controls and no audio read",()=>{
  render(<UiLocaleProvider language="en"><RecordingAudioPlayer session={{id:"owned",samples:24000}} range={{start:48000,samples:24000}} onClose={vi.fn()}/></UiLocaleProvider>);
  expect(screen.getByRole("dialog",{name:"Listen to recording"})).toBeVisible();
  expect(screen.getByRole("slider",{name:"Playback position"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"Play"})).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("The audio interval is invalid.");
  expect(recordingAudio).not.toHaveBeenCalled();
  expect(recordingRequest).not.toHaveBeenCalled();
 });
});
