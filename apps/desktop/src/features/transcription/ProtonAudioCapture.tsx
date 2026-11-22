import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { pcmChunksToWavFile } from "../../lib/api/transcription";
import { startPcmAudioCapture, type PcmAudioCapture } from "./audioCapture";
import { useHandwrittenCopy } from "../../lib/i18n/handwrittenCopy";

const maxBytes = 60 * 24_000 * 2;

export function ProtonAudioCapture({ disabled, onClip }: {
  disabled?: boolean;
  onClip: (file: File | null) => void;
}) {
  const c = useHandwrittenCopy().audio;
  const [state, setState] = useState<"idle" | "starting" | "capturing" | "stopping" | "ready">("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const capture = useRef<PcmAudioCapture | null>(null);
  const mounted = useRef(false);
  const starting = useRef(false);
  const chunks = useRef<ArrayBuffer[]>([]);
  const bytes = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const clipChanged = useRef(onClip);
  clipChanged.current = onClip;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
      const active = capture.current;
      capture.current = null;
      if (active) void active.stop().catch(() => undefined);
      chunks.current = [];
    };
  }, []);

  async function stop() {
    const active = capture.current;
    if (!active) return;
    capture.current = null;
    window.clearTimeout(timer.current);
    setState("stopping");
    try {
      await active.stop();
      if (!mounted.current) return;
      if (!bytes.current) throw new Error(c.empty);
      clipChanged.current(pcmChunksToWavFile(chunks.current));
      setState("ready");
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : c.stopFailed);
        setState("idle");
      }
    } finally {
      chunks.current = [];
    }
  }

  async function start() {
    if (starting.current || capture.current || disabled) return;
    starting.current = true;
    setState("starting");
    setError("");
    setSeconds(0);
    chunks.current = [];
    bytes.current = 0;
    clipChanged.current(null);
    try {
      const active = await startPcmAudioCapture(chunk => {
        if (!capture.current) return;
        const remaining = maxBytes - bytes.current;
        if (remaining <= 0) return;
        const copied = chunk.byteLength <= remaining ? chunk : chunk.slice(0, remaining);
        chunks.current.push(copied);
        bytes.current += copied.byteLength;
        setSeconds(Math.floor(bytes.current / 48_000));
        if (bytes.current === maxBytes) void stop();
      });
      if (!mounted.current) {
        await active.stop();
        return;
      }
      capture.current = active;
      timer.current = window.setTimeout(() => { void stop(); }, 60_000);
      setState("capturing");
    } catch {
      if (mounted.current) {
        setError(c.startFailed);
        setState("idle");
      }
    } finally {
      starting.current = false;
    }
  }

  return <section className="space-y-2" aria-label={c.label}>
    {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
    <div className="flex flex-wrap items-center gap-2">
      {state === "capturing" ? <Button onClick={() => void stop()} disabled={disabled}>
        <Square size={16} aria-hidden="true" /> {c.stop}
      </Button> : <Button onClick={() => void start()} disabled={disabled || state === "starting" || state === "stopping"}>
        <Mic size={16} aria-hidden="true" /> {state === "ready" ? c.again : c.start}
      </Button>}
      {state === "starting" && <span role="status" className="text-sm">{c.starting}</span>}
      {state === "capturing" && <span className="text-sm" aria-live="off">{c.capturing.replace("{seconds}",String(seconds))}</span>}
      {state === "stopping" && <span role="status" className="text-sm">{c.stopping}</span>}
      {state === "ready" && <span role="status" className="text-sm">{c.ready.replace("{seconds}",String(Math.max(1,seconds)))}</span>}
    </div>
  </section>;
}
