import { memo, useCallback, useState } from "react";
import {
  AlertCircle,
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Copy,
  CornerUpLeft,
  RotateCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { MESSAGE_TTL_MS } from "@lop/config";
import { formatRemaining, formatTime, linkify } from "@/lib/format";
import type { LocalMessage } from "@/state/localdb";
import {
  deleteForEveryone,
  deleteForMe,
  retryMessage,
  setReplyTo,
  toast,
} from "@/state/chat";
import { LifeDot } from "@/ui/kit";
import { useOutside } from "@/ui/hooks";
import { AttachmentView } from "./Attachment";

export function Ticks({ state }: { state: LocalMessage["state"] }) {
  switch (state) {
    case "sending":
      return <Clock size={12} aria-label="Sending" />;
    case "failed":
      return <AlertCircle size={13} className="text-danger" aria-label="Failed" />;
    case "accepted":
      return <Check size={14} aria-label="Sent" />;
    case "delivered":
      return <CheckCheck size={14} aria-label="Delivered" />;
    case "read":
      return <CheckCheck size={14} className="text-[var(--tick-read)]" aria-label="Read" />;
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
  now,
  peerName,
  myId,
  first,
}: {
  m: LocalMessage;
  now: number;
  peerName: string;
  myId: string;
  first: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  const menuRef = useOutside<HTMLDivElement>(menu, close);
  const c = m.content;

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

  const out = m.direction === "out";
  const time = formatTime(m.createdAt);
  const left = m.expiresAt - now;
  const life = (
    <span
      className="inline-flex items-center gap-1 opacity-70"
      title={`Vanishes in ${formatRemaining(left)}`}
    >
      <LifeDot fraction={left / MESSAGE_TTL_MS} />
    </span>
  );

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
  const bigEmoji = c.kind === "text" && !c.replyTo && EMOJI_ONLY.test(text);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Couldn't copy");
    }
  };

  return (
    <div
      className={`group flex items-end gap-1 ${out ? "flex-row-reverse" : ""} ${first ? "mt-2" : "mt-0.5"}`}
      data-mid={m.id}
    >
      <div className={`bubble ${out ? "out" : "in"} ${c.kind === "file" && !text ? "!p-1 !pb-0.5" : ""}`}>
        {c.replyTo && (
          <div
            className={`mb-1.5 cursor-default overflow-hidden rounded-lg border-l-[3px] border-pop px-2.5 py-1.5 text-[13px] ${
              out ? "bg-black/15" : "bg-s3"
            }`}
          >
            <div className="font-semibold text-pop">
              {c.replyTo.senderId === myId ? "You" : peerName}
            </div>
            <div className="line-clamp-2 opacity-80">{c.replyTo.preview || "Attachment"}</div>
          </div>
        )}

        {c.kind === "file" && c.attachment && (
          <div className={text ? "mb-1" : ""}>
            <AttachmentView att={c.attachment} />
          </div>
        )}

        {text && (
          <span className={bigEmoji ? "text-4xl leading-tight" : ""}>
            <Linked text={text} />
          </span>
        )}

        <span
          className={`float-right ml-3 mt-1 inline-flex select-none items-center gap-1 align-bottom text-[10.5px] opacity-70 ${
            c.kind === "file" && !text ? "px-1.5 pb-0.5" : ""
          }`}
        >
          {life}
          {time}
          {out && <Ticks state={m.state} />}
        </span>
        <span className="clear-both block" />
      </div>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenu((v) => !v)}
          aria-label="Message options"
          className={`rounded-full p-1.5 text-muted transition hover:bg-s3 hover:text-fg ${
            menu ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-60"
          }`}
        >
          <ChevronDown size={16} />
        </button>
        {menu && (
          <div
            className={`pop-in absolute z-30 bottom-full mb-1 w-52 rounded-2xl border border-line bg-s1 p-1.5 text-sm shadow-[var(--shadow)] ${
              out ? "right-0" : "left-0"
            }`}
          >
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
        )}
      </div>
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
