import { useCallback, useMemo, useState, type MouseEvent } from "react";
import {
  Ban,
  Check,
  CheckCheck,
  Eraser,
  Info,
  MessageCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Search,
  UserMinus,
  WifiOff,
} from "lucide-react";
import type { ConversationDto } from "@lop/types";
import { formatListTime } from "@/lib/format";
import {
  clearChat,
  nameOf,
  removeContact,
  selectConversation,
  setBlocked,
  toast,
  useChat,
} from "@/state/chat";
import { useSession } from "@/state/session";
import type { LocalMessage } from "@/state/localdb";
import { Avatar, IconButton, Wordmark } from "@/ui/kit";
import { ThemeButton } from "@/ui/ThemeButton";
import { useNow, useOutside } from "@/ui/hooks";
import { ContactInfo } from "./Modals";

function previewOf(m: LocalMessage | undefined): string {
  if (!m) return "No messages yet";
  if (m.deleted) return "Message deleted";
  const c = m.content;
  if (c.kind === "system") return c.text;
  if (c.kind === "undecryptable") return "Couldn't decrypt";
  if (c.kind === "file") {
    return c.body || (c.attachment?.voice ? "Voice message" : c.attachment?.name) || "Attachment";
  }
  if (c.kind === "poll") return `Poll: ${c.poll?.question ?? ""}`;
  if (c.kind === "reaction" || c.kind === "vote") return "";
  return c.body;
}

interface MenuState {
  conv: ConversationDto;
  x: number;
  y: number;
}

export function Sidebar({ onNew, onProfile }: { onNew: () => void; onProfile: () => void }) {
  const user = useSession((s) => s.user)!;
  const { conversations, messages, activeId, typing, connection, ready, nicknames } = useChat();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const now = useNow(30_000);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return conversations
      .map((c) => {
        const list = messages[c.id] ?? [];
        const last = [...list].reverse().find((m) => m.content.kind !== "system" && m.content.kind !== "reaction" && m.content.kind !== "vote");
        const unread = list.filter((m) => m.unread).length;
        return { c, last, unread, at: last?.createdAt ?? c.lastMessageAt };
      })
      .filter(
        ({ c }) =>
          !term ||
          c.peer.displayName.toLowerCase().includes(term) ||
          (nicknames[c.peer.userId] ?? "").toLowerCase().includes(term) ||
          c.peer.username.toLowerCase().includes(term),
      )
      .sort((a, b) => b.at - a.at);
  }, [conversations, messages, q, nicknames]);

  const openMenuAt = (c: ConversationDto, x: number, y: number) => setMenu({ conv: c, x, y });
  const closeMenu = useCallback(() => setMenu(null), []);
  const infoConv = conversations.find((c) => c.id === infoFor) ?? null;

  return (
    <aside className="flex h-full w-full flex-col border-r border-line bg-s1 md:w-[22rem] lg:w-[24rem]">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <Wordmark size={26} />
        <div className="flex items-center">
          <ThemeButton />
          <IconButton label="New chat" onClick={onNew}>
            <MessageSquarePlus size={20} />
          </IconButton>
          <button onClick={onProfile} aria-label="Your profile" className="ml-1 rounded-full transition hover:ring-2 hover:ring-pop/60">
            <Avatar name={user.displayName} seed={user.id} url={user.avatarUrl} size={36} />
          </button>
        </div>
      </header>

      <div className="px-4 pb-3 pt-1">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter your chats"
            aria-label="Filter your chats"
            className="h-10 w-full rounded-xl bg-s2 pl-10 pr-3 text-sm outline-none transition placeholder:text-faint focus:ring-2 focus:ring-pop/40"
          />
        </div>
      </div>

      {connection === "offline" && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-warn/15 px-3 py-2 text-xs text-warn">
          <WifiOff size={14} /> Offline. Reconnecting…
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversations">
        {!ready ? (
          <ul className="space-y-1 px-2 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex animate-pulse items-center gap-3 py-2.5">
                <div className="h-12 w-12 rounded-full bg-s3" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 rounded bg-s3" />
                  <div className="h-3 w-3/4 rounded bg-s2" />
                </div>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 pb-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-s3 text-pop">
              <MessageSquarePlus size={28} />
            </div>
            <h2 className="font-display text-lg font-bold">
              {q ? "No chats match" : "Nothing here yet"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {q
                ? "Try a different name."
                : "Start a chat with someone's exact @username. Everything you send vanishes after 24 hours."}
            </p>
            {!q && (
              <button
                onClick={onNew}
                className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-onaccent shadow-[0_8px_24px_-10px_var(--pop)] hover:brightness-110"
              >
                New chat
              </button>
            )}
          </div>
        ) : (
          <ul>
            {rows.map(({ c, last, unread, at }) => {
              const active = c.id === activeId;
              const isTyping = (typing[c.id] ?? 0) > now - 6000;
              const mine = last?.direction === "out" && !last.deleted;
              const onContext = (e: MouseEvent) => {
                e.preventDefault();
                openMenuAt(c, e.clientX, e.clientY);
              };
              return (
                <li key={c.id} className="group relative" onContextMenu={onContext}>
                  <button
                    onClick={() => selectConversation(c.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                      active ? "bg-s3" : "hover:bg-s2"
                    }`}
                  >
                    <Avatar name={c.peer.displayName} seed={c.peer.userId} url={c.peer.avatarUrl} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold">{nameOf(nicknames, c.peer)}</span>
                        <span
                          className={`shrink-0 text-[11px] transition-opacity group-hover:opacity-0 ${
                            unread ? "font-semibold text-pop" : "text-faint"
                          }`}
                        >
                          {at ? formatListTime(at) : ""}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                        {c.blocked && <Ban size={13} className="shrink-0 text-danger" />}
                        {isTyping ? (
                          <span className="text-pop">typing…</span>
                        ) : (
                          <>
                            {mine &&
                              (last.state === "read" ? (
                                <CheckCheck size={15} strokeWidth={2.6} className="shrink-0 text-[#2aa8e6]" />
                              ) : last.state === "delivered" ? (
                                <CheckCheck size={15} className="shrink-0" />
                              ) : (
                                <Check size={15} className="shrink-0" />
                              ))}
                            {last?.content.kind === "file" && <Paperclip size={13} className="shrink-0" />}
                            <span className="truncate">{previewOf(last)}</span>
                          </>
                        )}
                        {unread > 0 && (
                          <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-onaccent">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      openMenuAt(c, r.right - 8, r.bottom + 4);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label={`Options for ${nameOf(nicknames, c.peer)}`}
                    className="absolute right-3 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-muted opacity-0 transition hover:bg-s4 hover:text-fg focus:opacity-100 group-hover:opacity-100"
                  >
                    <MoreHorizontal size={17} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {menu && (
        <ChatMenu
          state={menu}
          nickname={nameOf(nicknames, menu.conv.peer)}
          onClose={closeMenu}
          onInfo={() => setInfoFor(menu.conv.id)}
        />
      )}
      {infoConv && <ContactInfo conv={infoConv} onClose={() => setInfoFor(null)} />}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* context menu                                                        */
/* ------------------------------------------------------------------ */

function ChatMenu({
  state,
  nickname,
  onClose,
  onInfo,
}: {
  state: MenuState;
  nickname: string;
  onClose: () => void;
  onInfo: () => void;
}) {
  const { conv } = state;
  const [confirm, setConfirm] = useState<"clear" | "remove" | null>(null);
  const ref = useOutside<HTMLDivElement>(true, onClose);

  const width = 240;
  const height = 300;
  const left = Math.max(8, Math.min(state.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(state.y, window.innerHeight - height - 8));

  const run = async (fn: () => Promise<void> | void, message?: string) => {
    try {
      await fn();
      if (message) toast(message);
    } catch {
      toast("That didn't work. Try again.");
    }
    onClose();
  };

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left, top, width }}
      className="pop-in fixed z-[65] overflow-hidden rounded-2xl border border-line bg-s1 p-1.5 shadow-[var(--shadow)]"
    >
      <div className="px-3 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wider text-faint">
        <span className="line-clamp-1 normal-case tracking-normal text-muted">{nickname}</span>
      </div>
      <Item icon={MessageCircle} onClick={() => run(() => selectConversation(conv.id))}>
        Open chat
      </Item>
      <Item
        icon={Info}
        onClick={() => {
          onInfo();
          onClose();
        }}
      >
        Contact info &amp; nickname
      </Item>
      <div className="my-1 h-px bg-line" />
      {confirm === "clear" ? (
        <Confirm
          label="Clear all messages on this device?"
          action="Clear"
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(() => clearChat(conv.id), "Chat cleared")}
        />
      ) : (
        <Item icon={Eraser} onClick={() => setConfirm("clear")}>
          Clear chat
        </Item>
      )}
      <Item
        icon={Ban}
        onClick={() =>
          run(() => setBlocked(conv.peer.userId, !conv.blocked), conv.blocked ? "Unblocked" : "Blocked")
        }
      >
        {conv.blocked ? "Unblock" : "Block"}
      </Item>
      {confirm === "remove" ? (
        <Confirm
          label="Remove this contact and chat?"
          action="Remove"
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            run(async () => {
              await removeContact(conv.peer.userId);
              if (useChat.getState().activeId === conv.id) selectConversation(null);
            }, "Contact removed")
          }
        />
      ) : (
        <Item icon={UserMinus} danger onClick={() => setConfirm("remove")}>
          Remove contact
        </Item>
      )}
    </div>
  );
}

function Item({
  icon: Icon,
  children,
  onClick,
  danger,
}: {
  icon: typeof Ban;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-s3 ${
        danger ? "text-danger" : ""
      }`}
    >
      <Icon size={16} className="shrink-0" /> {children}
    </button>
  );
}

function Confirm({
  label,
  action,
  onConfirm,
  onCancel,
}: {
  label: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="pop-in m-0.5 rounded-xl bg-danger/10 p-3">
      <p className="mb-2 text-xs text-muted">{label}</p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
        >
          {action}
        </button>
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-s3">
          Cancel
        </button>
      </div>
    </div>
  );
}
