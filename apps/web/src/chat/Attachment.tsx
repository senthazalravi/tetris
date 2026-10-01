import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Download, FileText, Mic, Music, Pause, Play, X } from "lucide-react";
import type { AttachmentRef } from "@tetris/protocol";
import { formatBytes } from "@/lib/format";
import { isPdf, mediaKind } from "@/lib/media";
import { downloadAttachment, evictAttachment, loadAttachment } from "@/state/chat";
import { Spinner } from "@/ui/kit";

function boxSize(att: AttachmentRef, max = 280) {
  const w = att.width ?? 4;
  const h = att.height ?? 3;
  const scale = Math.min(max / w, max / h, 1);
  const width = Math.max(120, Math.round(w * (att.width ? scale : 70)));
  const height = Math.max(90, Math.round(h * (att.height ? scale : 70)));
  return { width: Math.min(width, max), height: Math.min(height, 340) };
}

/**
 * Fetch + decrypt. Keyed on id/key/mime so message-status re-renders do not
 * cancel an in-flight load (that was leaving one tab with a broken <img>).
 */
function useDecrypted(att: AttachmentRef, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const tries = useRef(0);

  useEffect(() => {
    tries.current = 0;
  }, [att.id]);

  useEffect(() => {
    if (!enabled || !att.id) return;
    let live = true;
    setError(false);
    setUrl(null);
    loadAttachment(att)
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
    // Intentionally not depending on the whole `att` object — a new reference
    // on every tick/receipt update was aborting loads mid-flight.
  }, [att.id, att.key, att.mime, att.name, enabled, nonce]);

  const reload = () => {
    if (tries.current >= 2) {
      setError(true);
      return;
    }
    tries.current += 1;
    evictAttachment(att.id);
    setUrl(null);
    setError(false);
    setNonce((n) => n + 1);
  };
  return { url, error, reload };
}

export function AttachmentView({ att, out }: { att: AttachmentRef; out?: boolean }) {
  if (att.voice) return <VoiceNote att={att} />;
  const kind = mediaKind(att.mime, att.name);
  if (kind === "image") return <ImageAttachment att={att} />;
  if (kind === "video") return <ClickToLoad att={att} kind="video" />;
  if (kind === "audio") return <ClickToLoad att={att} kind="audio" />;
  return <FileCard att={att} out={out} />;
}

function ImageAttachment({ att }: { att: AttachmentRef }) {
  const { url, error, reload } = useDecrypted(att, true);
  const [open, setOpen] = useState(false);
  const { width, height } = boxSize(att);
  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        className="relative block overflow-hidden rounded-xl bg-black/20"
        style={{ width, height }}
        aria-label={`Open ${att.name}`}
      >
        {att.thumb && !url && (
          <img src={att.thumb} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover blur-md" />
        )}
        {url && (
          <img
            src={url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => reload()}
          />
        )}
        {!url && !error && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        )}
        {error && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-xs opacity-80">
            <AlertCircle size={18} />
            <span className="line-clamp-2 text-center">{att.name}</span>
            <span
              role="link"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                reload();
              }}
              onKeyDown={(e) => e.key === "Enter" && reload()}
              className="underline"
            >
              Tap to retry
            </span>
          </span>
        )}
      </button>
      {open && url && <Lightbox url={url} att={att} onClose={() => setOpen(false)} />}
    </>
  );
}

function Lightbox({ url, att, onClose }: { url: string; att: AttachmentRef; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 fade-in"
      onClick={onClose}
      role="dialog"
      aria-label={att.name}
    >
      <div className="absolute right-4 top-4 flex gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            void downloadAttachment(att);
          }}
          aria-label="Download"
          className="rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
        >
          <Download size={20} />
        </button>
        <button onClick={onClose} aria-label="Close" className="rounded-full bg-white/10 p-3 text-white hover:bg-white/20">
          <X size={20} />
        </button>
      </div>
      <img
        src={url}
        alt={att.name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}

/** Videos and audio are big, so they only download when asked. */
function ClickToLoad({ att, kind }: { att: AttachmentRef; kind: "video" | "audio" }) {
  const [wanted, setWanted] = useState(false);
  const { url, error } = useDecrypted(att, wanted);

  if (url) {
    return kind === "video" ? (
      <video src={url} controls playsInline className="max-h-80 max-w-full rounded-xl bg-black" />
    ) : (
      <audio src={url} controls className="w-64 max-w-full" />
    );
  }
  const Icon = kind === "video" ? Play : Music;
  return (
    <button
      type="button"
      onClick={() => setWanted(true)}
      disabled={wanted && !error}
      className="flex w-64 max-w-full items-center gap-3 rounded-xl bg-black/15 p-3 text-left transition hover:bg-black/25"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/25">
        {wanted && !error ? <Spinner /> : <Icon size={18} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{att.name}</span>
        <span className="block text-xs opacity-70">
          {error ? "Expired or unavailable" : `${formatBytes(att.size)} · tap to load`}
        </span>
      </span>
    </button>
  );
}

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const SPEEDS = [1, 1.5, 2] as const;

/** A WhatsApp-style voice message: play/pause, waveform scrubber, speed. */
function VoiceNote({ att }: { att: AttachmentRef }) {
  const { url, error } = useDecrypted(att, true);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const total = att.durationMs ?? 0;

  const bars = useMemo(() => {
    let h = 2166136261;
    for (const ch of att.id || att.name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return Array.from({ length: 32 }, () => {
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return 0.25 + ((h >>> 0) % 1000) / 1000 * 0.75;
    });
  }, [att.id, att.name]);

  const fraction = total ? Math.min(1, pos / total) : 0;

  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audio.current;
    if (!a || !total) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    a.currentTime = (f * total) / 1000;
    setPos(f * total);
  }

  return (
    <div className="flex w-64 max-w-full items-center gap-2.5 py-0.5 pr-1">
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/25 transition hover:bg-black/35 disabled:opacity-60"
      >
        {!url && !error ? <Spinner /> : playing ? <Pause size={17} /> : <Play size={17} className="translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(total / 1000)}
          aria-valuenow={Math.round(pos / 1000)}
          onClick={seek}
          className="flex h-7 cursor-pointer items-center gap-[2px]"
        >
          {bars.map((b, i) => (
            <span
              key={i}
              className="w-[3px] shrink-0 rounded-full bg-current"
              style={{ height: `${Math.round(b * 100)}%`, opacity: i / bars.length < fraction ? 1 : 0.35 }}
            />
          ))}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[11px] opacity-80">
          <span className="tabular">
            {error ? "Expired or unavailable" : clock(playing || pos ? pos : total)}
          </span>
          <button
            type="button"
            onClick={() => {
              const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
              setSpeed(next);
              if (audio.current) audio.current.playbackRate = next;
            }}
            className="rounded-full bg-black/20 px-1.5 py-px text-[10px] font-semibold"
            aria-label={`Playback speed ${speed}x`}
          >
            {speed}x
          </button>
        </div>
      </div>
      <Mic size={14} className="shrink-0 opacity-60" aria-hidden />
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)}
        />
      )}
    </div>
  );
}

function FileCard({ att, out }: { att: AttachmentRef; out?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const ext = (att.name.split(".").pop() ?? "").slice(0, 4).toUpperCase();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setError(false);
        try {
          await downloadAttachment(att);
        } catch {
          setError(true);
        } finally {
          setBusy(false);
        }
      }}
      className="flex w-64 max-w-full items-center gap-3 rounded-xl bg-black/15 p-3 text-left transition hover:bg-black/25"
    >
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/25">
        <FileText size={20} />
        {ext && (
          <span className={`absolute -bottom-1 rounded px-1 text-[9px] font-bold ${out ? "bg-white text-black" : "bg-fg text-bg"}`}>
            {isPdf(att.mime, att.name) ? "PDF" : ext}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{att.name}</span>
        <span className="block text-xs opacity-70">
          {error ? "Expired or unavailable" : formatBytes(att.size)}
        </span>
      </span>
      {busy ? <Spinner /> : <Download size={17} className="shrink-0 opacity-70" />}
    </button>
  );
}
