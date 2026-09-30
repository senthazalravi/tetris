import {
  createDeviceKeys,
  deriveVaultKey,
  exportPublicBundle,
  fromBase64,
  generateSalt,
  toBase64,
  wrapDeviceKeys,
  unwrapDeviceKeys,
  initiateSession,
  acceptSession,
  encryptText,
  decryptText,
  type DeviceKeys,
  type SessionState,
  type PublicKeyBundle,
} from "@lop/crypto";
import { api } from "@/api/client";
import { vaultGet, vaultSet, wipeLocalCommunicationState } from "@/storage/vault";

const SALT_KEY = "vault.salt";
const WRAPPED_KEYS = "vault.deviceKeys";
const DEVICE_ID = "vault.deviceId";
const PASSCODE_VERIFIER = "vault.passcodeOk";

let memoryVaultKey: Uint8Array | null = null;
let memoryKeys: DeviceKeys | null = null;
let memoryDeviceId: string | null = null;
const sessions = new Map<string, SessionState>();

export function getDeviceId(): string | null {
  return memoryDeviceId;
}

export async function setupVaultOnRegister(passcode: string): Promise<void> {
  const salt = generateSalt();
  const vaultKey = await deriveVaultKey(passcode, salt);
  const keys = createDeviceKeys();
  const wrapped = wrapDeviceKeys(vaultKey, keys);
  const bundle = exportPublicBundle(keys);

  const res = await api.post<{ deviceId: string }>("/devices", {
    identityPublicKey: bundle.identityPublicKey,
    signedPrekeyId: bundle.signedPrekeyId,
    signedPrekeyPublicKey: bundle.signedPrekeyPublicKey,
  });

  await vaultSet(SALT_KEY, toBase64(salt));
  await vaultSet(WRAPPED_KEYS, wrapped);
  await vaultSet(DEVICE_ID, res.deviceId);
  await vaultSet(PASSCODE_VERIFIER, "1");

  memoryVaultKey = vaultKey;
  memoryKeys = keys;
  memoryDeviceId = res.deviceId;
  sessionStorage.setItem("lop.pendingPasscode", passcode);
}

export async function unlockVault(passcode: string): Promise<boolean> {
  const saltB64 = await vaultGet(SALT_KEY);
  const wrapped = await vaultGet(WRAPPED_KEYS);
  const deviceId = await vaultGet(DEVICE_ID);
  if (!saltB64 || !wrapped || !deviceId) {
    // No local vault (new browser) — accept passcode length and continue empty
    if (passcode.length < 6) return false;
    memoryDeviceId = null;
    memoryKeys = null;
    memoryVaultKey = null;
    return true;
  }
  try {
    const vaultKey = await deriveVaultKey(passcode, fromBase64(saltB64));
    const keys = unwrapDeviceKeys(vaultKey, wrapped);
    memoryVaultKey = vaultKey;
    memoryKeys = keys;
    memoryDeviceId = deviceId;
    return true;
  } catch {
    return false;
  }
}

export async function onWipeLocal(): Promise<void> {
  memoryVaultKey = null;
  memoryKeys = null;
  memoryDeviceId = null;
  sessions.clear();
  await wipeLocalCommunicationState();
}

function requireKeys(): DeviceKeys {
  if (!memoryKeys) throw new Error("Vault locked");
  return memoryKeys;
}

export async function ensureSessionWithPeer(
  peerUserId: string,
): Promise<SessionState> {
  const existing = sessions.get(peerUserId);
  if (existing) return existing;

  const keys = requireKeys();
  const bundle = await api.get<PublicKeyBundle & { deviceId: string }>(
    `/users/${peerUserId}/key-bundle`,
  );
  const { session, ephemeralPublicKey } = initiateSession(keys, bundle);
  session.peerUserId = peerUserId;
  // Persist bootstrap material for recipient in header on first message
  (session as SessionState & { bootstrap?: unknown }).bootstrap = {
    ephemeralPublicKey,
    senderIdentityPublicKey: exportPublicBundle(keys).identityPublicKey,
  };
  sessions.set(peerUserId, session);
  await vaultSet(`session.${peerUserId}`, JSON.stringify(session));
  return session;
}

export async function encryptOutgoing(
  peerUserId: string,
  text: string,
): Promise<{ cryptoHeader: string; ciphertext: string }> {
  let session = sessions.get(peerUserId) ?? (await ensureSessionWithPeer(peerUserId));
  const bootstrap = (session as SessionState & { bootstrap?: Record<string, string> })
    .bootstrap;
  const { envelope, nextSession } = encryptText(session, text, bootstrap ?? {});
  if (bootstrap) {
    delete (nextSession as SessionState & { bootstrap?: unknown }).bootstrap;
  }
  sessions.set(peerUserId, nextSession);
  await vaultSet(`session.${peerUserId}`, JSON.stringify(nextSession));
  return envelope;
}

export async function decryptIncoming(
  peerUserId: string,
  cryptoHeader: string,
  ciphertext: string,
): Promise<string> {
  let session = sessions.get(peerUserId);
  const header = JSON.parse(
    new TextDecoder().decode(fromBase64(cryptoHeader)),
  ) as {
    n: number;
    ephemeralPublicKey?: string;
    senderIdentityPublicKey?: string;
  };

  if (!session && header.ephemeralPublicKey && header.senderIdentityPublicKey) {
    const keys = requireKeys();
    session = acceptSession(
      keys,
      header.senderIdentityPublicKey,
      header.ephemeralPublicKey,
    );
    session.peerUserId = peerUserId;
    sessions.set(peerUserId, session);
  }
  if (!session) {
    const stored = await vaultGet(`session.${peerUserId}`);
    if (stored) {
      session = JSON.parse(stored) as SessionState;
      sessions.set(peerUserId, session);
    }
  }
  if (!session) throw new Error("No session for peer");

  const { plaintext, nextSession } = decryptText(session, {
    cryptoHeader,
    ciphertext,
  });
  sessions.set(peerUserId, nextSession);
  await vaultSet(`session.${peerUserId}`, JSON.stringify(nextSession));
  return plaintext;
}
