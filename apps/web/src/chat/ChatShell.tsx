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
  Info,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Paperclip,
  Pencil,
  Reply,
  Search,
  Send,
  Settings,
  Smile,
  Sun,
  Trash2,
  User,
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
import { useTheme } from "@/theme/ThemeProvider";

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

const EMOJIS = [
  "😀",
  "😂",
  "😍",
  "🥰",
  "😊",
  "😎",
  "🤔",
  "😢",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙏",
  "🔥",
  "❤️",
  "💙",
  "✨",
  "🎉",
  "💯",
  "👀",
];

function formatClock(ts: number): string {
  return new Date(ts)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
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
    return <CheckCheck size={14} className="text-[rgb(var(--read))]" />;
  }
  if (state === "delivered") {
    return <CheckCheck size={14} className="text-secondary-darker" />;
  }
  return <Check size={14} className="text-secondary-darker" />;
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

type ModalKind = "add" | "profile" | "settings" | null;

export function ChatShell() {
  const { session, clearAuth, beginSoftUnlock } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [searchVal, setSearchVal] = useState("");
  const [error, setError] = useState<string | null>(null);
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
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | null>(null);
  const peerTypingClear = useRef<number | null>(null);
  const navMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (
        navMenuRef.current &&
        !navMenuRef.current.contains(e.target as Node)
      ) {
        setNavMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const filteredConversations = useMemo(() => {
    const q = searchVal.trim().toLowerCase().replace(/^@/, "");
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = c.peer?.displayName.toLowerCase() ?? "";
      const user = c.peer?.username.toLowerCase() ?? "";
      return name.includes(q) || user.includes(q);
    });
  }, [conversations, searchVal]);

  const visibleMessages = useMemo(() => {
    const base = messages.filter((m) => !hiddenIds.has(m.id));
    const q = chatSearch.trim().toLowerCase();
    if (!q || !chatSearchOpen) return base;
    return base.filter((m) => {
      if (m.payload.kind === "text") return m.payload.body.toLowerCase().includes(q);
      return m.payload.name.toLowerCase().includes(q);
    });
  }, [messages, hiddenIds, chatSearch, chatSearchOpen]);

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
    if (
      evt.type === "typing.start" &&
      active &&
      evt.conversationId === active.id
    ) {
      setPeerTyping(true);
      if (peerTypingClear.current) window.clearTimeout(peerTypingClear.current);
      peerTypingClear.current = window.setTimeout(
        () => setPeerTyping(false),
        1500,
      );
    }
    if (
      evt.type === "typing.stop" &&
      active &&
      evt.conversationId === active.id
    ) {
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
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
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
    setNavMenuOpen(false);
    broadcastSessionEvent("wipe");
    try {
      await api.post("/auth/logout", {});
    } catch {
      /* ignore */
    }
    clearAuth();
    window.location.href = "/";
  }

  async function startChatWithUsername(raw: string): Promise<boolean> {
    setAddError(null);
    setError(null);
    setBusy(true);
    try {
      if (!hasVaultKeys()) {
        throw new Error("Vault is locked. Unlock with your passcode.");
      }
      const username = raw.replace(/^@/, "").toLowerCase().trim();
      if (!username) throw new Error("Enter a username");
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
      setModal(null);
      setAddUsername("");
      setSearchVal("");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Not found";
      setAddError(msg);
      setError(msg);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onLookup(e: FormEvent) {
    e.preventDefault();
    if (searchVal.trim()) {
      await startChatWithUsername(searchVal);
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
    setEmojiOpen(false);
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
      setError(err instanceof Error ? err.message : "Send failed");
      setDraft(text);
    }
  }

  async function onPickFile(file: File | null) {
    if (!file || !active?.peer) return;
    setBusy(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : "Upload failed");
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
    const blob = new Blob([plain.buffer as ArrayBuffer], { type: payload.mime });
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
    <div className="flex h-full min-h-0 flex-col bg-background text-text select-none">
      <header className="relative z-40">
        <nav className="flex h-14 items-center justify-around bg-background text-text shadow">
          <button
            type="button"
            className="hidden max-lg:block"
            onClick={() => setMobileShowChat(false)}
            aria-label="Open chats"
          >
            <Menu size={22} />
          </button>

          <div className="flex items-center justify-center gap-x-2">
            <h1 className="font-brand text-3xl font-medium max-sm:text-xl">
              Lop
            </h1>
          </div>

          <div className="flex items-center gap-x-6">
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg p-1.5 hover:bg-secondary-dark"
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            <div className="relative shrink-0" ref={navMenuRef}>
              <button
                type="button"
                onClick={() => setNavMenuOpen((v) => !v)}
                className="rounded-full"
                aria-label="Account menu"
              >
                <Avatar name={session?.displayName ?? "?"} size={40} />
              </button>
              {navMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-12 z-50 w-60 rounded-lg bg-secondary-dark p-2 shadow-2xl"
                >
                  <MenuItem
                    icon={<User size={16} />}
                    label="Profile"
                    onClick={() => {
                      setNavMenuOpen(false);
                      setModal("profile");
                    }}
                  />
                  <MenuItem
                    icon={<UserPlus size={16} />}
                    label="Add contact"
                    onClick={() => {
                      setNavMenuOpen(false);
                      setAddUsername("");
                      setAddError(null);
                      setModal("add");
                    }}
                  />
                  <MenuItem
                    icon={<Settings size={16} />}
                    label="Settings"
                    onClick={() => {
                      setNavMenuOpen(false);
                      setModal("settings");
                    }}
                  />
                  <MenuItem
                    icon={<LogOut size={16} />}
                    label="Logout"
                    onClick={() => void logout()}
                  />
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      <main className="flex h-[calc(100vh-3.5rem)] w-full gap-x-6 bg-background p-4 max-md:gap-x-0 max-md:p-2">
        {/* Chat list */}
        <aside
          className={`relative z-10 flex h-full w-[22rem] min-h-0 flex-col overflow-y-auto bg-background p-2 max-sm:w-auto max-lg:fixed max-lg:inset-y-14 max-lg:left-0 max-lg:pb-20 ${
            mobileShowChat ? "max-lg:hidden" : ""
          }`}
        >
          <div className="flex min-h-full flex-col gap-y-5">
            <div className="flex items-center rounded-md bg-secondary-dark px-2 text-text">
              <Search size={16} className="text-secondary-darker" />
              <input
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onLookup(e as unknown as FormEvent);
                  }
                }}
                className="w-full bg-inherit px-3 py-3 outline-none"
                type="text"
                placeholder="Search"
                aria-label="Search chats"
              />
              {searchVal.trim().length > 0 && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchVal("")}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {error && (
              <p className="px-1 text-center text-sm text-danger">{error}</p>
            )}

            {conversations.length === 0 ? (
              <span className="mt-4 mb-4 self-center px-2 text-center text-text">
                Open your profile menu, add a contact by @username, and start
                chatting
              </span>
            ) : filteredConversations.length === 0 ? (
              <span className="mt-4 self-center text-center text-secondary-darker">
                No chats match “{searchVal}”
              </span>
            ) : (
              <div className="flex flex-col gap-y-1">
                {filteredConversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveId(c.id);
                      setMobileShowChat(true);
                      setDetailsOpen(false);
                      setChatSearchOpen(false);
                      setChatSearch("");
                      setError(null);
                    }}
                    className={`flex w-full items-center gap-x-3 p-1 text-left text-text hover:cursor-pointer hover:bg-secondary-dark ${
                      activeId === c.id ? "bg-secondary-dark" : ""
                    }`}
                  >
                    <Avatar name={c.peer?.displayName ?? "?"} size={56} />
                    <div className="flex w-full min-w-0 flex-col gap-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {c.peer?.displayName ?? "Unknown"}
                        </span>
                        <span className="shrink-0 text-xs text-secondary-darker">
                          {formatListTime(c.createdAt)}
                        </span>
                      </div>
                      <span className="truncate text-sm text-secondary-darker">
                        @{c.peer?.username}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="sticky -bottom-5 z-50 mt-auto flex w-full gap-7 rounded-md bg-background/100 px-3 py-3">
              <div className="flex flex-col items-center gap-2 rounded-md bg-secondary-dark px-5 py-2">
                <MessageCircle size={20} />
                <span className="text-sm text-text">Chats</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Conversation */}
        <section
          className={`relative flex min-w-0 flex-[1.6] flex-col ${
            mobileShowChat ? "" : "max-lg:hidden"
          }`}
        >
          {!active ? (
            <div className="mt-20 flex max-w-96 flex-col items-center justify-center self-center justify-self-center">
              <div className="flex flex-col items-center gap-y-6 text-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary-dark text-primary">
                  <Lock size={40} />
                </div>
                <div className="flex flex-col items-center gap-y-1 text-xl font-light text-text">
                  <div className="flex items-center gap-x-1">
                    <p>End-to-end encrypted</p>
                    <Lock size={16} />
                  </div>
                  <p>Private chats</p>
                  <p className="mt-2 text-sm text-secondary-darker">
                    Messages disappear after 24 hours
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex h-full flex-col justify-between gap-y-3">
              <div className="flex flex-col gap-1">
                <div
                  className="flex cursor-pointer items-center justify-between text-text"
                  onClick={() => setDetailsOpen(true)}
                >
                  <div className="flex gap-x-3">
                    <button
                      type="button"
                      className="self-center rounded-lg p-1 text-secondary-darker lg:hidden"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMobileShowChat(false);
                      }}
                    >
                      ←
                    </button>
                    <Avatar name={active.peer?.displayName ?? "?"} size={56} />
                    <div className="flex flex-col gap-y-1">
                      <span className="text-lg font-medium max-sm:text-base">
                        {active.peer?.displayName}
                      </span>
                      <span className="text-sm text-secondary-darker max-sm:text-sm">
                        {peerTyping ? (
                          <span className="text-primary">typing…</span>
                        ) : (
                          `@${active.peer?.username}`
                        )}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg p-2 hover:bg-secondary-dark"
                    title="Search in chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      setChatSearchOpen((v) => !v);
                      setChatSearch("");
                    }}
                  >
                    <Search size={18} />
                  </button>
                </div>

                {chatSearchOpen && (
                  <div className="flex items-center rounded-md bg-secondary-dark px-2">
                    <Search size={14} className="text-secondary-darker" />
                    <input
                      autoFocus
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      className="w-full bg-inherit px-3 py-2 text-sm outline-none"
                      placeholder="Search messages"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setChatSearchOpen(false);
                        setChatSearch("");
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div
                ref={listRef}
                className="flex flex-1 flex-col gap-y-3 overflow-y-auto py-2"
              >
                {visibleMessages.map((m) => (
                  <div
                    key={m.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, message: m });
                    }}
                    className={`flex gap-x-2 text-text ${
                      m.mine ? "self-end" : ""
                    }`}
                  >
                    {!m.mine && (
                      <Avatar name={active.peer?.displayName ?? "?"} size={36} />
                    )}
                    <div
                      className={`flex min-w-20 max-w-96 flex-col justify-center gap-y-1 px-4 py-2 max-md:max-w-80 max-sm:max-w-64 ${
                        m.mine ? "lop-bubble-out" : "lop-bubble-in"
                      }`}
                    >
                      {m.payload.replyTo && (
                        <div className="mb-2 flex flex-col rounded-xl bg-white/35 px-4 py-2 max-sm:text-sm">
                          <span className="text-sm font-semibold">
                            {m.payload.replyTo.senderName}
                          </span>
                          <div className="truncate">{m.payload.replyTo.body}</div>
                        </div>
                      )}
                      {m.payload.kind === "text" ? (
                        <span className="break-words max-sm:text-sm">
                          {m.payload.body}
                          {m.payload.edited ? (
                            <span className="ml-1 text-xs italic opacity-80">
                              Edited
                            </span>
                          ) : null}
                        </span>
                      ) : m.payload.kind === "file" ? (
                        <button
                          type="button"
                          className="flex items-center gap-2 text-left underline"
                          onClick={() => {
                            if (m.payload.kind === "file") {
                              void downloadAttachment(m.payload);
                            }
                          }}
                        >
                          <FileText size={16} />
                          {m.payload.name}
                        </button>
                      ) : null}
                      <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
                        <span
                          className={`text-xs ${
                            m.mine ? "text-gray-200" : "text-secondary-darker"
                          }`}
                        >
                          {formatClock(m.createdAt)}
                        </span>
                        {m.mine ? <Tick state={m.deliveryState} /> : null}
                      </div>
                    </div>
                  </div>
                ))}

                {peerTyping && (
                  <div className="flex items-center gap-2 px-2 text-xs text-secondary-darker">
                    <span className="inline-flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <i
                          key={i}
                          className="lop-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-primary"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </span>
                    {active.peer?.displayName} is typing
                  </div>
                )}
              </div>

              {(replyTo || editing) && (
                <div className="flex items-center justify-between rounded-md bg-secondary-dark px-2 py-2 max-sm:text-sm">
                  <p className="px-2 text-text">
                    {editing
                      ? `Editing "${
                          editing.payload.kind === "text"
                            ? editing.payload.body.slice(0, 80)
                            : editing.payload.name
                        }"`
                      : `Replying to "${
                          replyTo?.payload.kind === "text"
                            ? replyTo.payload.body.slice(0, 80)
                            : replyTo?.payload.name
                        }"`}
                  </p>
                  <button
                    type="button"
                    className="text-text"
                    onClick={() => {
                      setReplyTo(null);
                      setEditing(null);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              <form onSubmit={sendMessage} className="relative" autoComplete="off">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                />

                {emojiOpen && (
                  <div className="absolute bottom-full mb-2 grid w-full max-w-sm grid-cols-10 gap-1 rounded-xl bg-secondary-dark p-3 shadow-2xl">
                    {EMOJIS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        className="rounded p-1 text-lg hover:bg-secondary"
                        onClick={() => {
                          setDraft((d) => d + em);
                          inputRef.current?.focus();
                        }}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-end rounded-xl bg-secondary text-text">
                  <button
                    type="button"
                    className="px-2 hover:text-primary"
                    onClick={() => setEmojiOpen((v) => !v)}
                    title="Emoji"
                  >
                    <Smile size={22} />
                  </button>
                  <textarea
                    ref={inputRef}
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
                    className="w-full resize-none rounded-sm bg-secondary px-3 py-5 outline-none max-sm:text-sm"
                    style={{ scrollbarWidth: "none" }}
                    placeholder="Your message"
                    rows={1}
                    maxLength={1000}
                    spellCheck={false}
                  />
                  {!draft.trim() ? (
                    <button
                      type="button"
                      className="px-3 hover:text-primary"
                      disabled={busy}
                      onClick={() => fileRef.current?.click()}
                      title="Attach file"
                    >
                      <Paperclip size={20} />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="rounded-full bg-primary-dark p-2 transition-colors hover:bg-transparent"
                      title="Send"
                    >
                      <Send size={18} className="text-white" />
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}
        </section>

        {/* Contact details drawer */}
        {detailsOpen && active && (
          <aside className="flex w-80 flex-col gap-4 overflow-y-auto rounded-xl bg-secondary-dark p-4 max-xl:fixed max-xl:inset-y-14 max-xl:right-0 max-xl:z-30 max-xl:shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Contact</h2>
              <button type="button" onClick={() => setDetailsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col items-center gap-3 py-4">
              <Avatar name={active.peer?.displayName ?? "?"} size={88} />
              <div className="text-center">
                <div className="text-xl font-medium">
                  {active.peer?.displayName}
                </div>
                <div className="text-secondary-darker">
                  @{active.peer?.username}
                </div>
              </div>
            </div>
            <p className="text-center text-sm text-secondary-darker">
              Messages in this chat expire after 24 hours.
            </p>
            <button
              type="button"
              className="rounded-lg bg-background px-4 py-3 text-left hover:bg-secondary"
              onClick={() => {
                setDetailsOpen(false);
                setChatSearchOpen(true);
              }}
            >
              Search messages
            </button>
          </aside>
        )}
      </main>

      {menu && (
        <div
          className="fixed z-50 flex min-w-32 flex-col self-end rounded-2xl bg-secondary-dark p-2 text-text shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.message.mine && menu.message.payload.kind === "text" && (
            <CtxRow
              label="Edit"
              icon={<Pencil size={14} />}
              onClick={() => {
                const payload = menu.message.payload;
                if (payload.kind !== "text") return;
                setEditing(menu.message);
                setDraft(payload.body);
                setReplyTo(null);
                setMenu(null);
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }}
            />
          )}
          <CtxRow
            label="Reply"
            icon={<Reply size={14} />}
            onClick={() => {
              setReplyTo(menu.message);
              setEditing(null);
              setMenu(null);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          />
          {menu.message.mine && (
            <CtxRow
              label="Unsend"
              icon={<Trash2 size={14} />}
              onClick={() => void deleteMessage(menu.message, "everyone")}
            />
          )}
          {menu.message.payload.kind === "text" && (
            <CtxRow
              label="Copy"
              icon={<Copy size={14} />}
              onClick={() => {
                const payload = menu.message.payload;
                if (payload.kind !== "text") return;
                void navigator.clipboard.writeText(payload.body);
                setMenu(null);
              }}
            />
          )}
          <CtxRow
            label="Info"
            icon={<Info size={14} />}
            onClick={() => {
              setInfoMsg(menu.message);
              setMenu(null);
            }}
          />
          <CtxRow
            label="Delete for me"
            icon={<Trash2 size={14} />}
            onClick={() => void deleteMessage(menu.message, "me")}
          />
        </div>
      )}

      {infoMsg && (
        <Modal title="Message info" onClose={() => setInfoMsg(null)}>
          <div className="space-y-3 text-sm text-secondary-darker">
            <Row label="Sent" value={new Date(infoMsg.createdAt).toLocaleString()} />
            {infoMsg.mine && (
              <>
                <Row
                  label="Delivered"
                  value={infoMsg.deliveryState !== "accepted" ? "Yes" : "Pending"}
                />
                <Row
                  label="Read"
                  value={infoMsg.deliveryState === "read" ? "Yes" : "Pending"}
                />
              </>
            )}
            <Row
              label="Expires"
              value={new Date(infoMsg.expiresAt).toLocaleString()}
            />
          </div>
        </Modal>
      )}

      {modal === "add" && (
        <Modal title="Add contact" onClose={() => setModal(null)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void startChatWithUsername(addUsername);
            }}
          >
            <input
              autoFocus
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              className="w-full rounded bg-background p-3 text-text outline-none ring-1 ring-secondary-dark focus:ring-primary"
              placeholder="Search username"
            />
            {addError && <p className="text-sm text-danger">{addError}</p>}
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-primary px-6 py-3 font-medium text-white shadow-lg disabled:opacity-60"
            >
              {busy ? "Looking up…" : "Start chat"}
            </button>
          </form>
        </Modal>
      )}

      {modal === "profile" && (
        <Modal title="Profile" onClose={() => setModal(null)}>
          <div className="flex flex-col items-center gap-3 py-2">
            <Avatar name={session?.displayName ?? "?"} size={80} />
            <div className="text-center">
              <div className="text-xl font-semibold">{session?.displayName}</div>
              <div className="text-secondary-darker">@{session?.username}</div>
              <div className="mt-1 text-sm text-secondary-darker">
                {session?.email}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {modal === "settings" && (
        <Modal title="Settings" onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              className="flex items-center justify-between rounded-lg bg-background px-4 py-3 hover:bg-secondary"
              onClick={toggleTheme}
            >
              <span>Theme</span>
              <span className="text-secondary-darker capitalize">{theme}</span>
            </button>
            <button
              type="button"
              className="flex items-center justify-between rounded-lg bg-background px-4 py-3 hover:bg-secondary"
              onClick={() => {
                setModal(null);
                softLock();
              }}
            >
              <span>Lock vault now</span>
              <Lock size={16} />
            </button>
            <button
              type="button"
              className="flex items-center justify-between rounded-lg bg-background px-4 py-3 text-danger hover:bg-secondary"
              onClick={() => void logout()}
            >
              <span>Logout</span>
              <LogOut size={16} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-x-2 rounded p-2 hover:bg-secondary"
    >
      {icon}
      <p>{label}</p>
    </button>
  );
}

function CtxRow({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center justify-between rounded-sm p-2 hover:bg-secondary-darker/30"
    >
      <span>{label}</span>
      <span>{icon}</span>
    </button>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl bg-secondary-dark p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="text-right text-text">{value}</span>
    </div>
  );
}
