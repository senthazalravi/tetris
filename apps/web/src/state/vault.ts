import {
  createDeviceKeys,
  deserializeDeviceKeys,
  exportUploadBundle,
  importAesKey,
  replenishPrekeys,
  serializeDeviceKeys,
  type DeviceKeys,
} from "@tetris/crypto";
import { api } from "@/lib/api";
import { LocalDb } from "./localdb";

/**
 * In-memory secrets for the unlocked tab. Nothing here is ever written to
 * disk unsealed, and a page reload discards all of it (hence the passcode
 * prompt on every open).
 */
interface Unlocked {
  db: LocalDb;
  keys: DeviceKeys;
  deviceId: string;
  userId: string;
}

let current: Unlocked | null = null;

export function isUnlocked() {
  return current !== null;
}

export function vault(): Unlocked {
  if (!current) throw new Error("Vault is locked");
  return current;
}

export function lockMemory() {
  current?.db.close();
  current = null;
}

async function persistKeys(u: Unlocked) {
  await u.db.setKv("deviceKeys", serializeDeviceKeys(u.keys));
  await u.db.setKv("deviceId", u.deviceId);
}

async function registerFreshDevice(db: LocalDb, userId: string): Promise<Unlocked> {
  const keys = createDeviceKeys();
  const res = await api.post<{ deviceId: string }>("/devices", exportUploadBundle(keys));
  const u: Unlocked = { db, keys, deviceId: res.deviceId, userId };
  await persistKeys(u);
  return u;
}

/**
 * Called once the server has confirmed the passcode. Opens (or creates) this
 * device's sealed store and makes sure the server knows our current device.
 * Returns whether a *new* device identity had to be created.
 */
export async function openVault(opts: {
  userId: string;
  epoch: number;
  vaultKeyRaw: Uint8Array;
}): Promise<{ freshDevice: boolean }> {
  const key = await importAesKey(opts.vaultKeyRaw, false);
  opts.vaultKeyRaw.fill(0);
  const db = await LocalDb.open(opts.userId, key, opts.epoch);

  const stored = await db.getKv<ReturnType<typeof serializeDeviceKeys>>("deviceKeys");
  const storedId = await db.getKv<string>("deviceId");

  if (stored && storedId) {
    const status = await api.get<{ active: boolean; needsPrekeys: boolean }>(
      `/devices/${storedId}/status`,
    );
    if (status.active) {
      const u: Unlocked = {
        db,
        keys: deserializeDeviceKeys(stored),
        deviceId: storedId,
        userId: opts.userId,
      };
      current = u;
      if (status.needsPrekeys) await topUpPrekeys();
      return { freshDevice: false };
    }
  }
  // New browser, cleared storage, or another browser took over the account.
  current = await registerFreshDevice(db, opts.userId);
  return { freshDevice: true };
}

export async function topUpPrekeys() {
  const u = vault();
  const { keys, added } = replenishPrekeys(u.keys);
  await api.post(`/devices/${u.deviceId}/prekeys`, {
    oneTimePrekeys: added.map((p) => ({
      id: p.id,
      publicKey: btoa(String.fromCharCode(...p.keyPair.publicKey)),
    })),
  });
  u.keys = keys;
  await persistKeys(u);
}

/** Keys changed (a one-time prekey was consumed). */
export async function saveKeys(keys: DeviceKeys) {
  const u = vault();
  u.keys = keys;
  await u.db.setKv("deviceKeys", serializeDeviceKeys(keys));
}
