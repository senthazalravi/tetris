import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/api/client";
import {
  decryptIncoming,
  encryptOutgoing,
  getDeviceId,
} from "@/crypto/vaultCrypto";
import {
  decodePayload,
  decryptFile,
  encodePayload,
  encryptFile,
  type ChatPayload,
} from "@/crypto/attachments";
import { useRealtime } from "@/realtime/useRealtime";

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

interface DecryptedMessage {
  id: string;
  senderUserId: string;
  payload: ChatPayload;
  createdAt: number;
  expiresAt: number;
  mine: boolean;
}

export function ChatShell() {
  const { session, clearAuth } = useAuth();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const refreshConversations = useCallback(async () => {
    const res = await api.get<{ conversations: ConversationRow[] }>(
      "/conversations",
    );
    setConversations(res.conversations);
  }, []);

  useEffect(() => {
    void refreshConversations().catch(() => undefined);
  }, [refreshConversations]);

  const loadMessages = useCallback(
    async (conversation: ConversationRow) => {
      if (!conversation.peer || !session) return;
      const res = await api.get<{
        messages: Array<{
          id: string;
          senderUserId: string;
          ciphertext: string;
          cryptoHeader: string;
          createdAt: number;
          expiresAt: number;
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
            mine: m.senderUserId === session.id,
          });
        } catch {
          decrypted.push({
            id: m.id,
            senderUserId: m.senderUserId,
            payload: { kind: "text", body: "[unable to decrypt]" },
            createdAt: m.createdAt,
            expiresAt: m.expiresAt,
            mine: m.senderUserId === session.id,
          });
        }
      }
      setMessages(decrypted);
    },
    [session],
  );

  useRealtime((data) => {
    const evt = data as { type?: string; conversationId?: string };
    if (evt.type === "message.new" && active && evt.conversationId === active.id) {
      void loadMessages(active).catch(() => undefined);
    }
    if (evt.type === "wipe.completed") {
      window.location.href = "/app";
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
    }, 3000);
    return () => window.clearInterval(id);
  }, [active, loadMessages]);

  async function logout() {
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
    const deviceId = getDeviceId();
    if (!deviceId) {
      setLookupError("Device keys missing — re-register on this browser.");
      return;
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
    await loadMessages(active);
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    try {
      await sendPayload({ kind: "text", body: text });
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
        uploadPath: string;
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

  async function downloadAttachment(payload: Extract<ChatPayload, { kind: "file" }>) {
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

  function remainingLabel(expiresAt: number): string {
    const ms = expiresAt - Date.now();
    if (ms <= 0) return "expired";
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-full max-w-sm flex-col border-r border-[var(--lop-border)] bg-[var(--lop-panel)] md:w-[30%]">
        <header className="flex items-center justify-between border-b border-[var(--lop-border)] px-4 py-3">
          <div>
            <div className="font-semibold text-[var(--lop-accent)]">Lop</div>
            <div className="text-xs text-[var(--lop-muted)]">
              @{session?.username}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm text-[var(--lop-muted)] hover:text-[var(--lop-text)]"
          >
            Log out
          </button>
        </header>

        <form
          onSubmit={onLookup}
          className="border-b border-[var(--lop-border)] p-3"
        >
          <input
            className="w-full rounded-lg border border-[var(--lop-border)] bg-[var(--lop-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--lop-accent)]"
            placeholder="New chat — exact @username"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            disabled={busy}
          />
          {lookupError && (
            <p className="mt-2 text-xs text-red-400">{lookupError}</p>
          )}
        </form>

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
                className={`flex w-full flex-col items-start border-b border-[var(--lop-border)] px-4 py-3 text-left hover:bg-[var(--lop-panel-2)] ${
                  activeId === c.id ? "bg-[var(--lop-panel-2)]" : ""
                }`}
              >
                <span className="font-medium">
                  {c.peer?.displayName ?? "Unknown"}
                </span>
                <span className="text-xs text-[var(--lop-muted)]">
                  @{c.peer?.username}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="hidden flex-1 flex-col bg-[var(--lop-bg)] md:flex">
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-[var(--lop-muted)]">
            Select a chat or start a new one
          </div>
        ) : (
          <>
            <header className="border-b border-[var(--lop-border)] bg-[var(--lop-panel)] px-4 py-3">
              <div className="font-medium">{active.peer?.displayName}</div>
              <div className="text-xs text-[var(--lop-muted)]">
                @{active.peer?.username}
              </div>
            </header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                    m.mine
                      ? "ml-auto bg-[var(--lop-outgoing)]"
                      : "bg-[var(--lop-incoming)]"
                  }`}
                >
                  {m.payload.kind === "text" ? (
                    <div>{m.payload.body}</div>
                  ) : (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void downloadAttachment(m.payload)}
                    >
                      📎 {m.payload.name}
                    </button>
                  )}
                  <div className="mt-1 text-[10px] text-[var(--lop-muted)]">
                    {remainingLabel(m.expiresAt)} left
                  </div>
                </div>
              ))}
            </div>
            <form
              onSubmit={sendMessage}
              className="flex gap-2 border-t border-[var(--lop-border)] bg-[var(--lop-panel)] p-3"
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
                className="rounded-lg border border-[var(--lop-border)] px-3 py-2 text-sm"
                disabled={busy}
              >
                File
              </button>
              <input
                className="flex-1 rounded-lg border border-[var(--lop-border)] bg-[var(--lop-panel-2)] px-3 py-2 outline-none focus:border-[var(--lop-accent)]"
                placeholder="Type a message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                type="submit"
                className="rounded-lg bg-[var(--lop-accent)] px-4 py-2 font-medium text-[#111]"
              >
                Send
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
