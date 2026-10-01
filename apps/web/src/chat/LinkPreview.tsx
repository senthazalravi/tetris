import { ExternalLink } from "lucide-react";
import { linkify } from "@/lib/format";

function firstUrl(text: string): string | null {
  const part = linkify(text).find((p) => p.type === "link");
  return part?.value ?? null;
}

function describe(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}${u.hash}`;
    const truncated =
      path.length > 48 ? `${path.slice(0, 45)}…` : path === "/" ? "" : path;
    return { host: u.hostname, path: truncated };
  } catch {
    return { host: url, path: "" };
  }
}

/** Compact local-only link card (hostname + truncated path). No remote fetch. */
export function LinkPreview({ text }: { text: string }) {
  const url = firstUrl(text);
  if (!url) return null;
  const { host, path } = describe(url);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 flex max-w-full items-start gap-2 rounded-xl border border-white/15 bg-black/20 px-2.5 py-2 text-left transition hover:bg-black/30 [.bubble.in_&]:border-line [.bubble.in_&]:bg-s3 [.bubble.in_&]:hover:bg-s4"
    >
      <ExternalLink size={14} className="mt-0.5 shrink-0 opacity-80" />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-tight">{host}</span>
        {path && <span className="mt-0.5 block truncate text-[11px] opacity-75">{path}</span>}
      </span>
    </a>
  );
}
