import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

function Tick({ state }: { state: DeliveryState }) {
  if (state === "read") {
    return <span className="ml-1 text-[11px] text-[#53bdeb]">✓✓</span>;
  }
  if (state === "delivered") {
    return <span className="ml-1 text-[11px] text-[var(--lop-muted)]">✓✓</span>;
  }
  return <span className="ml-1 text-[11px] text-[var(--lop-muted)]">✓</span>;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  // Soft-lock when tab is hidden for a while (ephemeral-browser pattern)
  useEffect(() => {
    let hideTimer: number | null = null;
    const onVis = () => {
      if (document.hidden) {
        hideTimer = window.setTimeout(softLock, 60_000);
      } else if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
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
      if (!conversation.peer || !session) return;
      if (!hasVaultKeys()) return;
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
      messageId?: string;
      displayName?: string;
    };
    if (evt.type === "conversation.refresh") {
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
    if (evt.type === "message.new") {
      void refreshConversations().catch(() => undefined);
    }
    if (evt.type === "typing.start" && active && evt.conversationId === active.id) {
      setPeerTyping(true);
      if (peerTypingClear.current) window.clearTimeout(peerTypingClear.current);
      peerTypingClear.current = window.setTimeout(() => setPeerTyping(false), 1500);
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
        throw new Error("Vault is locked. Refresh and unlock with your passcode.");
      }
      const username = lookup.replace(/^@/, "").toLowerCase().trim();
      const user = await api.get<{
        userId: string;
        username: string;
        displayName: string;
      }>(`/users/lookup?username=${encodeURIComponent(username)}`);
      await api.post("/contacts", { contactUserId: user.userId });
      const conv = await api.post<{ conversationId: string }>("/conversations", {
        peerUserId: user.userId,
      });
      await refreshConversations();
      setActiveId(conv.conversationId);
      setLookup("");
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Not found");
    } finally {
      setBusy(false);
    }
  }

  async function sendPayload(payload: ChatPayload) {
    if (!active?.peer || !session) return;
    let deviceId = getDeviceId();
    if (!deviceId) {
      throw new Error("Device keys missing. Unlock your vault passcode again.");
    }
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
      const payload: ChatPayload = {
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
      };
      await sendPayload(payload);
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
      const token = await api.post<{
        attachmentId: string;
      }>("/attachments/upload-token", { size: encrypted.ciphertext.byteLength });
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

  async function deleteMessage(message: DecryptedMessage, scope: "me" | "everyone") {
    setMenu(null);
    if (scope === "me") {
      setHiddenIds((prev) => new Set(prev).add(message.id));
      return;
    }
    await api.delete(`/messages/${message.id}?scope=everyone`);
    if (active) await loadMessages(active);
  }

  function previewText(c: ConversationRow): string {
    return `Chat with @${c.peer?.username ?? "user"}`;
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--lop-bg)]">
      {/* Left nav rail */}
      <nav className="hidden w-[60px] flex-col items-center justify-between border-r border-[var(--lop-border)] bg-[#1b2429] py-3 md:flex">
        <div className="flex flex-col items-center gap-4 text-[var(--lop-muted)]">
          <div className="relative rounded-lg bg-[#2a3942] p-2 text-[var(--lop-accent)]">
            <span className="absolute -left-1 top-1 h-6 w-1 rounded bg-[var(--lop-accent)]" />
            💬
          </div>
          <span title="Calls">📞</span>
          <span title="Status">◐</span>
        </div>
        <div className="flex flex-col items-center gap-4 text-[var(--lop-muted)]">
          <button type="button" onClick={() => void logout()} title="Log out">
            ⚙
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--lop-accent)] text-xs font-bold text-[#111]">
            {initials(session?.displayName ?? "?")}
          </div>
        </div>
      </nav>

      {/* Chat list */}
      <aside className="flex w-full max-w-[380px] flex-col border-r border-[var(--lop-border)] bg-[var(--lop-panel)] md:w-[32%]">
        <header className="flex items-center justify-between px-4 py-3">
          <h1 className="text-xl font-semibold">Chats</h1>
          <div className="text-[var(--lop-accent)]">＋</div>
        </header>

        <form onSubmit={onLookup} className="px-3 pb-2">
          <input
            className="w-full rounded-lg bg-[var(--lop-panel-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--lop-muted)]"
            placeholder="Search or start a new chat"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            disabled={busy}
          />
          {lookupError && (
            <p className="mt-2 text-xs text-red-400">{lookupError}</p>
          )}
        </form>

        <div className="flex gap-2 overflow-x-auto px-3 pb-2">
          {["All", "Unread", "Favourites"].map((f, i) => (
            <span
              key={f}
              className={`rounded-full px-3 py-1 text-xs ${
                i === 0
                  ? "bg-[var(--lop-accent)] text-[#111]"
                  : "bg-[var(--lop-panel-2)] text-[var(--lop-muted)]"
              }`}
            >
              {f}
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[var(--lop-muted)]">
              <p className="text-base text-[var(--lop-text)]">No conversations</p>
              <p className="text-sm">
                Search by exact @username to start a chat.
              </p>
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                className={`flex w-full items-center gap-3 border-b border-[var(--lop-border)] px-3 py-3 text-left hover:bg-[var(--lop-panel-2)] ${
                  activeId === c.id ? "bg-[var(--lop-panel-2)]" : ""
                }`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#6b7c85] text-sm font-semibold">
                  {initials(c.peer?.displayName ?? "?")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {c.peer?.displayName ?? "Unknown"}
                    </span>
                    <span className="text-[11px] text-[var(--lop-muted)]">
                      {formatClock(c.createdAt)}
                    </span>
                  </div>
                  <div className="truncate text-sm text-[var(--lop-muted)]">
                    {previewText(c)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main pane */}
      <main className="relative hidden min-w-0 flex-1 flex-col md:flex">
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-[#0b141a] text-[var(--lop-muted)]">
            <div className="text-4xl font-light text-[var(--lop-text)]">Lop</div>
            <div className="flex gap-10 text-center text-sm">
              <div>
                <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--lop-panel-2)] text-2xl">
                  📄
                </div>
                Send document
              </div>
              <div>
                <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--lop-panel-2)] text-2xl">
                  👤
                </div>
                Add contact
              </div>
            </div>
            <p className="max-w-sm text-center text-sm">
              Private messaging. Messages disappear after 24 hours.
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-[var(--lop-border)] bg-[var(--lop-panel)] px-4 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#6b7c85] text-sm font-semibold">
                  {initials(active.peer?.displayName ?? "?")}
                </div>
                <div>
                  <div className="font-medium">{active.peer?.displayName}</div>
                  <div className="text-xs text-[var(--lop-muted)]">
                    {peerTyping
                      ? "typing…"
                      : `@${active.peer?.username}`}
                  </div>
                </div>
              </div>
              <div className="flex gap-4 text-[var(--lop-muted)]">
                <span title="Search">🔎</span>
                <span title="Menu">⋮</span>
              </div>
            </header>

            <div
              ref={listRef}
              className="flex flex-1 flex-col gap-1 overflow-y-auto bg-[#0b141a] bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.03)_1px,transparent_0)] bg-[length:24px_24px] p-4"
            >
              {visibleMessages.map((m) => (
                <div
                  key={m.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, message: m });
                  }}
                  className={`max-w-[65%] rounded-lg px-2.5 py-1.5 text-sm shadow ${
                    m.mine
                      ? "ml-auto rounded-tr-none bg-[var(--lop-outgoing)]"
                      : "rounded-tl-none bg-[var(--lop-incoming)]"
                  }`}
                >
                  {m.payload.replyTo && (
                    <div className="mb-1 rounded border-l-2 border-[var(--lop-accent)] bg-black/20 px-2 py-1 text-xs text-[var(--lop-muted)]">
                      <div className="font-medium text-[var(--lop-accent)]">
                        {m.payload.replyTo.senderName}
                      </div>
                      <div className="truncate">{m.payload.replyTo.body}</div>
                    </div>
                  )}
                  {m.payload.kind === "text" ? (
                    <div className="whitespace-pre-wrap break-words">
                      {m.payload.body}
                      {m.payload.edited ? (
                        <span className="ml-1 text-[10px] text-[var(--lop-muted)]">
                          edited
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void downloadAttachment(m.payload)}
                    >
                      📎 {m.payload.name}
                    </button>
                  )}
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[var(--lop-muted)]">
                    <span>{formatClock(m.createdAt)}</span>
                    {m.mine ? <Tick state={m.deliveryState} /> : null}
                  </div>
                </div>
              ))}
              {peerTyping && (
                <div className="flex items-center gap-2 px-1 py-1 text-xs text-[var(--lop-muted)]">
                  <span className="inline-flex gap-1">
                    <i className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--lop-accent)] [animation-delay:0ms]" />
                    <i className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--lop-accent)] [animation-delay:150ms]" />
                    <i className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--lop-accent)] [animation-delay:300ms]" />
                  </span>
                  {active.peer?.displayName} is typing
                </div>
              )}
            </div>

            {(replyTo || editing) && (
              <div className="flex items-center justify-between border-t border-[var(--lop-border)] bg-[var(--lop-panel-2)] px-4 py-2 text-sm">
                <div>
                  <div className="text-[var(--lop-accent)]">
                    {editing ? "Editing" : "Replying"}
                  </div>
                  <div className="truncate text-[var(--lop-muted)]">
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
                  onClick={() => {
                    setReplyTo(null);
                    setEditing(null);
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            <form
              onSubmit={sendMessage}
              className="flex items-center gap-2 border-t border-[var(--lop-border)] bg-[var(--lop-panel)] p-3"
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
                className="px-2 text-xl text-[var(--lop-muted)]"
                disabled={busy}
              >
                ＋
              </button>
              <input
                ref={inputRef}
                className="flex-1 rounded-lg bg-[var(--lop-panel-2)] px-3 py-2.5 outline-none"
                placeholder="Type a message"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  emitTyping();
                }}
              />
              <button
                type="submit"
                className="rounded-full bg-[var(--lop-accent)] px-4 py-2 font-medium text-[#111]"
              >
                Send
              </button>
            </form>
          </>
        )}
      </main>

      {menu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-lg bg-[#233138] py-1 text-sm shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem
            label="Reply"
            onClick={() => {
              setReplyTo(menu.message);
              setEditing(null);
              setMenu(null);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          />
          <MenuItem
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
            <MenuItem
              label="Edit"
              onClick={() => {
                setEditing(menu.message);
                setDraft(menu.message.payload.body);
                setReplyTo(null);
                setMenu(null);
              }}
            />
          )}
          <MenuItem
            label="Forward"
            onClick={() => {
              setLookupError("Pick a chat from search, then paste forwarded text.");
              if (menu.message.payload.kind === "text") {
                setDraft(`Fwd: ${menu.message.payload.body}`);
              }
              setMenu(null);
            }}
          />
          <MenuItem
            label="Message info"
            onClick={() => {
              setInfoMsg(menu.message);
              setMenu(null);
            }}
          />
          <MenuItem
            label="Delete for me"
            danger
            onClick={() => void deleteMessage(menu.message, "me")}
          />
          {menu.message.mine && (
            <MenuItem
              label="Delete for everyone"
              danger
              onClick={() => void deleteMessage(menu.message, "everyone")}
            />
          )}
        </div>
      )}

      {infoMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--lop-panel)] p-5">
            <h2 className="text-lg font-semibold">Message info</h2>
            <div className="mt-4 space-y-2 text-sm text-[var(--lop-muted)]">
              <div>Sent: {new Date(infoMsg.createdAt).toLocaleString()}</div>
              {infoMsg.mine && (
                <>
                  <div className="flex items-center gap-2">
                    Delivered <Tick state="delivered" />
                    {infoMsg.deliveryState !== "accepted" ? "yes" : "pending"}
                  </div>
                  <div className="flex items-center gap-2">
                    Read <Tick state="read" />
                    {infoMsg.deliveryState === "read" ? "yes" : "pending"}
                  </div>
                </>
              )}
              <div>
                Expires: {new Date(infoMsg.expiresAt).toLocaleString()}
              </div>
            </div>
            <button
              type="button"
              className="mt-5 w-full rounded-lg bg-[var(--lop-accent)] py-2 font-medium text-[#111]"
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

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`block w-full px-4 py-2.5 text-left hover:bg-[#182229] ${
        danger ? "text-red-400" : ""
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
