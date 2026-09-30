import { useEffect, useState } from "react";
import { AlertCircle, Download, FileText, Music, Play, X } from "lucide-react";
import type { AttachmentRef } from "@lop/protocol";
import { formatBytes } from "@/lib/format";
import { isPdf, mediaKind } from "@/lib/media";
import { downloadAttachment, loadAttachment } from "@/state/chat";
import { Spinner } from "@/ui/kit";

function boxSize(att: AttachmentRef, max = 280) {
  const w = att.width ?? 4;
  const h = att.height ?? 3;
  const scale = Math.min(max / w, max / h, 1);
  const width = Math.max(120, Math.round(w * (att.width ? scale : 70)));
  const height = Math.max(90, Math.round(h * (att.height ? scale : 70)));
  return { width: Math.min(width, max), height: Math.min(height, 340) };
}

/** Fetches ciphertext and decrypts it in the browser; fails closed. */
function useDecrypted(att: AttachmentRef, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled || !att.id) return;
    let live = true;
    setError(false);
    loadAttachment(att)
      .then((u) => live && setUrl(u))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [att, enabled]);
  return { url, error };
}

export function AttachmentView({ att }: { att: AttachmentRef }) {
  const kind = mediaKind(att.mime);
  if (kind === "image") return <ImageAttachment att={att} />;
  if (kind === "video") return <ClickToLoad att={att} kind="video" />;
  if (kind === "audio") return <ClickToLoad att={att} kind="audio" />;
  return <FileCard att={att} />;
}

function ImageAttachment({ att }: { att: AttachmentRef }) {
  const { url, error } = useDecrypted(att, true);
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
        {url && <img src={url} alt={att.name} className="absolute inset-0 h-full w-full object-cover" />}
        {!url && !error && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        )}
        {error && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs opacity-80">
            <AlertCircle size={18} /> Expired or unavailable
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

function FileCard({ att }: { att: AttachmentRef }) {
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
        {ext && <span className="absolute -bottom-1 rounded bg-pop px-1 text-[9px] font-bold text-onaccent">{isPdf(att.mime, att.name) ? "PDF" : ext}</span>}
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
