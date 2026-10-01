import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Images,
  Info,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import type { ConversationDto } from "@tetris/types";
import { formatDay } from "@/lib/format";
import {
  messageSearchText,
  nameOf,
  selectConversation,
  toast,
  useChat,
} from "@/state/chat";
import { useSession } from "@/state/session";
import { Avatar, IconButton } from "@/ui/kit";
import { useNow } from "@/ui/hooks";
import type { LocalMessage } from "@/state/localdb";
import { Bubble } from "./Bubble";
import { Composer } from "./Composer";
import { MediaGallery } from "./MediaGallery";
import { ChatPrivacyLearnModal, ContactInfo } from "./Modals";

const EMPTY: LocalMessage[] = [];

export function Thread({ conv }: { conv: ConversationDto }) {
  const myId = useSession((s) => s.user!.id);
  const messages = useChat((s) => s.messages[conv.id]) ?? EMPTY;
  const typing = useChat((s) => s.typing[conv.id]);
  const nicknames = useChat((s) => s.nicknames);
  const peerName = nameOf(nicknames, conv.peer);
  useNow(30_000);
  const [info, setInfo] = useState(false);
  const [privacyLearn, setPrivacyLearn] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const dragDepth = useRef(0);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTyping = typing !== undefined && typing > Date.now();

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [] as LocalMessage[];
    return messages.filter((m) => messageSearchText(m).toLowerCase().includes(term));
  }, [messages, query]);

  useEffect(() => {
    setFile(null);
    setInfo(false);
    setPrivacyLearn(false);
    setGallery(false);
    setSearchOpen(false);
    setQuery("");
    setMatchIdx(0);
    setHighlightId(null);
    stick.current = true;
  }, [conv.id]);

  useEffect(() => {
    const onSearch = () => {
      setSearchOpen(true);
      requestAnimationFrame(() => searchInput.current?.focus());
    };
    window.addEventListener("tetris:chat-search", onSearch);
    return () => window.removeEventListener("tetris:chat-search", onSearch);
  }, []);

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchInput.current?.focus());
  }, [searchOpen]);

  useEffect(() => {
    setMatchIdx(0);
  }, [query, conv.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, conv.id, isTyping]);

  function jumpTo(id: string) {
    const el = scroller.current?.querySelector(`[data-mid="${CSS.escape(id)}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      stick.current = false;
      setAtBottom(false);
    }
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2000);
  }

  function goMatch(delta: number) {
    if (matches.length === 0) return;
    const next = (matchIdx + delta + matches.length) % matches.length;
    setMatchIdx(next);
    jumpTo(matches[next]!.id);
  }

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setAtBottom(near);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  const items: React.ReactNode[] = [];
  let lastDay = "";
  let prev: LocalMessage | undefined;
  for (const m of messages) {
    const day = formatDay(m.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      items.push(
        <div key={`d${m.createdAt}`} className="sticky top-2 z-10 my-3 flex justify-center">
          <span className="rounded-full bg-s2/90 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
            {day}
          </span>
        </div>,
      );
      prev = undefined;
    }
    const first = !prev || prev.direction !== m.direction || m.createdAt - prev.createdAt > 5 * 60_000;
    items.push(
      <Bubble
        key={m.id}
        m={m}
        peerName={peerName}
        myId={myId}
        first={first}
        highlight={m.id === highlightId}
      />,
    );
    prev = m;
  }

  return (
    <section
      className="relative flex h-full min-w-0 flex-1 flex-col bg-bg"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="flex items-center gap-1 border-b border-line bg-s1 px-2 py-2.5 sm:gap-2 sm:px-4">
        <IconButton
          label="Close chat (Esc)"
          onClick={() => {
            selectConversation(null);
            useSession.getState().setScreen("game");
          }}
        >
          <ArrowLeft size={20} className="md:hidden" />
          <X size={20} className="hidden md:block" />
        </IconButton>
        <button onClick={() => setInfo(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar name={conv.peer.displayName} seed={conv.peer.userId} url={conv.peer.avatarUrl} size={42} />
          <span className="min-w-0">
            <span className="block truncate font-display text-[17px] font-bold leading-tight">
              {peerName}
            </span>
            <span className="block truncate text-xs text-muted">
              {isTyping ? (
                <span className="text-pop">typing…</span>
              ) : (
                <>@{conv.peer.username} · vanishes after 24h</>
              )}
            </span>
          </span>
        </button>
        <IconButton
          label="Search in chat"
          onClick={() => setSearchOpen((v) => !v)}
          className={searchOpen ? "bg-s3 text-fg" : ""}
        >
          <Search size={20} />
        </IconButton>
        <IconButton label="Media & files" onClick={() => setGallery(true)}>
          <Images size={20} />
        </IconButton>
        <IconButton label="Contact info" onClick={() => setInfo(true)}>
          <Info size={20} />
        </IconButton>
      </header>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-line bg-s1 px-3 py-2 sm:px-4">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                setSearchOpen(false);
                setQuery("");
              }
            }}
            placeholder="Search messages"
            aria-label="Search messages"
            className="h-9 min-w-0 flex-1 rounded-xl bg-s2 px-3 text-sm outline-none transition placeholder:text-faint focus:ring-2 focus:ring-pop/40"
          />
          <span className="shrink-0 tabular text-xs text-muted">
            {query.trim()
              ? matches.length
                ? `${matchIdx + 1}/${matches.length}`
                : "0/0"
              : ""}
          </span>
          <IconButton label="Previous match" onClick={() => goMatch(-1)} disabled={matches.length === 0}>
            <ChevronUp size={18} />
          </IconButton>
          <IconButton label="Next match" onClick={() => goMatch(1)} disabled={matches.length === 0}>
            <ChevronDown size={18} />
          </IconButton>
          <IconButton
            label="Close search"
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
          >
            <X size={18} />
          </IconButton>
        </div>
      )}

      <div className="dotgrid relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-3 pb-3 pt-2 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <div className="mx-auto my-4 flex max-w-sm items-start gap-2 rounded-2xl bg-s1/90 px-4 py-3 text-xs leading-relaxed text-muted backdrop-blur">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-pop" aria-hidden />
              <p>
                Messages here are end-to-end encrypted and disappear 24 hours after they're sent.{" "}
                <button
                  type="button"
                  onClick={() => setPrivacyLearn(true)}
                  className="font-medium text-pop underline-offset-2 hover:underline"
                >
                  Click here to learn more.
                </button>
              </p>
            </div>
            {items}
            {isTyping && (
              <div className="mt-2 flex">
                <div className="bubble in flex items-center gap-1 !py-3" aria-label="typing">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
          </div>
        </div>
        {!atBottom && (
          <button
            onClick={() => {
              const el = scroller.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            aria-label="Scroll to latest"
            className="pop-in absolute bottom-4 right-5 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-s1 shadow-[var(--shadow)] hover:bg-s3"
          >
            <ArrowDown size={18} />
          </button>
        )}
      </div>

      <Composer conv={conv} file={file} onFile={setFile} />

      {dragging && (
        <div className="fade-in pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-bg/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-pop px-12 py-10 text-center">
            <Upload size={34} className="text-pop" />
            <div className="font-display text-xl font-bold">Drop to attach</div>
            <div className="text-sm text-muted">Encrypted in your browser before it's uploaded</div>
          </div>
        </div>
      )}

      {privacyLearn && <ChatPrivacyLearnModal onClose={() => setPrivacyLearn(false)} />}
      {info && <ContactInfo conv={conv} onClose={() => setInfo(false)} />}
      {gallery && <MediaGallery convId={conv.id} onClose={() => setGallery(false)} />}
    </section>
  );
}
