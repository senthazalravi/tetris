import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Copy,
  CornerUpLeft,
  Info,
  Plus,
  RotateCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { formatTime, linkify } from "@/lib/format";
import type { LocalMessage } from "@/state/localdb";
import {
  deleteForEveryone,
  deleteForMe,
  retryMessage,
  sendReaction,
  setReplyTo,
  toast,
} from "@/state/chat";
import { useOutside } from "@/ui/hooks";
import { AttachmentView } from "./Attachment";
import { EmojiPicker } from "./EmojiPicker";
import { MessageInfo } from "./Modals";
import { PollCard } from "./Poll";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function Ticks({ state }: { state: LocalMessage["state"] }) {
  switch (state) {
    case "sending":
      return <Clock size={12} className="opacity-80" aria-label="Sending" />;
    case "failed":
      return <AlertCircle size={14} className="text-[#ffb4b4]" aria-label="Failed" />;
    case "accepted":
      return <Check size={15} strokeWidth={2.4} className="opacity-90" aria-label="Sent" />;
    case "delivered":
      return <CheckCheck size={16} strokeWidth={2.4} className="opacity-90" aria-label="Delivered" />;
    case "read":
      return (
        <CheckCheck
          size={16}
          strokeWidth={2.8}
          className="text-[var(--tick-read)] drop-shadow-[0_0_1px_rgba(0,0,0,0.45)]"
          aria-label="Read"
        />
      );
  }
}

function Linked({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.type === "link" ? (
          <a
            key={i}
            href={p.value}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2 opacity-95 hover:opacity-100"
          >
            {p.value}
          </a>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\s){1,6}$/u;

function BubbleImpl({
  m,
  peerName,
  myId,
  first,
}: {
  m: LocalMessage;
  peerName: string;
  myId: string;
  first: boolean;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const [more, setMore] = useState(false);
  const [info, setInfo] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setMenu(null);
    setMore(false);
  }, []);
  const menuRef = useOutside<HTMLDivElement>(menu !== null, close);
  const c = m.content;

  const out = m.direction === "out";

  function openMenu() {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const width = 224;
    const up = r.bottom + 340 > window.innerHeight && r.top > 340;
    const x = Math.min(
      Math.max(8, out ? r.right - width : r.left),
      window.innerWidth - width - 8,
    );
    setMenu({ x, y: up ? window.innerHeight - r.top + 6 : r.bottom + 6, up });
  }

  // Close the menu if the list scrolls under it.
  useLayoutEffect(() => {
    if (!menu) return;
    const onScroll = () => close();
    window.addEventListener("resize", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, close]);

  if (c.kind === "reaction" || c.kind === "vote") return null;

  if (c.kind === "system") {
    return (
      <div className="my-2 flex justify-center fade-in">
        <span className="flex max-w-md items-center gap-2 rounded-full bg-s2 px-3.5 py-1.5 text-center text-xs text-muted">
          <ShieldAlert size={13} className="shrink-0 text-warn" />
          {c.text}
        </span>
      </div>
    );
  }

  const time = formatTime(m.createdAt);

  if (m.deleted) {
    return (
      <div className={`flex ${out ? "justify-end" : "justify-start"} ${first ? "mt-2" : "mt-0.5"}`}>
        <div className={`bubble ${out ? "out" : "in"} flex items-center gap-2 italic opacity-70`}>
          <Ban size={14} /> This message was deleted
        </div>
      </div>
    );
  }

  if (c.kind === "undecryptable") {
    return (
      <div className={`flex justify-start ${first ? "mt-2" : "mt-0.5"}`}>
        <div className="bubble in flex items-center gap-2 italic opacity-80">
          <AlertCircle size={14} className="text-danger" /> Couldn't decrypt this message
        </div>
      </div>
    );
  }

  const text = c.body;
  /** Image/file-only bubbles hug their content; voice notes and polls keep padding. */
  const bare = c.kind === "file" && !text && !c.attachment?.voice;
  const bigEmoji = c.kind === "text" && !c.replyTo && EMOJI_ONLY.test(text);
  const mine = m.reactions?.[myId];

  // Group reactions by emoji: 👍 2
  const grouped = new Map<string, number>();
  for (const e of Object.values(m.reactions ?? {})) grouped.set(e, (grouped.get(e) ?? 0) + 1);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Couldn't copy");
    }
  };

  const react = (emoji: string) => {
    void sendReaction(m.convId, m.id, emoji);
    close();
  };

  return (
    <div
      className={`group flex items-end gap-1 ${out ? "flex-row-reverse" : ""} ${first ? "mt-2" : "mt-0.5"} ${
        grouped.size ? "mb-4" : ""
      }`}
      data-mid={m.id}
    >
      <div className={`bubble ${out ? "out" : "in"} ${bare ? "!p-1 !pb-0.5" : ""}`}>
        {c.replyTo && (
          <div
            className={`mb-1.5 cursor-default overflow-hidden rounded-lg border-l-[3px] px-2.5 py-1.5 text-[13px] ${
              out ? "border-white/70 bg-black/25" : "border-pop bg-s3"
            }`}
          >
            <div className={`font-semibold ${out ? "text-[#c9f7e8]" : "text-pop"}`}>
              {c.replyTo.senderId === myId ? "You" : peerName}
            </div>
            <div className={`line-clamp-2 ${out ? "text-white/90" : "opacity-80"}`}>
              {c.replyTo.preview || "Attachment"}
            </div>
          </div>
        )}

        {c.kind === "file" && c.attachment && (
          <div className={text ? "mb-1" : ""}>
            <AttachmentView att={c.attachment} out={out} />
          </div>
        )}

        {c.kind === "poll" && c.poll && <PollCard m={m} poll={c.poll} myId={myId} />}

        {text && c.kind !== "poll" && (
          <span className={bigEmoji ? "text-4xl leading-tight" : ""}>
            <Linked text={text} />
          </span>
        )}

        <span
          className={`float-right ml-3 mt-1 inline-flex select-none items-center gap-1.5 align-bottom text-[10.5px] opacity-85 ${
            bare ? "px-1.5 pb-0.5" : ""
          }`}
        >
          <span>{time}</span>
          {out && <Ticks state={m.state} />}
        </span>
        <span className="clear-both block" />

        {grouped.size > 0 && (
          <div className={`absolute -bottom-3.5 flex gap-1 ${out ? "right-2" : "left-2"}`}>
            {[...grouped].map(([emoji, n]) => (
              <button
                key={emoji}
                onClick={() => react(emoji)}
                aria-label={`Reaction ${emoji}`}
                className={`flex items-center gap-1 rounded-full border bg-s1 px-1.5 py-0.5 text-[13px] leading-none text-fg shadow-md transition hover:scale-105 ${
                  mine === emoji ? "border-pop" : "border-lines"
                }`}
              >
                <span>{emoji}</span>
                {n > 1 && <span className="text-[11px] text-muted">{n}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        ref={trigger}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (menu ? close() : openMenu())}
        aria-label="Message options"
        aria-expanded={menu !== null}
        className={`rounded-full p-1.5 text-muted transition hover:bg-s3 hover:text-fg ${
          menu ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-60"
        }`}
      >
        <ChevronDown size={16} />
      </button>

      {menu && (
        <div
          ref={menuRef}
          style={{ left: menu.x, ...(menu.up ? { bottom: menu.y } : { top: menu.y }) }}
          className="pop-in fixed z-[65] w-56"
        >
          <div className="mb-1.5 flex items-center justify-between rounded-full border border-line bg-s1 px-2 py-1.5 shadow-[var(--shadow)]">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                onClick={() => react(e)}
                aria-label={`React ${e}`}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xl transition hover:scale-125 ${
                  mine === e ? "bg-s4" : ""
                }`}
              >
                {e}
              </button>
            ))}
            <button
              onClick={() => setMore((v) => !v)}
              aria-label="More reactions"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-s3 hover:text-fg"
            >
              <Plus size={17} />
            </button>
          </div>
          {more && (
            <div className="mb-1.5">
              <EmojiPicker onPick={react} />
            </div>
          )}
          <div className="rounded-2xl border border-line bg-s1 p-1.5 text-sm shadow-[var(--shadow)]">
            {m.state === "failed" && (
              <MenuItem icon={RotateCw} onClick={() => void retryMessage(m.convId, m.id)} done={close}>
                Retry sending
              </MenuItem>
            )}
            <MenuItem icon={CornerUpLeft} onClick={() => setReplyTo(m.convId, m)} done={close}>
              Reply
            </MenuItem>
            {text && (
              <MenuItem icon={Copy} onClick={() => void copy()} done={close}>
                Copy text
              </MenuItem>
            )}
            <MenuItem icon={Info} onClick={() => setInfo(true)} done={close}>
              Message info
            </MenuItem>
            <MenuItem icon={Trash2} onClick={() => void deleteForMe(m.convId, m.id)} done={close}>
              Delete for me
            </MenuItem>
            {out && (
              <MenuItem
                icon={Trash2}
                danger
                onClick={() =>
                  void deleteForEveryone(m.convId, m.id).catch(() => toast("Couldn't delete that for everyone"))
                }
                done={close}
              >
                Delete for everyone
              </MenuItem>
            )}
          </div>
        </div>
      )}

      {info && <MessageInfo m={m} onClose={() => setInfo(false)} />}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  children,
  onClick,
  done,
  danger,
}: {
  icon: typeof Copy;
  children: string;
  onClick: () => void;
  done: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={() => {
        onClick();
        done();
      }}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-s3 ${
        danger ? "text-danger" : ""
      }`}
    >
      <Icon size={16} /> {children}
    </button>
  );
}

export const Bubble = memo(BubbleImpl);

