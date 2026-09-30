import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowLeft, Info, ShieldCheck, Upload } from "lucide-react";
import type { ConversationDto } from "@lop/types";
import { formatDay } from "@/lib/format";
import { nameOf, selectConversation, useChat } from "@/state/chat";
import { useSession } from "@/state/session";
import { Avatar, IconButton } from "@/ui/kit";
import { useNow } from "@/ui/hooks";
import type { LocalMessage } from "@/state/localdb";
import { Bubble } from "./Bubble";
import { Composer } from "./Composer";
import { ContactInfo } from "./Modals";

const EMPTY: LocalMessage[] = [];

export function Thread({ conv }: { conv: ConversationDto }) {
  const myId = useSession((s) => s.user!.id);
  const messages = useChat((s) => s.messages[conv.id]) ?? EMPTY;
  const typing = useChat((s) => s.typing[conv.id]);
  const nicknames = useChat((s) => s.nicknames);
  const peerName = nameOf(nicknames, conv.peer);
  const now = useNow(30_000);
  const [info, setInfo] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const dragDepth = useRef(0);

  const isTyping = typing !== undefined && typing > now - 6000;

  useEffect(() => {
    setFile(null);
    setInfo(false);
    stick.current = true;
  }, [conv.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, conv.id, isTyping]);

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
      <Bubble key={m.id} m={m} peerName={peerName} myId={myId} first={first} />,
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
      <header className="flex items-center gap-3 border-b border-line bg-s1 px-3 py-2.5 sm:px-4">
        <IconButton label="Back to chats" onClick={() => selectConversation(null)} className="md:hidden">
          <ArrowLeft size={20} />
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
        <IconButton label="Contact info" onClick={() => setInfo(true)}>
          <Info size={20} />
        </IconButton>
      </header>

      <div className="dotgrid relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-3 pb-3 pt-2 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <div className="mx-auto my-4 flex max-w-sm items-start gap-2 rounded-2xl bg-s1/90 px-4 py-3 text-center text-xs leading-relaxed text-muted backdrop-blur">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-pop" />
              <span>
                Messages here are end-to-end encrypted and disappear 24 hours after they're sent.
              </span>
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

      {info && <ContactInfo conv={conv} onClose={() => setInfo(false)} />}
    </section>
  );
}

