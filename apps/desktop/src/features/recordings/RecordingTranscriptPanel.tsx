import {useEffect,useState} from "react";
import {recordingTranscript} from "../../lib/api/recordings";
import { Button } from "../../components/ui/Button";
import type { MeetingPublicationSource } from "../../lib/api/meetingPublication";
import type {RecordingTranscript,RecordingTranscriptSegment} from "../../types/recording";
import {useRecordingCopy} from "../../lib/i18n/recordingCopy";
import {useRuntimeErrorMessage} from "../../lib/i18n/protonErrors";
const time=(samples:number)=>{const seconds=Math.floor(samples/24000);return `${Math.floor(seconds/60).toString().padStart(2,"0")}:${(seconds%60).toString().padStart(2,"0")}`;};
export function RecordingTranscriptPanel({sessionId,onListen,onPublish}:{sessionId:string;onListen:(segment:RecordingTranscriptSegment)=>void;onPublish?:(source:MeetingPublicationSource)=>void}){
 const {copy}=useRecordingCopy();
 const runtimeErrorMessage=useRuntimeErrorMessage();
 const original=copy.original;
 const [source,setSource]=useState<RecordingTranscript|null>(null),[error,setError]=useState<{cause:unknown}|null>(null);
 useEffect(()=>{let live=true;setSource(null);setError(null);void recordingTranscript(sessionId).then(v=>{if(live)setSource(v);}).catch(cause=>{if(live)setError({cause});});return()=>{live=false;};},[sessionId]);
 return <section aria-label={original.label} className="min-w-0 rounded bg-panel p-3 text-xs leading-5 [overflow-wrap:anywhere]">
  <h4 className="font-medium">{original.heading}</h4>
  <p className="mt-1 text-ink-secondary">{original.description}</p>
  {error?<p role="alert" className="my-2 text-red-800">{runtimeErrorMessage(error.cause,original.readFailed)}</p>:!source?<p role="status">{original.loading}</p>:<>
   {source.unconfirmedCount>0&&<p role="status" className="my-2">{original.unconfirmed(source.unconfirmedCount)}</p>}
   {!source.audioAvailable&&<p className="my-2">{original.unavailable}</p>}
   <div className="max-h-72 overflow-y-auto">{source.segments.map(segment=><article key={segment.id} className="my-3">
    <header className="flex flex-wrap items-center gap-2">
     <b>{time(segment.start)}–{time(segment.start+segment.samples)}</b>
     <button className="min-h-11 rounded px-3 font-medium text-[#9A3412] hover:bg-brand-hover disabled:opacity-50"
      disabled={!source.audioAvailable} onClick={()=>onListen(segment)}>{original.listen}</button>
    </header>
    <p className="whitespace-pre-wrap">{segment.text}</p>
   </article>)}</div>
   {onPublish && source.segments.some(segment => segment.text.trim()) && <Button size="compact" onClick={() => onPublish({
    sessionId, sourceRevision: source.sourceRevision, title: source.title,
   })}>{original.publish}</Button>}
  </>}
 </section>;
}
