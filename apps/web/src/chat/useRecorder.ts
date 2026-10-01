import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VOICE_MS } from "@tetris/config";
import { toast } from "@/state/chat";

const CANDIDATES: Array<[mime: string, ext: string]> = [
  ["audio/webm;codecs=opus", "webm"],
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/ogg;codecs=opus", "ogg"],
];

function pickFormat(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: "", ext: "webm" };
}

/**
 * Records a voice message entirely on this device. The audio never leaves the
 * browser until it is encrypted like any other attachment.
 */
export function useRecorder(onDone: (file: File, durationMs: number) => void) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const discard = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  const release = useCallback(() => {
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
    setRecording(false);
    setElapsed(0);
  }, []);

  const finish = useCallback((keep: boolean) => {
    discard.current = !keep;
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
    else release();
  }, [release]);

  const start = useCallback(async () => {
    if (recorder.current || starting) return;
    const fmt = pickFormat();
    if (!fmt || !navigator.mediaDevices?.getUserMedia) {
      toast("Voice messages aren't supported in this browser.");
      return;
    }
    setStarting(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = s;
      const r = new MediaRecorder(s, fmt.mime ? { mimeType: fmt.mime, audioBitsPerSecond: 48_000 } : undefined);
      chunks.current = [];
      discard.current = false;
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const ms = Date.now() - startedAt.current;
        const parts = chunks.current;
        const keep = !discard.current && parts.length > 0 && ms >= 600;
        const type = (r.mimeType || fmt.mime || "audio/webm").split(";")[0]!;
        release();
        if (!keep) {
          if (!discard.current && ms < 600) toast("Hold on a little longer to record a message.");
          return;
        }
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
        done.current(new File(parts, `voice-${stamp}.${fmt.ext}`, { type }), ms);
      };
      recorder.current = r;
      startedAt.current = Date.now();
      r.start(1000);
      setRecording(true);
      timer.current = window.setInterval(() => {
        const ms = Date.now() - startedAt.current;
        setElapsed(ms);
        if (ms >= MAX_VOICE_MS) finish(true);
      }, 200);
    } catch (e) {
      release();
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      toast(denied ? "Microphone access is blocked. Allow it in your browser to record." : "Couldn't start the microphone.");
    } finally {
      setStarting(false);
    }
  }, [finish, release, starting]);

  // Never leave the microphone on if the composer goes away.
  useEffect(
    () => () => {
      discard.current = true;
      const r = recorder.current;
      if (r && r.state !== "inactive") r.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      window.clearInterval(timer.current);
    },
    [],
  );

  return {
    recording,
    starting,
    elapsed,
    start,
    send: () => finish(true),
    cancel: () => finish(false),
  };
}
