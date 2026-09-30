import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Check,
  CheckCheck,
  Copy,
  FileText,
  Forward,
  Info,
  LogOut,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Search,
  Send,
  Settings,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/api/client";
import {
  decryptIncoming,
  encryptOutgoing,
  getDeviceId,
  hasVaultKeys,
} from "@/crypto/vaultCrypto";
import {
  decodePayload,
  decryptFile,
  encodePayload,
  encryptFile,
  type ChatPayload,
} from "@/crypto/attachments";
import { useRealtime } from "@/realtime/useRealtime";
import {
  broadcastSessionEvent,
  useIdleVaultLock,
  useMultiTabSync,
} from "@/hooks/sessionGuards";

interface ConversationRow {
  id: string;
  createdAt: number;
  peer: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

type DeliveryState = "accepted" | "delivered" | "read";

interface DecryptedMessage {
  id: string;
  senderUserId: string;
  payload: ChatPayload;
  createdAt: number;
  expiresAt: number;
  deliveryState: DeliveryState;
  mine: boolean;
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatListTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return formatClock(ts);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  return d.toLocaleDateString([], { weekday: "short" });
}

function Tick({ state }: { state: DeliveryState }) {
  if (state === "read") {
    return <CheckCheck size={14} className="text-[var(--lop-read)]" />;
  }
  if (state === "delivered") {
    return <CheckCheck size={14} className="text-[var(--lop-muted)]" />;
  }
  return <Check size={14} className="text-[var(--lop-muted)]" />;
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className="lop-avatar flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
      style={{ width: size, height: size }}
    >
      {initials || "?"}
    </div>
  );
}

export function ChatShell() {
  const { session, clearAuth, beginSoftUnlock } = useAuth();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<DecryptedMessage | null>(null);
  const [editing, setEditing] = useState<DecryptedMessage | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    message: DecryptedMessage;
  } | null>(null);
  const [infoMsg, setInfoMsg] = useState<DecryptedMessage | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [peerTyping, setPeerTyping] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | null>(null);
  const peerTypingClear = useRef<number | null>(null);

  const softLock = useCallback(() => {
    broadcastSessionEvent("lock");
    beginSoftUnlock();
  }, [beginSoftUnlock]);

  useIdleVaultLock(Boolean(session), softLock, 5 * 60_000);
  useMultiTabSync({
    onLock: () => beginSoftUnlock(),
    onWipe: () => {
      clearAuth();
      window.location.href = "/";
    },
  });

  useEffect(() => {
    let hideTimer: number | null = null;
    const onVis = () => {
      if (document.hidden) hideTimer = window.setTimeout(softLock, 60_000);
      else if (hideTimer) window.clearTimeout(hideTimer);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, [softLock]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const visibleMessages = useMemo(
    () => messages.filter((m) => !hiddenIds.has(m.id)),
    [messages, hiddenIds],
  );

  const refreshConversations = useCallback(async () => {
    const res = await api.get<{ conversations: ConversationRow[] }>(
      "/conversations",
    );
    setConversations(res.conversations);
  }, []);

  useEffect(() => {
    void refreshConversations().catch(() => undefined);
    const id = window.setInterval(() => {
      void refreshConversations().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(id);
  }, [refreshConversations]);

  const loadMessages = useCallback(
    async (conversation: ConversationRow) => {
      if (!conversation.peer || !session || !hasVaultKeys()) return;
      const res = await api.get<{
        messages: Array<{
          id: string;
          senderUserId: string;
          ciphertext: string;
          cryptoHeader: string;
          createdAt: number;
          expiresAt: number;
          deliveryState: DeliveryState;
        }>;
      }>(`/conversations/${conversation.id}/messages`);

      const decrypted: DecryptedMessage[] = [];
      for (const m of res.messages) {
        try {
          const peerId =
            m.senderUserId === session.id
              ? conversation.peer.userId
              : m.senderUserId;
          const raw = await decryptIncoming(
            peerId,
            m.cryptoHeader,
            m.ciphertext,
          );
          decrypted.push({
            id: m.id,
            senderUserId: m.senderUserId,
            payload: decodePayload(raw),
            createdAt: m.createdAt,
            expiresAt: m.expiresAt,
            deliveryState: m.deliveryState,
            mine: m.senderUserId === session.id,
          });
          if (m.senderUserId !== session.id) {
            const next =
              m.deliveryState === "read"
                ? null
                : m.deliveryState === "delivered"
                  ? "read"
                  : "delivered";
            if (next) {
              void api
                .post(`/messages/${m.id}/ack`, { state: next })
                .catch(() => undefined);
            }
          }
        } catch {
          decrypted.push({
            id: m.id,
            senderUserId: m.senderUserId,
            payload: { kind: "text", body: "[unable to decrypt]" },
            createdAt: m.createdAt,
            expiresAt: m.expiresAt,
            deliveryState: m.deliveryState,
            mine: m.senderUserId === session.id,
          });
        }
      }
      setMessages(decrypted);
      requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      });
    },
    [session],
  );

  useRealtime((data) => {
    const evt = data as {
      type?: string;
      conversationId?: string;
    };
    if (evt.type === "conversation.refresh" || evt.type === "message.new") {
      void refreshConversations().catch(() => undefined);
    }
    if (
      (evt.type === "message.new" ||
        evt.type === "message.delivered" ||
        evt.type === "message.read" ||
        evt.type === "message.deleted") &&
      active &&
      evt.conversationId === active.id
    ) {
      void loadMessages(active).catch(() => undefined);
    }
    if (evt.type === "typing.start" && active && evt.conversationId === active.id) {
      setPeerTyping(true);
      if (peerTypingClear.current) window.clearTimeout(peerTypingClear.current);
      peerTypingClear.current = window.setTimeout(
        () => setPeerTyping(false),
        1500,
      );
    }
    if (evt.type === "typing.stop" && active && evt.conversationId === active.id) {
      setPeerTyping(false);
    }
  }, Boolean(session));

  useEffect(() => {
    if (!active) {
      setMessages([]);
      return;
    }
    void loadMessages(active).catch(() => undefined);
    const id = window.setInterval(() => {
      void loadMessages(active).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [active, loadMessages]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  function emitTyping() {
    if (!activeId) return;
    void api
      .post(`/conversations/${activeId}/typing`, { active: true })
      .catch(() => undefined);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void api
        .post(`/conversations/${activeId}/typing`, { active: false })
        .catch(() => undefined);
    }, 1200);
  }

  async function logout() {
    broadcastSessionEvent("wipe");
    try {
      await api.post("/auth/logout", {});
    } catch {
      /* ignore */
    }
    clearAuth();
    window.location.href = "/";
  }

  async function onLookup(e: FormEvent) {
    e.preventDefault();
    setLookupError(null);
    setBusy(true);
    try {
      if (!hasVaultKeys()) {
        throw new Error("Vault is locked. Unlock with your passcode.");
      }
      const username = lookup.replace(/^@/, "").toLowerCase().trim();
      const user = await api.get<{ userId: string }>(
        `/users/lookup?username=${encodeURIComponent(username)}`,
      );
      await api.post("/contacts", { contactUserId: user.userId });
      const conv = await api.post<{ conversationId: string }>("/conversations", {
        peerUserId: user.userId,
      });
      await refreshConversations();
      setActiveId(conv.conversationId);
      setMobileShowChat(true);
      setLookup("");
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Not found");
    } finally {
      setBusy(false);
    }
  }

  async function sendPayload(payload: ChatPayload) {
    if (!active?.peer || !session) return;
    const deviceId = getDeviceId();
    if (!deviceId) throw new Error("Device keys missing. Unlock again.");
    const envelope = await encryptOutgoing(
      active.peer.userId,
      encodePayload(payload),
    );
    const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
    await api.post(`/conversations/${active.id}/messages`, {
      messageId,
      deviceId,
      communicationEpoch: session.communicationEpoch,
      cryptoHeader: envelope.cryptoHeader,
      ciphertext: envelope.ciphertext,
    });
    if (payload.kind === "file") {
      await api.post(`/attachments/${payload.attachmentId}/complete`, {
        messageId,
      });
    }
    setReplyTo(null);
    setEditing(null);
    await loadMessages(active);
    await refreshConversations();
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    try {
      await sendPayload({
        kind: "text",
        body: text,
        edited: Boolean(editing),
        replyTo: replyTo
          ? {
              id: replyTo.id,
              body:
                replyTo.payload.kind === "text"
                  ? replyTo.payload.body
                  : replyTo.payload.name,
              senderName: replyTo.mine
                ? "You"
                : (active?.peer?.displayName ?? "User"),
            }
          : undefined,
      });
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Send failed");
      setDraft(text);
    }
  }

  async function onPickFile(file: File | null) {
    if (!file || !active?.peer) return;
    setBusy(true);
    setLookupError(null);
    try {
      const encrypted = await encryptFile(file);
      const token = await api.post<{ attachmentId: string }>(
        "/attachments/upload-token",
        { size: encrypted.ciphertext.byteLength },
      );
      await api.putBinary(
        `/attachments/${token.attachmentId}/data`,
        encrypted.ciphertext,
      );
      await sendPayload({
        kind: "file",
        name: encrypted.name,
        mime: encrypted.mime,
        attachmentId: token.attachmentId,
        contentKeyB64: encrypted.contentKeyB64,
      });
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function downloadAttachment(
    payload: Extract<ChatPayload, { kind: "file" }>,
  ) {
    const cipher = await api.getBinary(
      `/attachments/${payload.attachmentId}/download`,
    );
    const plain = await decryptFile(cipher, payload.contentKeyB64);
    const blob = new Blob([plain], { type: payload.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = payload.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteMessage(
    message: DecryptedMessage,
    scope: "me" | "everyone",
  ) {
    setMenu(null);
    if (scope === "me") {
      setHiddenIds((prev) => new Set(prev).add(message.id));
      return;
    }
    await api.delete(`/messages/${message.id}?scope=everyone`);
    if (active) await loadMessages(active);
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--lop-bg)]">
      {/* Messaging-only rail */}
      <nav className="hidden w-[72px] flex-col items-center justify-between border-r border-[var(--lop-border)] bg-[var(--lop-rail)] py-4 md:flex">
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--lop-panel-3)] text-[var(--lop-accent)]">
            <span className="absolute -left-2 top-2 h-7 w-1 rounded-full bg-[var(--lop-accent)]" />
            <MessageCircle size={22} />
          </div>
        </div>
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg p-2 text-[var(--lop-muted)] hover:bg-[var(--lop-panel-2)] hover:text-[var(--lop-text)]"
            title="Log out"
          >
            <LogOut size={20} />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-[var(--lop-muted)] hover:bg-[var(--lop-panel-2)]"
            title="Settings"
          >
            <Settings size={20} />
          </button>
          <Avatar name={session?.displayName ?? "?"} size={34} />
        </div>
      </nav>

      {/* Chat list */}
      <aside
        className={`flex w-full max-w-full flex-col border-r border-[var(--lop-border)] bg-[var(--lop-panel)] md:w-[360px] ${
          mobileShowChat ? "hidden md:flex" : "flex"
        }`}
      >
        <header className="flex items-center justify-between px-4 pb-2 pt-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Chats</h1>
            <p className="text-xs text-[var(--lop-muted)]">@{session?.username}</p>
          </div>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--lop-accent)] text-[#0b141a] shadow"
            title="New chat"
            onClick={() => inputRef.current?.blur()}
          >
            <Plus size={20} />
          </button>
        </header>

        <form onSubmit={onLookup} className="px-3 pb-3">
          <div className="flex items-center gap-2 rounded-lg bg-[var(--lop-panel-2)] px-3 py-2.5">
            <Search size={16} className="text-[var(--lop-muted)]" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--lop-muted)]"
              placeholder="Search or start a new chat"
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              disabled={busy}
            />
          </div>
          {lookupError && (
            <p className="mt-2 text-xs text-[var(--lop-danger)]">{lookupError}</p>
          )}
        </form>

        <div className="flex gap-2 overflow-x-auto px-3 pb-3">
          {["All", "Unread", "Favourites"].map((f, i) => (
            <span
              key={f}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                i === 0
                  ? "bg-[var(--lop-accent)] text-[#0b141a]"
                  : "bg-[var(--lop-panel-2)] text-[var(--lop-muted)]"
              }`}
            >
              {f}
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--lop-panel-2)] text-[var(--lop-accent)]">
                <UserPlus size={24} />
              </div>
              <p className="font-medium">No conversations yet</p>
              <p className="max-w-[220px] text-sm text-[var(--lop-muted)]">
                Find someone by exact @username and start messaging.
              </p>
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setActiveId(c.id);
                  setMobileShowChat(true);
                }}
                className={`flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-[var(--lop-panel-2)] ${
                  activeId === c.id ? "bg-[var(--lop-panel-2)]" : ""
                }`}
              >
                <Avatar name={c.peer?.displayName ?? "?"} size={48} />
                <div className="min-w-0 flex-1 border-b border-[var(--lop-border)] pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {c.peer?.displayName ?? "Unknown"}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--lop-muted)]">
                      {formatListTime(c.createdAt)}
                    </span>
                  </div>
                  <div className="truncate text-sm text-[var(--lop-muted)]">
                    @{c.peer?.username}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Conversation pane */}
      <main
        className={`relative min-w-0 flex-1 flex-col ${
          mobileShowChat ? "flex" : "hidden md:flex"
        }`}
      >
        {!active ? (
          <div className="lop-chat-bg flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[var(--lop-border)] bg-[var(--lop-panel)] text-[var(--lop-accent)] shadow-lg">
              <MessageCircle size={36} />
            </div>
            <div>
              <h2 className="text-3xl font-light tracking-tight">Lop</h2>
              <p className="mt-2 max-w-sm text-sm text-[var(--lop-muted)]">
                Private messaging. Messages disappear after 24 hours.
              </p>
            </div>
            <div className="flex gap-8 text-sm text-[var(--lop-muted)]">
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--lop-panel-2)]">
                  <FileText size={20} />
                </div>
                Send files
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--lop-panel-2)]">
                  <UserPlus size={20} />
                </div>
                Add by @username
              </div>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-[var(--lop-border)] bg-[var(--lop-panel)] px-3 py-2.5 md:px-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="rounded-lg p-1 text-[var(--lop-muted)] md:hidden"
                  onClick={() => setMobileShowChat(false)}
                >
                  ←
                </button>
                <Avatar name={active.peer?.displayName ?? "?"} size={40} />
                <div>
                  <div className="font-medium leading-tight">
                    {active.peer?.displayName}
                  </div>
                  <div className="text-xs text-[var(--lop-muted)]">
                    {peerTyping ? (
                      <span className="text-[var(--lop-accent)]">typing…</span>
                    ) : (
                      `@${active.peer?.username}`
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[var(--lop-muted)]">
                <button
                  type="button"
                  className="rounded-lg p-2 hover:bg-[var(--lop-panel-2)]"
                  title="Search in chat"
                >
                  <Search size={18} />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 hover:bg-[var(--lop-panel-2)]"
                  title="More"
                >
                  <MoreVertical size={18} />
                </button>
              </div>
            </header>

            <div
              ref={listRef}
              className="lop-chat-bg flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-4 md:px-8"
            >
              {visibleMessages.map((m) => (
                <div
                  key={m.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, message: m });
                  }}
                  className={`max-w-[85%] px-1 sm:max-w-[65%] ${
                    m.mine ? "ml-auto" : ""
                  }`}
                >
                  <div
                    className={`px-3 py-2 text-[14.5px] leading-snug shadow-sm ${
                      m.mine ? "lop-bubble-out" : "lop-bubble-in"
                    }`}
                  >
                    {m.payload.replyTo && (
                      <div className="mb-1.5 rounded-md border-l-[3px] border-[var(--lop-accent)] bg-black/20 px-2 py-1.5 text-xs">
                        <div className="font-semibold text-[var(--lop-accent)]">
                          {m.payload.replyTo.senderName}
                        </div>
                        <div className="truncate text-[var(--lop-muted)]">
                          {m.payload.replyTo.body}
                        </div>
                      </div>
                    )}
                    {m.payload.kind === "text" ? (
                      <div className="whitespace-pre-wrap break-words">
                        {m.payload.body}
                        {m.payload.edited ? (
                          <span className="ml-1 text-[10px] italic text-[var(--lop-muted)]">
                            edited
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-lg bg-black/15 px-2 py-2 text-left hover:bg-black/25"
                        onClick={() => void downloadAttachment(m.payload)}
                      >
                        <FileText size={18} />
                        <span className="underline">{m.payload.name}</span>
                      </button>
                    )}
                    <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[var(--lop-muted)]">
                      <span>{formatClock(m.createdAt)}</span>
                      {m.mine ? <Tick state={m.deliveryState} /> : null}
                    </div>
                  </div>
                </div>
              ))}

              {peerTyping && (
                <div className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--lop-muted)]">
                  <span className="inline-flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <i
                        key={i}
                        className="lop-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--lop-accent)]"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </span>
                  {active.peer?.displayName} is typing
                </div>
              )}
            </div>

            {(replyTo || editing) && (
              <div className="flex items-center justify-between border-t border-[var(--lop-border)] bg-[var(--lop-panel-2)] px-4 py-2">
                <div className="min-w-0 border-l-[3px] border-[var(--lop-accent)] pl-3">
                  <div className="text-xs font-semibold text-[var(--lop-accent)]">
                    {editing ? "Editing message" : "Replying"}
                  </div>
                  <div className="truncate text-sm text-[var(--lop-muted)]">
                    {editing
                      ? editing.payload.kind === "text"
                        ? editing.payload.body
                        : editing.payload.name
                      : replyTo?.payload.kind === "text"
                        ? replyTo.payload.body
                        : replyTo?.payload.name}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-2 text-[var(--lop-muted)] hover:bg-[var(--lop-panel)]"
                  onClick={() => {
                    setReplyTo(null);
                    setEditing(null);
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <form
              onSubmit={sendMessage}
              className="flex items-end gap-2 border-t border-[var(--lop-border)] bg-[var(--lop-panel)] p-3"
            >
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--lop-border)] bg-[var(--lop-panel-2)] text-[var(--lop-muted)] hover:text-[var(--lop-text)]"
                disabled={busy}
                title="Attach file"
              >
                <Paperclip size={18} />
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                className="max-h-[120px] min-h-[42px] flex-1 resize-none rounded-xl bg-[var(--lop-input)] px-4 py-2.5 text-sm outline-none placeholder:text-[var(--lop-muted)]"
                placeholder="Type a message"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  emitTyping();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(e as unknown as FormEvent);
                  }
                }}
              />
              <button
                type="submit"
                className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--lop-accent)] text-[#0b141a] shadow hover:bg-[var(--lop-accent-hover)] disabled:opacity-50"
                disabled={!draft.trim()}
                title="Send"
              >
                <Send size={18} />
              </button>
            </form>
          </>
        )}
      </main>

      {menu && (
        <div
          className="fixed z-50 min-w-[200px] overflow-hidden rounded-2xl border border-[var(--lop-border)] bg-[var(--lop-panel-2)] py-1 text-sm shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuRow
            icon={<Reply size={16} />}
            label="Reply"
            onClick={() => {
              setReplyTo(menu.message);
              setEditing(null);
              setMenu(null);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          />
          <MenuRow
            icon={<Copy size={16} />}
            label="Copy"
            onClick={() => {
              const t =
                menu.message.payload.kind === "text"
                  ? menu.message.payload.body
                  : menu.message.payload.name;
              void navigator.clipboard.writeText(t);
              setMenu(null);
            }}
          />
          {menu.message.mine && menu.message.payload.kind === "text" && (
            <MenuRow
              icon={<Pencil size={16} />}
              label="Edit"
              onClick={() => {
                setEditing(menu.message);
                setDraft(menu.message.payload.body);
                setReplyTo(null);
                setMenu(null);
              }}
            />
          )}
          <MenuRow
            icon={<Forward size={16} />}
            label="Forward"
            onClick={() => {
              if (menu.message.payload.kind === "text") {
                setDraft(`Fwd: ${menu.message.payload.body}`);
              }
              setMenu(null);
            }}
          />
          <MenuRow
            icon={<Info size={16} />}
            label="Message info"
            onClick={() => {
              setInfoMsg(menu.message);
              setMenu(null);
            }}
          />
          <div className="my-1 h-px bg-[var(--lop-border)]" />
          <MenuRow
            icon={<Trash2 size={16} />}
            label="Delete for me"
            danger
            onClick={() => void deleteMessage(menu.message, "me")}
          />
          {menu.message.mine && (
            <MenuRow
              icon={<Trash2 size={16} />}
              label="Delete for everyone"
              danger
              onClick={() => void deleteMessage(menu.message, "everyone")}
            />
          )}
        </div>
      )}

      {infoMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--lop-border)] bg-[var(--lop-panel)] p-5 shadow-2xl">
            <h2 className="text-lg font-semibold">Message info</h2>
            <div className="mt-4 space-y-3 text-sm text-[var(--lop-muted)]">
              <div className="flex justify-between">
                <span>Sent</span>
                <span>{new Date(infoMsg.createdAt).toLocaleString()}</span>
              </div>
              {infoMsg.mine && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      Delivered <Tick state="delivered" />
                    </span>
                    <span>
                      {infoMsg.deliveryState !== "accepted" ? "Yes" : "Pending"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      Read <Tick state="read" />
                    </span>
                    <span>
                      {infoMsg.deliveryState === "read" ? "Yes" : "Pending"}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span>Expires</span>
                <span>{new Date(infoMsg.expiresAt).toLocaleString()}</span>
              </div>
            </div>
            <button
              type="button"
              className="mt-5 w-full rounded-xl bg-[var(--lop-accent)] py-2.5 font-semibold text-[#0b141a]"
              onClick={() => setInfoMsg(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left hover:bg-[var(--lop-panel)] ${
        danger ? "text-[var(--lop-danger)]" : ""
      }`}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="opacity-80">{icon}</span>
    </button>
  );
}
