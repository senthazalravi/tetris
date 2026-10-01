import { aeadOpen, aeadSeal, openJson, sealJson } from "@lop/crypto";
import type { MessageEnvelope } from "@lop/protocol";

/**
 * Everything persisted on this device is sealed with the vault key (AES-256-GCM)
 * before it touches IndexedDB. Only ids/timestamps stay in the clear so the
 * database can be indexed and pruned; the server already knows those.
 */

export type MessageContent =
  | MessageEnvelope
  | { v: 1; kind: "system"; text: string }
  | { v: 1; kind: "undecryptable" };

export type LocalState = "sending" | "failed" | "accepted" | "delivered" | "read";

export interface LocalMessage {
  id: string;
  convId: string;
  senderId: string;
  direction: "in" | "out";
  createdAt: number;
  expiresAt: number;
  state: LocalState;
  deleted?: boolean;
  /** Incoming message we have not yet sent a "read" receipt for. */
  unread?: boolean;
  /** userId → emoji. Only ever set on visible (text/file) messages. */
  reactions?: Record<string, string>;
  /** When the author last edited this message (server-clocked). Shown as "Edited". */
  editedAt?: number;
  /** userId → chosen option indexes. Only ever set on poll messages. */
  votes?: Record<string, number[]>;
  /** Outgoing: when the recipient's device received / read it (from the server). */
  deliveredAt?: number;
  readAt?: number;
  content: MessageContent;
}

interface Row {
  id: string;
  convId: string;
  createdAt: number;
  expiresAt: number;
  blob: Uint8Array;
}

const STORES = ["meta", "kv", "sessions", "peers", "messages"] as const;
const VERSION = 1;

export function dbNameFor(userId: string) {
  return `lop-vault-${userId}`;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openRaw(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        if (s === "messages") {
          const store = db.createObjectStore("messages", { keyPath: "id" });
          store.createIndex("byConv", ["convId", "createdAt"]);
          store.createIndex("byExpiry", "expiresAt");
        } else {
          db.createObjectStore(s);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    // Another tab still has it open; it closes on its own wipe broadcast.
    req.onblocked = () => resolve();
  });
}

/** Read the plaintext epoch marker without any key. */
export async function readStoredEpoch(userId: string): Promise<number | null> {
  const name = dbNameFor(userId);
  const dbs = (await indexedDB.databases?.()) ?? [];
  if (dbs.length && !dbs.some((d) => d.name === name)) return null;
  const db = await openRaw(name);
  try {
    const v = await wrap(db.transaction("meta").objectStore("meta").get("epoch"));
    return typeof v === "number" ? v : null;
  } finally {
    db.close();
  }
}

export class LocalDb {
  private constructor(
    private db: IDBDatabase,
    private key: CryptoKey,
    readonly userId: string,
  ) {}

  static async open(userId: string, key: CryptoKey, epoch: number): Promise<LocalDb> {
    const db = await openRaw(dbNameFor(userId));
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(epoch, "epoch");
    await txDone(tx);
    return new LocalDb(db, key, userId);
  }

  close() {
    this.db.close();
  }

  /* ---- sealed key/value ---- */

  async getKv<T>(name: string): Promise<T | null> {
    const blob = await wrap<Uint8Array | undefined>(
      this.db.transaction("kv").objectStore("kv").get(name),
    );
    if (!blob) return null;
    try {
      return await openJson<T>(this.key, blob);
    } catch {
      return null;
    }
  }

  async setKv(name: string, value: unknown): Promise<void> {
    const blob = await sealJson(this.key, value);
    const tx = this.db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(blob, name);
    await txDone(tx);
  }

  async getSession<T>(peerId: string): Promise<T | null> {
    const blob = await wrap<Uint8Array | undefined>(
      this.db.transaction("sessions").objectStore("sessions").get(peerId),
    );
    if (!blob) return null;
    try {
      return await openJson<T>(this.key, blob);
    } catch {
      return null;
    }
  }

  async putSession(peerId: string, state: unknown): Promise<void> {
    const blob = await sealJson(this.key, state);
    const tx = this.db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put(blob, peerId);
    await txDone(tx);
  }

  async getPeer<T>(peerId: string): Promise<T | null> {
    const blob = await wrap<Uint8Array | undefined>(
      this.db.transaction("peers").objectStore("peers").get(peerId),
    );
    if (!blob) return null;
    try {
      return await openJson<T>(this.key, blob);
    } catch {
      return null;
    }
  }

  async putPeer(peerId: string, value: unknown): Promise<void> {
    const blob = await sealJson(this.key, value);
    const tx = this.db.transaction("peers", "readwrite");
    tx.objectStore("peers").put(blob, peerId);
    await txDone(tx);
  }

  /* ---- messages ---- */

  async putMessage(m: LocalMessage): Promise<void> {
    const { id, convId, createdAt, expiresAt, ...rest } = m;
    const row: Row = {
      id,
      convId,
      createdAt,
      expiresAt,
      blob: await aeadSeal(this.key, new TextEncoder().encode(JSON.stringify(rest))),
    };
    const tx = this.db.transaction("messages", "readwrite");
    tx.objectStore("messages").put(row);
    await txDone(tx);
  }

  private async decodeRow(row: Row): Promise<LocalMessage | null> {
    try {
      const rest = JSON.parse(
        new TextDecoder().decode(await aeadOpen(this.key, row.blob)),
      ) as Omit<LocalMessage, "id" | "convId" | "createdAt" | "expiresAt">;
      return {
        id: row.id,
        convId: row.convId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        ...rest,
      };
    } catch {
      return null;
    }
  }

  async getMessage(id: string): Promise<LocalMessage | null> {
    const row = await wrap<Row | undefined>(
      this.db.transaction("messages").objectStore("messages").get(id),
    );
    return row ? this.decodeRow(row) : null;
  }

  async allMessages(now: number): Promise<LocalMessage[]> {
    const rows = await wrap<Row[]>(
      this.db.transaction("messages").objectStore("messages").getAll(),
    );
    const out: LocalMessage[] = [];
    for (const row of rows) {
      if (row.expiresAt <= now) continue;
      const m = await this.decodeRow(row);
      if (m) out.push(m);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  async deleteMessage(id: string): Promise<void> {
    const tx = this.db.transaction("messages", "readwrite");
    tx.objectStore("messages").delete(id);
    await txDone(tx);
  }

  /** Remove everything past its 24h lifetime; returns the deleted ids. */
  async pruneExpired(now: number): Promise<string[]> {
    const tx = this.db.transaction("messages", "readwrite");
    const idx = tx.objectStore("messages").index("byExpiry");
    const ids: string[] = [];
    const cursorReq = idx.openCursor(IDBKeyRange.upperBound(now));
    await new Promise<void>((resolve, reject) => {
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur) return resolve();
        ids.push((cur.value as Row).id);
        cur.delete();
        cur.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    await txDone(tx);
    return ids;
  }

  /**
   * Re-seal every encrypted blob under a new vault key (passcode change).
   * Plaintext indexes on messages stay as they are.
   */
  async rekey(newKey: CryptoKey): Promise<void> {
    const old = this.key;

    const kvKeys = await wrap<IDBValidKey[]>(
      this.db.transaction("kv").objectStore("kv").getAllKeys(),
    );
    for (const k of kvKeys) {
      const blob = await wrap<Uint8Array | undefined>(
        this.db.transaction("kv").objectStore("kv").get(k),
      );
      if (!blob) continue;
      const value = await openJson(old, blob);
      const next = await sealJson(newKey, value);
      const tx = this.db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(next, k);
      await txDone(tx);
    }

    for (const store of ["sessions", "peers"] as const) {
      const keys = await wrap<IDBValidKey[]>(
        this.db.transaction(store).objectStore(store).getAllKeys(),
      );
      for (const k of keys) {
        const blob = await wrap<Uint8Array | undefined>(
          this.db.transaction(store).objectStore(store).get(k),
        );
        if (!blob) continue;
        const value = await openJson(old, blob);
        const next = await sealJson(newKey, value);
        const tx = this.db.transaction(store, "readwrite");
        tx.objectStore(store).put(next, k);
        await txDone(tx);
      }
    }

    const rows = await wrap<Row[]>(
      this.db.transaction("messages").objectStore("messages").getAll(),
    );
    for (const row of rows) {
      const plain = await aeadOpen(old, row.blob);
      const sealed = await aeadSeal(newKey, plain);
      const tx = this.db.transaction("messages", "readwrite");
      tx.objectStore("messages").put({ ...row, blob: sealed });
      await txDone(tx);
    }

    this.key = newKey;
  }
}
