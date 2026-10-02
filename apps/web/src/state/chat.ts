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
} from "@tetris/crypto";
import {
  EDIT_BODY_MAX,
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  decodeEnvelope,
  encodeEnvelope,
  type AttachmentRef,
  type MessageEnvelope,
  type ReplyRef,
} from "@tetris/protocol";
import { EDIT_WINDOW_MS, GROUP_MESSAGE_TTL_MS, MESSAGE_TTL_MS } from "@tetris/config";
import type {
  ContactDto,
  ConversationDto,
  ConversationPeer,
  GroupCopy,
  RealtimeEvent,
  SyncMessage,
} from "@tetris/types";
import { api, ApiError, getVaultToken } from "@/lib/api";
import { newMessageId } from "@/lib/format";
import { imageMeta, mediaKind, mimeOf } from "@/lib/media";
import { armIncomingSounds, disarmIncomingSounds, playIncomingTone } from "@/lib/notify";
import type { LocalMessage, LocalState, MessageContent } from "./localdb";
import { saveKeys, vault } from "./vault";
import { useSession } from "./session";

function attachmentBlob(plain: Uint8Array, att: Pick<AttachmentRef, "mime" | "name">): Blob {
  // Always derive a real MIME from the name when the stored one is blank or
  // generic — an empty type makes some browsers refuse to paint <img>/<video>.
  const kind = mediaKind(att.mime, att.name);
  const type = kind === "file" ? "application/octet-stream" : mimeOf({ type: att.mime, name: att.name });
  // Copy so we never hand a view into a detached ArrayBuffer to Blob().
  return new Blob([plain.slice()], { type });
}

async function objectUrlFor(plain: Uint8Array, att: AttachmentRef): Promise<string> {
  const blob = attachmentBlob(plain, att);
  const url = URL.createObjectURL(blob);
  if (mediaKind(att.mime, att.name) === "image") {
    try {
      // Prove the bytes actually decode as an image before we cache the URL.
      const img = new Image();
      img.src = url;
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("Decoded attachment is not a valid image");
    }
  }
  return url;
}

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
  /** The message currently being edited in each conversation's composer. */
  editing: Record<string, LocalMessage | null>;
  /** Private, device-local nicknames: peer userId → name. Never sent anywhere. */
  nicknames: Record<string, string>;
  /** Device-local: conversation id → true when muted. */
  muted: Record<string, boolean>;
  /** Device-local: conversation id → pinned-at ms. */
  pinned: Record<string, number>;
  /** Device-local: conversation id → unsent draft text. */
  drafts: Record<string, string>;
  /** Device-local: message id → true when starred. */
  starred: Record<string, boolean>;
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
  editing: {},
  nicknames: {},
  muted: {},
  pinned: {},
  drafts: {},
  starred: {},
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

/** Group messages live a week, direct messages a day. */
function ttlFor(conv: ConversationDto | undefined): number {
  return conv?.group ? GROUP_MESSAGE_TTL_MS : MESSAGE_TTL_MS;
}

/** Take several locks in a fixed order, so two group sends can never deadlock. */
function withLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const [first, ...rest] = [...new Set(keys)].sort();
  if (first === undefined) return fn();
  return withLock(first, () => withLocks(rest, fn));
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
  const nicknames = (await db.getKv<Record<string, string>>("nicknames")) ?? {};
  const muted = (await db.getKv<Record<string, boolean>>("muted")) ?? {};
  const pinned = (await db.getKv<Record<string, number>>("pinned")) ?? {};
  const drafts = (await db.getKv<Record<string, string>>("drafts")) ?? {};
  const starred = (await db.getKv<Record<string, boolean>>("starred")) ?? {};
  set({
    messages: grouped,
    nicknames,
    muted,
    pinned,
    drafts,
    starred,
    ready: false,
    connection: "connecting",
  });

  await refreshConversations();
  await refreshContacts();
  set({ ready: true });

  await syncNow();
  // History catch-up above stays silent; live messages from here on can chime.
  armIncomingSounds();
  connectSocket();
  pollTimer = window.setInterval(() => void syncNow(), 60_000);
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
  for (const url of attUrls.values()) URL.revokeObjectURL(url);
  attUrls.clear();
  attCache.clear();
  pendingFiles.clear();
  disarmIncomingSounds();
  set({
    ready: false,
    connection: "connecting",
    conversations: [],
    contacts: [],
    messages: {},
    activeId: null,
    typing: {},
    replyTo: {},
    editing: {},
    nicknames: {},
    muted: {},
    pinned: {},
    drafts: {},
    starred: {},
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
    const target = convFor(convId);
    const name =
      target?.group?.members.find((x) => x.userId === peerId)?.displayName ??
      target?.peer.displayName ??
      "this contact";
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
  if (newIncoming.length) {
    await acknowledge(newIncoming);
    const audible = newIncoming.some(
      (m) =>
        !get().muted[m.convId] &&
        (m.content.kind === "text" ||
          m.content.kind === "file" ||
          m.content.kind === "poll" ||
          m.content.kind === "undecryptable"),
    );
    if (audible) playIncomingTone();
  }
}

async function handleSyncMessage(m: SyncMessage): Promise<LocalMessage | null> {
  // Group messages arrive as one encrypted copy per member; they all share messageId.
  const existing = localMessage(m.conversationId, m.messageId);

  if (m.direction === "out") {
    if (!existing || existing.deleted) return null;
    const next = m.state as LocalState;
    const advanced = RANK[next] > RANK[existing.state];
    const deliveredAt = m.deliveredAt ?? existing.deliveredAt;
    const readAt = m.readAt ?? existing.readAt;
    if (advanced || deliveredAt !== existing.deliveredAt || readAt !== existing.readAt) {
      await saveAndShow({
        ...existing,
        state: advanced ? next : existing.state,
        ...(deliveredAt ? { deliveredAt } : {}),
        ...(readAt ? { readAt } : {}),
      });
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
    if (localMessage(m.conversationId, m.messageId)) return null;
    const stored = await vault().db.getMessage(m.messageId);
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
      id: m.messageId,
      rowId: m.id,
      convId: m.conversationId,
      senderId: m.senderUserId,
      direction: "in",
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
      state: "delivered",
      unread: !visible && content.kind !== "reaction" && content.kind !== "vote" && content.kind !== "edit",
      content,
    };
    await saveAndShow(msg);
    if (content.kind === "reaction" && content.reaction) {
      await applyReaction(m.conversationId, content.reaction.target, m.senderUserId, content.reaction.emoji);
    }
    if (content.kind === "edit" && content.edit) {
      await applyEdit(m.conversationId, content.edit.target, m.senderUserId, content.body, m.createdAt);
    }
    if (content.kind === "vote" && content.vote) {
      await applyVote(m.conversationId, content.vote.target, m.senderUserId, content.vote.choices);
    }
    return msg;
  });
}

async function acknowledge(msgs: LocalMessage[]) {
  const visible = msgs.filter((m) => !m.unread).map((m) => m.rowId ?? m.id);
  const rest = msgs.filter((m) => m.unread).map((m) => m.rowId ?? m.id);
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
    const ids = unread.filter((m) => !m.id.startsWith("sys_")).map((m) => m.rowId ?? m.id);
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
  /** The file is a recorded voice message of this length. */
  voiceMs?: number;
  /** Mark the outgoing envelope as a forward. */
  forwarded?: boolean;
}

function replyRefFor(m: LocalMessage): ReplyRef {
  let preview = "";
  const c = m.content;
  if (c.kind === "text") preview = c.body;
  else if (c.kind === "file") {
    preview = c.body || (c.attachment?.voice ? "Voice message" : c.attachment?.name) || "Attachment";
  } else if (c.kind === "poll") preview = `Poll: ${c.poll?.question ?? ""}`;
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
      ...(input.forwarded ? { forwarded: true } : {}),
      attachment: {
        id: "",
        key: "",
        name: input.file.name || "file",
        mime: mimeOf({ type: input.file.type, name: input.file.name || "" }),
        size: input.file.size,
        ...(meta ?? {}),
        ...(input.voiceMs ? { voice: true, durationMs: Math.round(input.voiceMs) } : {}),
      },
    };
    pendingFiles.set(id, input.file);
  } else {
    content = {
      v: 1,
      kind: "text",
      body: text,
      ...(replyTo ? { replyTo } : {}),
      ...(input.forwarded ? { forwarded: true } : {}),
    };
  }

  const msg: LocalMessage = {
    id,
    convId,
    senderId: me(),
    direction: "out",
    createdAt: now,
    expiresAt: now + ttlFor(conv),
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

/**
 * Group fan-out: one pairwise Double Ratchet envelope per member device, all
 * posted in a single request. Sessions only advance once the server accepts.
 */
async function sendToGroup(
  conv: ConversationDto,
  messageId: string,
  content: MessageEnvelope,
  attachmentId: string | undefined,
): Promise<{ createdAt: number; expiresAt: number }> {
  let forceUser: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const live = convFor(conv.id) ?? conv;
    const others: ConversationPeer[] = (live.group?.members ?? []).filter(
      (m) => m.userId !== me() && m.deviceId,
    );
    if (others.length === 0) {
      throw new Error("Nobody else in this group has signed in yet.");
    }
    const result = await withLocks(others.map((m) => `peer:${m.userId}`), async () => {
      const copies: GroupCopy[] = [];
      const advanced: Array<[string, RatchetState]> = [];
      for (const member of others) {
        const state = await ensureOutboundSession(
          { ...live, peer: member },
          forceUser === member.userId,
        );
        const enc = await ratchetEncrypt(state, encodeEnvelope(content));
        copies.push({
          recipientUserId: member.userId,
          recipientDeviceId: state.peerDeviceId,
          cryptoHeader: enc.message.cryptoHeader,
          ciphertext: enc.message.ciphertext,
        });
        advanced.push([member.userId, enc.state]);
      }
      try {
        const res = await api.post<{ createdAt: number; expiresAt: number }>(
          `/conversations/${conv.id}/group-messages`,
          { messageId, senderDeviceId: vault().deviceId, copies, attachmentId },
        );
        for (const [userId, st] of advanced) await storeSession(userId, st);
        return res;
      } catch (e) {
        if (e instanceof ApiError && (e.code === "DEVICE_CHANGED" || e.code === "PEER_NOT_READY")) {
          forceUser = typeof e.data?.userId === "string" ? e.data.userId : null;
          return null;
        }
        throw e;
      }
    });
    if (result) return result;
    await refreshConversations();
  }
  throw new Error("Could not establish secure sessions with the group.");
}

async function deliver(msg: LocalMessage) {
  const conv = convFor(msg.convId);
  if (!conv || msg.content.kind === "system" || msg.content.kind === "undecryptable") return;
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
        // Build the blob from the bytes in memory (not the picker's File, whose
        // handle can go stale) so the sender's own copy always renders.
        const url = await objectUrlFor(plain, att);
        attUrls.set(att.id, url);
        attCache.set(att.id, Promise.resolve(url));
        await saveAndShow({ ...msg, content: { ...content } });
      }
      attachmentId = content.attachment.id;
    }

    // 2. Encrypt + post. A group message is sealed separately for every member.
    const result = conv.group
      ? await sendToGroup(conv, msg.id, content, attachmentId)
      : await withLock(`peer:${conv.peer.userId}`, async () => {
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

/** Remove every message of a conversation from this device only. */
export async function clearChat(convId: string) {
  const list = get().messages[convId] ?? [];
  for (const m of list) {
    await vault().db.deleteMessage(m.id);
    pendingFiles.delete(m.id);
  }
  set((s) => ({
    messages: { ...s.messages, [convId]: [] },
    replyTo: { ...s.replyTo, [convId]: null },
  }));
}

/* ---------------- reactions ---------------- */

async function applyReaction(
  convId: string,
  targetId: string,
  userId: string,
  emoji: string | null,
) {
  const target = localMessage(convId, targetId);
  if (!target || target.deleted) return;
  if (!isVisibleKind(target.content.kind)) return;
  const reactions = { ...(target.reactions ?? {}) };
  if (emoji) reactions[userId] = emoji;
  else delete reactions[userId];
  const { reactions: _old, ...rest } = target;
  await saveAndShow(Object.keys(reactions).length ? { ...rest, reactions } : rest);
}

/** Tapping the reaction you already gave removes it, like WhatsApp. */
export async function sendReaction(convId: string, targetId: string, emoji: string) {
  const conv = convFor(convId);
  const target = localMessage(convId, targetId);
  if (!conv || !target || target.deleted) return;
  const next = target.reactions?.[me()] === emoji ? null : emoji;
  const now = Date.now();
  await applyReaction(convId, targetId, me(), next);
  const msg: LocalMessage = {
    id: newMessageId(),
    convId,
    senderId: me(),
    direction: "out",
    createdAt: now,
    // Reactions die with the message they belong to.
    expiresAt: Math.max(target.expiresAt, now + 60_000),
    state: "sending",
    content: { v: 1, kind: "reaction", body: "", reaction: { target: targetId, emoji: next } },
  };
  await saveAndShow(msg);
  await deliver(msg);
}

/** Kinds that show up as a bubble (reactions and votes are invisible carriers). */
function isVisibleKind(kind: string) {
  // (edits, like reactions and votes, are invisible carriers)
  return kind === "text" || kind === "file" || kind === "poll";
}

/* ---------------- editing ---------------- */

/** Slack for clock/network skew between the two timestamps we compare. */
const EDIT_SLACK_MS = 15_000;

/** Can the author still edit this message right now? */
export function canEditMessage(m: LocalMessage, now = Date.now()): boolean {
  if (m.direction !== "out" || m.deleted) return false;
  if (m.state === "sending" || m.state === "failed") return false;
  const c = m.content;
  const editable = c.kind === "text" || (c.kind === "file" && Boolean(c.body));
  return editable && now - m.createdAt < EDIT_WINDOW_MS;
}

export function setEditing(convId: string, m: LocalMessage | null) {
  set((s) => ({
    editing: { ...s.editing, [convId]: m },
    // Editing and replying are mutually exclusive in the composer.
    replyTo: m ? { ...s.replyTo, [convId]: null } : s.replyTo,
  }));
}

/**
 * Apply an edit. `at` is the server time the edit was accepted, so both people
 * judge the 10-minute window against the same server clock, not the sender's.
 */
async function applyEdit(convId: string, targetId: string, authorId: string, body: string, at: number) {
  const target = localMessage(convId, targetId);
  if (!target || target.deleted || target.senderId !== authorId) return;
  const c = target.content;
  if (c.kind !== "text" && c.kind !== "file") return;
  if (c.kind === "text" && !body.trim()) return;
  if (at - target.createdAt > EDIT_WINDOW_MS + EDIT_SLACK_MS) return;
  if (target.editedAt && at <= target.editedAt) return;
  await saveAndShow({ ...target, editedAt: at, content: { ...c, body } });
}

export async function sendEdit(convId: string, targetId: string, text: string) {
  const conv = convFor(convId);
  const target = localMessage(convId, targetId);
  const body = text.trim();
  setEditing(convId, null);
  if (!conv || !target) return;
  if (!canEditMessage(target)) {
    toast("You can only edit a message for 10 minutes after sending it.");
    return;
  }
  const c = target.content;
  if (c.kind !== "text" && c.kind !== "file") return;
  if (!body && c.kind === "text") return;
  if (body === c.body) return;
  if (body.length > EDIT_BODY_MAX) {
    toast("That message is too long.");
    return;
  }
  const now = Date.now();
  await applyEdit(convId, targetId, me(), body, now);
  const msg: LocalMessage = {
    id: newMessageId(),
    convId,
    senderId: me(),
    direction: "out",
    createdAt: now,
    // An edit disappears with the message it changes.
    expiresAt: Math.max(target.expiresAt, now + 60_000),
    state: "sending",
    content: { v: 1, kind: "edit", body, edit: { target: targetId } },
  };
  await saveAndShow(msg);
  await deliver(msg);
}

/* ---------------- polls ---------------- */

async function applyVote(convId: string, targetId: string, userId: string, choices: number[]) {
  const target = localMessage(convId, targetId);
  if (!target || target.deleted || target.content.kind !== "poll" || !target.content.poll) return;
  const { options, multi } = target.content.poll;
  const clean = [...new Set(choices)].filter((n) => n >= 0 && n < options.length).sort((a, b) => a - b);
  const limited = multi ? clean : clean.slice(0, 1);
  const votes = { ...(target.votes ?? {}) };
  if (limited.length) votes[userId] = limited;
  else delete votes[userId];
  const { votes: _old, ...rest } = target;
  await saveAndShow(Object.keys(votes).length ? { ...rest, votes } : rest);
}

export interface PollInput {
  question: string;
  options: string[];
  multi: boolean;
  forwarded?: boolean;
}

export async function sendPoll(convId: string, input: PollInput) {
  const conv = convFor(convId);
  if (!conv) return;
  const question = input.question.trim().slice(0, POLL_QUESTION_MAX);
  const options = input.options.map((o) => o.trim().slice(0, POLL_OPTION_MAX)).filter(Boolean);
  if (!question || options.length < 2 || options.length > POLL_MAX_OPTIONS) return;
  const now = Date.now();
  const msg: LocalMessage = {
    id: newMessageId(),
    convId,
    senderId: me(),
    direction: "out",
    createdAt: now,
    expiresAt: now + ttlFor(conv),
    state: "sending",
    content: {
      v: 1,
      kind: "poll",
      body: question,
      poll: { question, options, multi: input.multi },
      ...(input.forwarded ? { forwarded: true } : {}),
    },
  };
  await saveAndShow(msg);
  await deliver(msg);
}

/** Set (or retract, with an empty list) your vote on a poll. */
export async function sendVote(convId: string, targetId: string, choices: number[]) {
  const conv = convFor(convId);
  const target = localMessage(convId, targetId);
  if (!conv || !target || target.deleted || target.content.kind !== "poll") return;
  const now = Date.now();
  await applyVote(convId, targetId, me(), choices);
  const mine = localMessage(convId, targetId)?.votes?.[me()] ?? [];
  const msg: LocalMessage = {
    id: newMessageId(),
    convId,
    senderId: me(),
    direction: "out",
    createdAt: now,
    // A vote dies with its poll.
    expiresAt: Math.max(target.expiresAt, now + 60_000),
    state: "sending",
    content: { v: 1, kind: "vote", body: "", vote: { target: targetId, choices: mine } },
  };
  await saveAndShow(msg);
  await deliver(msg);
}

/* ---------------- nicknames + local prefs ---------------- */

export async function setNickname(peerUserId: string, nickname: string) {
  const name = nickname.trim().slice(0, 40);
  const next = { ...get().nicknames };
  if (name) next[peerUserId] = name;
  else delete next[peerUserId];
  set({ nicknames: next });
  await vault().db.setKv("nicknames", next);
}

/** What to call someone: your private nickname, else their profile name. */
export function nameOf(
  nicknames: Record<string, string>,
  peer: { userId: string; displayName: string },
): string {
  return nicknames[peer.userId] || peer.displayName;
}

export async function setMuted(convId: string, muted: boolean) {
  const next = { ...get().muted };
  if (muted) next[convId] = true;
  else delete next[convId];
  set({ muted: next });
  await vault().db.setKv("muted", next);
}

export async function setPinned(convId: string, pinned: boolean) {
  const next = { ...get().pinned };
  if (pinned) next[convId] = Date.now();
  else delete next[convId];
  set({ pinned: next });
  await vault().db.setKv("pinned", next);
}

export async function setDraft(convId: string, text: string) {
  const next = { ...get().drafts };
  if (text) next[convId] = text;
  else delete next[convId];
  set({ drafts: next });
  await vault().db.setKv("drafts", next);
}

export async function setStarred(messageId: string, starred: boolean) {
  const next = { ...get().starred };
  if (starred) next[messageId] = true;
  else delete next[messageId];
  set({ starred: next });
  await vault().db.setKv("starred", next);
}

/** Forward a visible message into another conversation (re-encrypts for the peer). */
export async function forwardMessage(targetConvId: string, source: LocalMessage) {
  if (source.deleted) return;
  const c = source.content;
  if (c.kind === "text") {
    await sendMessage(targetConvId, { text: c.body, forwarded: true });
    return;
  }
  if (c.kind === "file" && c.attachment) {
    const url = await loadAttachment(c.attachment);
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], c.attachment.name || "attachment", {
      type: c.attachment.mime || blob.type || "application/octet-stream",
    });
    await sendMessage(targetConvId, {
      text: c.body || "",
      file,
      voiceMs: c.attachment.voice ? c.attachment.durationMs : undefined,
      forwarded: true,
    });
    return;
  }
  if (c.kind === "poll" && c.poll) {
    await sendPoll(targetConvId, {
      question: c.poll.question,
      options: [...c.poll.options],
      multi: c.poll.multi,
      forwarded: true,
    });
    return;
  }
  toast("That message can't be forwarded.");
}

export function messageSearchText(m: LocalMessage): string {
  if (m.deleted) return "";
  const c = m.content;
  if (c.kind === "text") return c.body;
  if (c.kind === "file") return `${c.body} ${c.attachment?.name ?? ""}`;
  if (c.kind === "poll") return `${c.poll?.question ?? ""} ${(c.poll?.options ?? []).join(" ")}`;
  if (c.kind === "system") return c.text;
  return "";
}

export function exportChatText(
  convId: string,
  peerLabel: string,
  nicknames: Record<string, string>,
): string {
  const list = get().messages[convId] ?? [];
  const myId = me();
  const lines = [
    `Tetris chat export — ${peerLabel}`,
    `Exported ${new Date().toISOString()}`,
    "",
  ];
  for (const m of list) {
    if (cKindHidden(m)) continue;
    const who =
      m.direction === "out" || m.senderId === myId
        ? "You"
        : nicknames[m.senderId] || m.senderId;
    const body = m.deleted ? "[deleted]" : messageSearchText(m) || `[${m.content.kind}]`;
    lines.push(`[${new Date(m.createdAt).toISOString()}] ${who}: ${body}`);
  }
  return lines.join("\n");
}

function cKindHidden(m: LocalMessage) {
  const k = m.content.kind;
  return k === "reaction" || k === "vote" || k === "edit";
}

/* ---------------- reply / typing ---------------- */

export function setReplyTo(convId: string, m: LocalMessage | null) {
  set((s) => ({ replyTo: { ...s.replyTo, [convId]: m } }));
}

const typingSent = new Map<string, number>();
const typingTimers = new Map<string, number>();
let typingChain: Promise<void> = Promise.resolve();

export function typingPing(convId: string) {
  if (convFor(convId)?.group) return; // no typing indicators in groups
  const now = Date.now();
  if (now - (typingSent.get(convId) ?? 0) > 3000) {
    typingSent.set(convId, now);
    typingChain = typingChain
      .then(() => api.post(`/conversations/${convId}/typing`, { active: true }))
      .then(() => {}, () => {});
  }
  window.clearTimeout(typingTimers.get(convId));
  typingTimers.set(
    convId,
    window.setTimeout(() => stopTyping(convId), 4000),
  );
}

export function stopTyping(convId: string) {
  if (convFor(convId)?.group) return;
  window.clearTimeout(typingTimers.get(convId));
  typingTimers.delete(convId);
  if (typingSent.has(convId)) {
    typingSent.delete(convId);
    // Chain after any in-flight ping so "stopped" can't be overtaken by "typing".
    typingChain = typingChain
      .then(() => api.post(`/conversations/${convId}/typing`, { active: false }))
      .then(() => {}, () => {});
  }
}

/* ================================================================== */
/* attachments                                                         */
/* ================================================================== */

const attCache = new Map<string, Promise<string>>();
/** Live object URLs, so we can revoke them when a cached copy turns out bad. */
const attUrls = new Map<string, string>();

/** Forget a cached object URL so the next load re-fetches from the server. */
export function evictAttachment(id: string) {
  attCache.delete(id);
  const url = attUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    attUrls.delete(id);
  }
}

/** Fetch ciphertext, decrypt in the browser, hand back an object URL. */
export function loadAttachment(att: AttachmentRef): Promise<string> {
  if (!att.id || !att.key) return Promise.reject(new Error("Missing attachment"));
  const hit = attCache.get(att.id);
  if (hit) return hit;
  const p = (async () => {
    const cipher = await api.getBinary(`/attachments/${att.id}`);
    const plain = await decryptBlob(cipher, att.key);
    const url = await objectUrlFor(plain, att);
    attUrls.set(att.id, url);
    return url;
  })();
  attCache.set(att.id, p);
  p.catch(() => {
    attCache.delete(att.id);
  });
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

