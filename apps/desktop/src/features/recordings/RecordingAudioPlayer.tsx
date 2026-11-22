import {useEffect,useRef,useState} from "react";
import {ModalFrame} from "../../components/ui/ModalFrame";
import {recordingAudio,recordingRequest} from "../../lib/api/recordings";
import {useRecordingCopy} from "../../lib/i18n/recordingCopy";
import {useRuntimeErrorMessage} from "../../lib/i18n/protonErrors";
const button="inline-flex min-h-11 items-center justify-center gap-2 rounded px-3 text-xs font-medium hover:bg-brand-hover disabled:opacity-40";
const time=(samples:number)=>{const seconds=Math.floor(samples/24000);return `${Math.floor(seconds/60).toString().padStart(2,"0")}:${(seconds%60).toString().padStart(2,"0")}`;};
type PlayerError = {key:"invalid"|"releaseLost"|"playbackError"} | {cause:unknown};
/** Reads short blocks while a renewable lease prevents audio retention cleanup. */
export function RecordingAudioPlayer({session,range,onClose}:{session:{id:string;samples:number};range?:{start:number;samples:number};onClose:()=>void}){
 const {copy} = useRecordingCopy();
 const runtimeErrorMessage=useRuntimeErrorMessage();
 const player = copy.player;
 const from=range?.start??0,to=range?Math.min(session.samples,range.start+range.samples):session.samples;
 const valid=Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from>=0&&to>from&&to<=session.samples;
 const owner=useRef(crypto.randomUUID()),audio=useRef<HTMLAudioElement>(null),block=useRef(from);const [position,setPosition]=useState(from),[elapsed,setElapsed]=useState(0),[url,setUrl]=useState(""),[error,setError]=useState<PlayerError|null>(null),[playing,setPlaying]=useState(false),[loading,setLoading]=useState(false);
 useEffect(()=>{let live=true,objectUrl="";setUrl("");setElapsed(0);setError(null);setLoading(true);audio.current?.pause();block.current=position;
  if(valid&&(position<from||position>=to)){setPosition(from);setLoading(false);return;}
  if(!valid){setError({key:"invalid"});setLoading(false);return;}
  void recordingRequest("lease",{id:session.id,owner:owner.current}).then(()=>recordingAudio(session.id,position,Math.min(24000*30,to-position))).then(data=>{if(!live)return;const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));objectUrl=URL.createObjectURL(new Blob([bytes],{type:"audio/wav"}));setUrl(objectUrl);}).catch(cause=>{if(live){setError({cause});setPlaying(false);}}).finally(()=>{if(live)setLoading(false);});
  const timer=setInterval(()=>void recordingRequest("lease",{id:session.id,owner:owner.current}).catch(()=>{if(live){audio.current?.pause();setPlaying(false);setError({key:"releaseLost"});}}),20000);
  return()=>{live=false;clearInterval(timer);audio.current?.pause();URL.revokeObjectURL(objectUrl);};
 },[position,session.id,to,valid]);
 useEffect(()=>()=>{void recordingRequest("release",{id:session.id,owner:owner.current}).catch(()=>undefined);},[session.id]);
 useEffect(()=>{if(playing&&url)void audio.current?.play().catch(()=>{setError({key:"playbackError"});setPlaying(false);});},[url,playing]);
 return <ModalFrame label={player.title} onClose={onClose}>
  <section className="max-h-[calc(100dvh-24px)] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-4 text-xs leading-5 [overflow-wrap:anywhere]">
   <h3 className="font-semibold">{range?player.transcriptExcerpt:player.local}</h3>
   {range&&<p className="mt-2 text-ink-secondary">{time(from)}–{time(to)} · {player.captureInterval}</p>}
   {error&&<p role="alert" className="my-2 text-red-800">{"cause" in error?runtimeErrorMessage(error.cause,player.playbackError):player[error.key]}</p>}
   <audio ref={audio} src={url||undefined}
    onTimeUpdate={e=>setElapsed(Math.min(to-position,Math.floor(e.currentTarget.currentTime*24000)))}
    onError={()=>{setPlaying(false);setError({key:"playbackError"});}}
    onEnded={()=>{const next=block.current+24000*30;if(next<to)setPosition(next);else{setPlaying(false);setPosition(from);}}}/>
   <p className="my-3">{time(Math.min(position+elapsed,to))} / {time(to)}</p>
   <input aria-label={player.position} type="range" className="min-h-11 w-full accent-brand-orange" min={from}
    max={Math.max(from,to-1)} step={24000} value={Math.min(position+elapsed,Math.max(from,to-1))}
    disabled={!valid} onChange={e=>setPosition(Number(e.target.value))}/>
   {loading&&<p role="status">{player.loading}</p>}
   <footer className="mt-3 flex flex-wrap gap-2">
    <button className={button} disabled={!valid||loading||!url} onClick={()=>{if(playing)audio.current?.pause();setPlaying(!playing);}}>{playing?copy.pause:player.play}</button>
    <button data-autofocus className={button+" ml-auto"} onClick={onClose}>{player.close}</button>
   </footer>
  </section>
 </ModalFrame>;
}
