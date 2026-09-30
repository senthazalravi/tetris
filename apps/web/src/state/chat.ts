import { create } from "zustand";
import {
  CryptoError,
  decryptBlob,
  encryptBlob,
  initiateSession,
  ratchetDecrypt,
  ratchetEncrypt,
  safetyNumber,
  fromBase64,
  type PeerBundle,
  type RatchetState,
} from "@lop/crypto";
import {
  decodeEnvelope,
  encodeEnvelope,
  type AttachmentRef,
  type MessageEnvelope,
  type ReplyRef,
} from "@lop/protocol";
import { MESSAGE_TTL_MS } from "@lop/config";
import type {
  ContactDto,
  ConversationDto,
  RealtimeEvent,
  SyncMessage,
} from "@lop/types";
import { api, ApiError, getVaultToken } from "@/lib/api";
import { newMessageId } from "@/lib/format";
import { imageMeta, mediaKind } from "@/lib/media";
import type { LocalMessage, LocalState, MessageContent } from "./localdb";
import { saveKeys, vault } from "./vault";
import { useSession } from "./session";

/* ================================================================== */
/* store                                                               */
/* ================================================================== */

interface ChatState {
  ready: boolean;
  connection: "connecting" | "online" | "offline";
  conversations: ConversationDto[];
  contacts: ContactDto[];
  messages: Record<string, LocalMessage[]>;
  activeId: string | null;
  typing: Record<string, number>;
  replyTo: Record<string, LocalMessage | null>;
  toast: string | null;
}

export const useChat = create<ChatState>(() => ({
  ready: false,
  connection: "connecting",
  conversations: [],
  contacts: [],
  messages: {},
  activeId: null,
  typing: {},
  replyTo: {},
  toast: null,
}));

const set = useChat.setState;
const get = useChat.getState;

export function toast(message: string) {
  set({ toast: message });
  window.setTimeout(() => {
    if (get().toast === message) set({ toast: null });
  }, 4500);
}

function me(): string {
  return vault().userId;
}

/* ================================================================== */
/* small utilities                                                     */
/* ================================================================== */

const locks = new Map<string, Promise<unknown>>();
/** Serialise work per key (ratchet state must never be mutated concurrently). */
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(
    key,
    next.finally(() => {
      if (locks.get(key) === next) locks.delete(key);
    }),
  );
  return next;
}

const RANK: Record<LocalState, number> = {
  failed: -1,
  sending: 0,
  accepted: 1,
  delivered: 2,
  read: 3,
};

function upsertMessage(m: LocalMessage) {
  set((s) => {
    const list = s.messages[m.convId] ?? [];
    const idx = list.findIndex((x) => x.id === m.id);
    const next = idx >= 0 ? list.map((x, i) => (i === idx ? m : x)) : [...list, m];
    next.sort((a, b) => a.createdAt - b.createdAt);
    return { messages: { ...s.messages, [m.convId]: next } };
  });
}

async function persist(m: LocalMessage) {
  await vault().db.putMessage(m);
}

function localMessage(convId: string, id: string): LocalMessage | undefined {
  return get().messages[convId]?.find((m) => m.id === id);
}

async function saveAndShow(m: LocalMessage) {
  upsertMessage(m);
  await persist(m);
}

async function addSystem(convId: string, text: string) {
  const now = Date.now();
  await saveAndShow({
    id: `sys_${crypto.randomUUID().replace(/-/g, "")}`,
    convId,
    senderId: "system",
    direction: "in",
    createdAt: now,
    expiresAt: now + MESSAGE_TTL_MS,
    state: "read",
    content: { v: 1, kind: "system", text },
  });
}

function convFor(id: string): ConversationDto | undefined {
  return get().conversations.find((c) => c.id === id);
}

function convByPeer(peerId: string): ConversationDto | undefined {
  return get().conversations.find((c) => c.peer.userId === peerId);
}

/* ================================================================== */
/* lifecycle                                                           */
/* ================================================================== */

let started = false;
let ws: WebSocket | null = null;
let wsTimer: number | undefined;
let pingTimer: number | undefined;
let pollTimer: number | undefined;
let pruneTimer: number | undefined;
let syncTimer: number | undefined;
let reconnectAttempts = 0;
let stopped = true;

export async function startEngine() {
  if (started) return;
  started = true;
  stopped = false;
  const { db } = vault();
  const now = Date.now();

  // Anything still "sending" from a previous page never reached the server.
  const stored = await db.allMessages(now);
  const grouped: Record<string, LocalMessage[]> = {};
  for (const m of stored) {
    if (m.state === "sending") {
      m.state = "failed";
      await db.putMessage(m);
    }
    (grouped[m.convId] ??= []).push(m);
  }
  set({ messages: grouped, ready: false, connection: "connecting" });

  await refreshConversations();
  await refreshContacts();
  set({ ready: true });

  await syncNow();
  connectSocket();
  pollTimer = window.setInterval(() => void syncNow(), 25_000);
  pruneTimer = window.setInterval(() => void pruneExpired(), 30_000);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}

export function stopEngine() {
  stopped = true;
  started = false;
  ws?.close();
  ws = null;
  window.clearTimeout(wsTimer);
  window.clearInterval(pingTimer);
  window.clearInterval(pollTimer);
  window.clearInterval(pruneTimer);
  window.clearTimeout(syncTimer);
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
  for (const p of attCache.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  attCache.clear();
  pendingFiles.clear();
  set({
    ready: false,
    connection: "connecting",
    conversations: [],
    contacts: [],
    messages: {},
    activeId: null,
    typing: {},
    replyTo: {},
    toast: null,
  });
}

function onVisible() {
  if (document.visibilityState === "visible") {
    const id = get().activeId;
    if (id) void markRead(id);
    void syncNow();
  }
}

/* ================================================================== */
/* realtime                                                            */
/* ================================================================== */

function connectSocket() {
  if (stopped) return;
  const token = getVaultToken();
  if (!token) return;
  set({ connection: "connecting" });
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/api/v1/ws?vt=${encodeURIComponent(token)}`);
  ws = sock;

  sock.onopen = () => {
    reconnectAttempts = 0;
    set({ connection: "online" });
    window.clearInterval(pingTimer);
    pingTimer = window.setInterval(() => {
      if (sock.readyState === WebSocket.OPEN) sock.send("ping");
    }, 25_000);
    void syncNow();
  };
  sock.onmessage = (ev) => {
    if (ev.data === "pong") return;
    try {
      handleEvent(JSON.parse(String(ev.data)) as RealtimeEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  sock.onclose = () => {
    window.clearInterval(pingTimer);
    if (stopped) return;
    set({ connection: "offline" });
    const delay = Math.min(15_000, 500 * 2 ** reconnectAttempts++);
    wsTimer = window.setTimeout(connectSocket, delay);
  };
  sock.onerror = () => sock.close();
}

function handleEvent(ev: RealtimeEvent) {
  switch (ev.type) {
    case "message.new":
    case "message.state":
    case "message.deleted":
      scheduleSync();
      break;
    case "conversation.refresh":
      void refreshConversations();
      scheduleSync();
      break;
    case "typing": {
      const until = Date.now() + (ev.active ? 5000 : 0);
      set((s) => ({ typing: { ...s.typing, [ev.conversationId]: until } }));
      if (ev.active) {
        window.setTimeout(() => set((s) => ({ typing: { ...s.typing } })), 5100);
      }
      break;
    }
    case "wipe.completed":
      void useSession.getState().remoteWipe();
      break;
    case "session.revoked":
      useSession.getState().markReplaced();
      break;
  }
}

function scheduleSync() {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => void syncNow(), 120);
}

/* ================================================================== */
/* conversations + contacts                                            */
/* ================================================================== */

export async function refreshConversations() {
  const res = await api.get<{ conversations: ConversationDto[] }>("/conversations");
  set({ conversations: res.conversations });
}

export async function refreshContacts() {
  const res = await api.get<{ contacts: ContactDto[] }>("/contacts");
  set({ contacts: res.contacts });
}

export async function openChatWith(peerUserId: string): Promise<string> {
  const res = await api.post<{ conversation: ConversationDto }>("/conversations", {
    peerUserId,
  });
  const conv = res.conversation;
  set((s) => ({
    conversations: s.conversations.some((c) => c.id === conv.id)
      ? s.conversations.map((c) => (c.id === conv.id ? conv : c))
      : [conv, ...s.conversations],
  }));
  await refreshContacts();
  selectConversation(conv.id);
  return conv.id;
}

export function selectConversation(id: string | null) {
  set({ activeId: id });
  if (id) void markRead(id);
}

export async function setBlocked(peerUserId: string, blocked: boolean) {
  await api.post(`/contacts/${peerUserId}/block`, { blocked });
  await Promise.all([refreshConversations(), refreshContacts()]);
}

export async function removeContact(peerUserId: string) {
  await api.del(`/contacts/${peerUserId}`);
  await refreshContacts();
}

/** 60-digit number both people can compare out of band. */
export async function getSafetyNumber(conv: ConversationDto): Promise<string | null> {
  const peer = await vault().db.getPeer<{ identityKey: string; signingKey: string }>(
    conv.peer.userId,
  );
  const ik = peer?.identityKey ?? conv.peer.identityKey;
  const sk = peer?.signingKey ?? conv.peer.signingKey;
  if (!ik || !sk) return null;
  const keys = vault().keys;
  return safetyNumber(
    { identityKey: keys.identity.publicKey, signingKey: keys.signing.publicKey },
    { identityKey: fromBase64(ik), signingKey: fromBase64(sk) },
  );
}

/* ================================================================== */
/* sessions (Double Ratchet state per peer)                            */
/* ================================================================== */

async function loadSession(peerId: string): Promise<RatchetState | null> {
  return vault().db.getSession<RatchetState>(peerId);
}

async function storeSession(peerId: string, state: RatchetState) {
  await vault().db.putSession(peerId, state);
}

async function noteIdentity(
  peerId: string,
  convId: string | undefined,
  identityKey: string,
  signingKey: string,
) {
  const db = vault().db;
  const known = await db.getPeer<{ identityKey: string; signingKey: string }>(peerId);
  if (known && known.identityKey !== identityKey && convId) {
    const name = convFor(convId)?.peer.displayName ?? "this contact";
    await addSystem(
      convId,
      `${name}'s security code changed. This happens when they sign in on a new browser or clear their chats. Verify it if the conversation is sensitive.`,
    );
  }
  if (!known || known.identityKey !== identityKey) {
    await db.putPeer(peerId, { identityKey, signingKey });
  }
}

async function ensureOutboundSession(
  conv: ConversationDto,
  force: boolean,
): Promise<RatchetState> {
  const peerId = conv.peer.userId;
  const existing = await loadSession(peerId);
  if (existing && !force && existing.peerDeviceId === conv.peer.deviceId) return existing;

  let bundle: PeerBundle;
  try {
    bundle = await api.get<PeerBundle>(`/users/${peerId}/key-bundle`);
  } catch (e) {
    if (e instanceof ApiError && e.code === "PEER_NOT_READY") {
      throw new Error(`${conv.peer.displayName} hasn't finished setting up yet.`);
    }
    throw e;
  }
  await noteIdentity(peerId, conv.id, bundle.identityKey, bundle.signingKey);
  const { keys, deviceId } = vault();
  try {
    return initiateSession(keys, bundle, deviceId);
  } catch (e) {
    if (e instanceof CryptoError && e.code === "BAD_SIGNATURE") {
      throw new Error("Security check failed: the server returned invalid keys.");
    }
    throw e;
  }
}

/* ================================================================== */
/* sync (receive path)                                                 */
/* ================================================================== */

let syncing = false;
let syncAgain = false;

export async function syncNow(): Promise<void> {
  if (stopped) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    do {
      syncAgain = false;
      await syncPass();
    } while (syncAgain && !stopped);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 0) console.warn("sync failed");
  } finally {
    syncing = false;
  }
}

async function syncPass() {
  const db = vault().db;
  let cursor = (await db.getKv<{ ts: number; id: string }>("cursor")) ?? { ts: 0, id: "" };
  const newIncoming: LocalMessage[] = [];
  let needConversations = false;

  for (let page = 0; page < 50; page++) {
    const res = await api.get<{ messages: SyncMessage[]; hasMore: boolean }>(
      `/sync?ts=${cursor.ts}&id=${encodeURIComponent(cursor.id)}`,
    );
    for (const m of res.messages) {
      const created = await handleSyncMessage(m);
      if (created) newIncoming.push(created);
      if (!convFor(m.conversationId)) needConversations = true;
      cursor = { ts: m.updatedAt, id: m.id };
    }
    await db.setKv("cursor", cursor);
    if (!res.hasMore) break;
  }
  if (needConversations) await refreshConversations();
  if (newIncoming.length) await acknowledge(newIncoming);
}

async function handleSyncMessage(m: SyncMessage): Promise<LocalMessage | null> {
  const existing = localMessage(m.conversationId, m.id);

  if (m.direction === "out") {
    if (!existing || existing.deleted) return null;
    const next = m.state as LocalState;
    if (RANK[next] > RANK[existing.state]) {
      await saveAndShow({ ...existing, state: next });
    }
    return null;
  }

  if (m.deleted) {
    if (existing && !existing.deleted) {
      await saveAndShow({
        ...existing,
        deleted: true,
        unread: false,
        content: { v: 1, kind: "text", body: "" },
      });
    }
    return null;
  }
  if (existing) return null;
  if (!m.cryptoHeader || !m.ciphertext) return null;

  return withLock(`peer:${m.senderUserId}`, async () => {
    // Re-check inside the lock: another pass may have handled it already.
    if (localMessage(m.conversationId, m.id)) return null;
    const stored = await vault().db.getMessage(m.id);
    if (stored) return null;

    let content: MessageContent;
    try {
      const r = await ratchetDecrypt(
        await loadSession(m.senderUserId),
        vault().keys,
        { cryptoHeader: m.cryptoHeader!, ciphertext: m.ciphertext! },
      );
      await storeSession(m.senderUserId, r.state);
      if (r.keys !== vault().keys) await saveKeys(r.keys);
      if (r.sessionReset) {
        await noteIdentity(
          m.senderUserId,
          m.conversationId,
          r.state.peerIdentityKey,
          r.state.peerSigningKey,
        );
      }
      content = decodeEnvelope(r.plaintext) as MessageContent;
    } catch {
      content = { v: 1, kind: "undecryptable" };
    }

    const visible =
      get().activeId === m.conversationId &&
      document.visibilityState === "visible" &&
      document.hasFocus();
    const msg: LocalMessage = {
      id: m.id,
      convId: m.conversationId,
      senderId: m.senderUserId,
      direction: "in",
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
      state: "delivered",
      unread: !visible,
      content,
    };
    await saveAndShow(msg);
    return msg;
  });
}

async function acknowledge(msgs: LocalMessage[]) {
  const visible = msgs.filter((m) => !m.unread).map((m) => m.id);
  const rest = msgs.filter((m) => m.unread).map((m) => m.id);
  try {
    if (visible.length) await api.post("/messages/ack", { ids: visible, state: "read" });
    if (rest.length) await api.post("/messages/ack", { ids: rest, state: "delivered" });
  } catch {
    /* receipts are best effort; the next sync retries via unread state */
  }
}

export async function markRead(convId: string) {
  if (document.visibilityState !== "visible") return;
  const unread = (get().messages[convId] ?? []).filter((m) => m.unread);
  if (!unread.length) return;
  for (const m of unread) await saveAndShow({ ...m, unread: false });
  try {
    const ids = unread.filter((m) => !m.id.startsWith("sys_")).map((m) => m.id);
    for (let i = 0; i < ids.length; i += 100) {
      await api.post("/messages/ack", { ids: ids.slice(i, i + 100), state: "read" });
    }
  } catch {
    /* best effort */
  }
}

/* ================================================================== */
/* send path                                                           */
/* ================================================================== */

const pendingFiles = new Map<string, File>();

export interface SendInput {
  text: string;
  file?: File | null;
  replyTo?: LocalMessage | null;
}

function replyRefFor(m: LocalMessage): ReplyRef {
  let preview = "";
  const c = m.content;
  if (c.kind === "text") preview = c.body;
  else if (c.kind === "file") preview = c.body || c.attachment?.name || "Attachment";
  return {
    id: m.id,
    senderId: m.senderId,
    preview: preview.slice(0, 140),
  };
}

export async function sendMessage(convId: string, input: SendInput): Promise<void> {
  const text = input.text.trim();
  if (!text && !input.file) return;
  const conv = convFor(convId);
  if (!conv) return;
  if (conv.blocked) {
    toast("Unblock this contact to send messages.");
    return;
  }

  const id = newMessageId();
  const now = Date.now();
  const replyTo = input.replyTo ? replyRefFor(input.replyTo) : undefined;

  let content: MessageEnvelope;
  if (input.file) {
    const meta = await imageMeta(input.file);
    content = {
      v: 1,
      kind: "file",
      body: text,
      ...(replyTo ? { replyTo } : {}),
      attachment: {
        id: "",
        key: "",
        name: input.file.name || "file",
        mime: input.file.type || "application/octet-stream",
        size: input.file.size,
        ...(meta ?? {}),
      },
    };
    pendingFiles.set(id, input.file);
  } else {
    content = { v: 1, kind: "text", body: text, ...(replyTo ? { replyTo } : {}) };
  }

  const msg: LocalMessage = {
    id,
    convId,
    senderId: me(),
    direction: "out",
    createdAt: now,
    expiresAt: now + MESSAGE_TTL_MS,
    state: "sending",
    content,
  };
  set((s) => ({ replyTo: { ...s.replyTo, [convId]: null } }));
  await saveAndShow(msg);
  stopTyping(convId);
  await deliver(msg);
}

export async function retryMessage(convId: string, id: string) {
  const m = localMessage(convId, id);
  if (!m || m.state !== "failed") return;
  if (m.content.kind === "file" && m.content.attachment && !m.content.attachment.id && !pendingFiles.has(id)) {
    toast("This file can't be resent after a reload. Delete it and attach it again.");
    return;
  }
  const next = { ...m, state: "sending" as const };
  await saveAndShow(next);
  await deliver(next);
}

async function deliver(msg: LocalMessage) {
  const conv = convFor(msg.convId);
  if (!conv || (msg.content.kind !== "text" && msg.content.kind !== "file")) return;
  const content = msg.content as MessageEnvelope;

  const fail = async (reason: string) => {
    const cur = localMessage(msg.convId, msg.id) ?? msg;
    await saveAndShow({ ...cur, state: "failed" });
    toast(reason);
  };

  try {
    // 1. Encrypt + upload the file (once; survives retries).
    let attachmentId: string | undefined;
    if (content.kind === "file" && content.attachment) {
      if (!content.attachment.id) {
        const file = pendingFiles.get(msg.id);
        if (!file) return fail("The file is no longer available. Attach it again.");
        const plain = new Uint8Array(await file.arrayBuffer());
        const blob = await encryptBlob(plain);
        const up = await api.putBinary<{ attachmentId: string }>(
          `/conversations/${msg.convId}/attachments`,
          blob.ciphertext,
        );
        const att: AttachmentRef = {
          ...content.attachment,
          id: up.attachmentId,
          key: blob.key,
        };
        content.attachment = att;
        // The sender already has the plaintext: show it without re-downloading.
        attCache.set(att.id, Promise.resolve(URL.createObjectURL(file)));
        await saveAndShow({ ...msg, content: { ...content } });
      }
      attachmentId = content.attachment.id;
    }

    // 2. Encrypt + post, one at a time per peer.
    const result = await withLock(`peer:${conv.peer.userId}`, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const liveConv = convFor(msg.convId) ?? conv;
        const state = await ensureOutboundSession(liveConv, attempt > 0);
        const enc = await ratchetEncrypt(state, encodeEnvelope(content));
        try {
          const res = await api.post<{ createdAt: number; expiresAt: number }>(
            `/conversations/${msg.convId}/messages`,
            {
              messageId: msg.id,
              senderDeviceId: vault().deviceId,
              recipientDeviceId: state.peerDeviceId,
              cryptoHeader: enc.message.cryptoHeader,
              ciphertext: enc.message.ciphertext,
              attachmentId,
            },
          );
          await storeSession(conv.peer.userId, enc.state);
          return res;
        } catch (e) {
          if (e instanceof ApiError && e.code === "DEVICE_CHANGED" && attempt === 0) {
            await refreshConversations();
            continue;
          }
          throw e;
        }
      }
      throw new Error("Could not establish a secure session.");
    });

    const cur = localMessage(msg.convId, msg.id) ?? msg;
    await saveAndShow({
      ...cur,
      content: { ...content },
      createdAt: result.createdAt,
      expiresAt: result.expiresAt,
      state: RANK[cur.state] > RANK.accepted ? cur.state : "accepted",
    });
    pendingFiles.delete(msg.id);
    void refreshConversations();
  } catch (e) {
    if (e instanceof ApiError && e.code === "PEER_NOT_READY") {
      return fail(`${conv.peer.displayName} hasn't finished setting up yet.`);
    }
    if (e instanceof ApiError && e.code === "DEVICE_INVALID") {
      useSession.getState().markReplaced();
      return;
    }
    return fail(e instanceof Error ? e.message : "Message failed to send");
  }
}

/* ---------------- delete ---------------- */

export async function deleteForMe(convId: string, id: string) {
  await vault().db.deleteMessage(id);
  set((s) => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] ?? []).filter((m) => m.id !== id),
    },
  }));
  pendingFiles.delete(id);
}

export async function deleteForEveryone(convId: string, id: string) {
  const m = localMessage(convId, id);
  if (!m || m.direction !== "out") return;
  if (m.state !== "failed" && m.state !== "sending") {
    await api.del(`/messages/${id}`);
  }
  await saveAndShow({
    ...m,
    deleted: true,
    content: { v: 1, kind: "text", body: "" },
  });
}

/* ---------------- reply / typing ---------------- */

export function setReplyTo(convId: string, m: LocalMessage | null) {
  set((s) => ({ replyTo: { ...s.replyTo, [convId]: m } }));
}

const typingSent = new Map<string, number>();
const typingTimers = new Map<string, number>();

export function typingPing(convId: string) {
  const now = Date.now();
  if (now - (typingSent.get(convId) ?? 0) > 3000) {
    typingSent.set(convId, now);
    void api.post(`/conversations/${convId}/typing`, { active: true }).catch(() => {});
  }
  window.clearTimeout(typingTimers.get(convId));
  typingTimers.set(
    convId,
    window.setTimeout(() => stopTyping(convId), 4000),
  );
}

export function stopTyping(convId: string) {
  window.clearTimeout(typingTimers.get(convId));
  typingTimers.delete(convId);
  if (typingSent.has(convId)) {
    typingSent.delete(convId);
    void api.post(`/conversations/${convId}/typing`, { active: false }).catch(() => {});
  }
}

/* ================================================================== */
/* attachments                                                         */
/* ================================================================== */

const attCache = new Map<string, Promise<string>>();

/** Fetch ciphertext, decrypt in the browser, hand back an object URL. */
export function loadAttachment(att: AttachmentRef): Promise<string> {
  const hit = attCache.get(att.id);
  if (hit) return hit;
  const p = (async () => {
    const cipher = await api.getBinary(`/attachments/${att.id}`);
    const plain = await decryptBlob(cipher, att.key);
    const type = mediaKind(att.mime) === "file" ? "application/octet-stream" : att.mime;
    return URL.createObjectURL(new Blob([plain as unknown as BlobPart], { type }));
  })();
  attCache.set(att.id, p);
  p.catch(() => attCache.delete(att.id));
  return p;
}

export async function downloadAttachment(att: AttachmentRef) {
  const url = await loadAttachment(att);
  const a = document.createElement("a");
  a.href = url;
  a.download = att.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ================================================================== */
/* expiry                                                              */
/* ================================================================== */

async function pruneExpired() {
  if (stopped) return;
  const now = Date.now();
  const ids = new Set(await vault().db.pruneExpired(now));
  set((s) => {
    const next: Record<string, LocalMessage[]> = {};
    let changed = ids.size > 0;
    for (const [k, list] of Object.entries(s.messages)) {
      const kept = list.filter((m) => m.expiresAt > now);
      if (kept.length !== list.length) changed = true;
      next[k] = kept;
    }
    return changed ? { messages: next } : {};
  });
}
