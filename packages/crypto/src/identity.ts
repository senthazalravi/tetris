import {
  bytesToHex,
  concatBytes,
  fromBase64,
  generateEd25519,
  generateX25519,
  hkdf32,
  randomBytes,
  sha256,
  sign,
  stretchSecret,
  toBase64,
  utf8ToBytes,
  type KeyPair,
} from "./primitives";

/* ------------------------------------------------------------------ */
/* Password + vault passcode derivation                                */
/* ------------------------------------------------------------------ */

export function generateSaltB64(): string {
  return toBase64(randomBytes(16));
}

/**
 * The account password never leaves the browser. The server receives (and
 * stores a hash of) this derived proof instead.
 */
export async function deriveAuthProof(
  password: string,
  authSaltB64: string,
): Promise<string> {
  const master = await stretchSecret(password, fromBase64(authSaltB64));
  return toBase64(hkdf32(master, new Uint8Array(32), "lop/auth-proof/v1"));
}

export interface VaultSecrets {
  /** 32-byte key that seals every byte stored on this device. Never uploaded. */
  vaultKey: Uint8Array;
  /** Proof of passcode knowledge. Server stores only its hash. */
  verifier: string;
}

export async function deriveVaultSecrets(
  passcode: string,
  vaultSaltB64: string,
): Promise<VaultSecrets> {
  const master = await stretchSecret(passcode, fromBase64(vaultSaltB64));
  const zero = new Uint8Array(32);
  return {
    vaultKey: hkdf32(master, zero, "lop/vault-key/v1"),
    verifier: toBase64(hkdf32(master, zero, "lop/vault-verifier/v1")),
  };
}

/* ------------------------------------------------------------------ */
/* Device keys                                                         */
/* ------------------------------------------------------------------ */

export interface PrekeyPair {
  id: number;
  keyPair: KeyPair;
}

export interface DeviceKeys {
  identity: KeyPair; // X25519, used in X3DH
  signing: KeyPair; // Ed25519, signs the signed prekey
  signedPrekey: PrekeyPair & { signature: Uint8Array };
  oneTimePrekeys: PrekeyPair[];
  nextPrekeyId: number;
}

const SPK_DOMAIN = utf8ToBytes("lop/spk/v1");

export function signedPrekeyMessage(spkPublic: Uint8Array): Uint8Array {
  return concatBytes(SPK_DOMAIN, spkPublic);
}

export function generateOneTimePrekeys(
  startId: number,
  count: number,
): PrekeyPair[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    keyPair: generateX25519(),
  }));
}

export const ONE_TIME_PREKEY_BATCH = 50;

export function createDeviceKeys(): DeviceKeys {
  const identity = generateX25519();
  const signing = generateEd25519();
  const spk = generateX25519();
  return {
    identity,
    signing,
    signedPrekey: {
      id: 1,
      keyPair: spk,
      signature: sign(signing.privateKey, signedPrekeyMessage(spk.publicKey)),
    },
    oneTimePrekeys: generateOneTimePrekeys(2, ONE_TIME_PREKEY_BATCH),
    nextPrekeyId: 2 + ONE_TIME_PREKEY_BATCH,
  };
}

/** Add a fresh batch of one-time prekeys and return the new public halves. */
export function replenishPrekeys(
  keys: DeviceKeys,
  count = ONE_TIME_PREKEY_BATCH,
): { keys: DeviceKeys; added: PrekeyPair[] } {
  const added = generateOneTimePrekeys(keys.nextPrekeyId, count);
  return {
    keys: {
      ...keys,
      oneTimePrekeys: [...keys.oneTimePrekeys, ...added],
      nextPrekeyId: keys.nextPrekeyId + count,
    },
    added,
  };
}

/** Public material uploaded to the server. Contains no secrets. */
export interface UploadBundle {
  identityKey: string;
  signingKey: string;
  signedPrekey: { id: number; publicKey: string; signature: string };
  oneTimePrekeys: { id: number; publicKey: string }[];
}

export function exportUploadBundle(keys: DeviceKeys): UploadBundle {
  return {
    identityKey: toBase64(keys.identity.publicKey),
    signingKey: toBase64(keys.signing.publicKey),
    signedPrekey: {
      id: keys.signedPrekey.id,
      publicKey: toBase64(keys.signedPrekey.keyPair.publicKey),
      signature: toBase64(keys.signedPrekey.signature),
    },
    oneTimePrekeys: keys.oneTimePrekeys.map((p) => ({
      id: p.id,
      publicKey: toBase64(p.keyPair.publicKey),
    })),
  };
}

/* ---- serialization for the sealed local store ---- */

interface SerializedKeyPair {
  pub: string;
  priv: string;
}
const ser = (k: KeyPair): SerializedKeyPair => ({
  pub: toBase64(k.publicKey),
  priv: toBase64(k.privateKey),
});
const de = (k: SerializedKeyPair): KeyPair => ({
  publicKey: fromBase64(k.pub),
  privateKey: fromBase64(k.priv),
});

export interface SerializedDeviceKeys {
  identity: SerializedKeyPair;
  signing: SerializedKeyPair;
  signedPrekey: { id: number; kp: SerializedKeyPair; sig: string };
  oneTimePrekeys: { id: number; kp: SerializedKeyPair }[];
  nextPrekeyId: number;
}

export function serializeDeviceKeys(k: DeviceKeys): SerializedDeviceKeys {
  return {
    identity: ser(k.identity),
    signing: ser(k.signing),
    signedPrekey: {
      id: k.signedPrekey.id,
      kp: ser(k.signedPrekey.keyPair),
      sig: toBase64(k.signedPrekey.signature),
    },
    oneTimePrekeys: k.oneTimePrekeys.map((p) => ({ id: p.id, kp: ser(p.keyPair) })),
    nextPrekeyId: k.nextPrekeyId,
  };
}

export function deserializeDeviceKeys(s: SerializedDeviceKeys): DeviceKeys {
  return {
    identity: de(s.identity),
    signing: de(s.signing),
    signedPrekey: {
      id: s.signedPrekey.id,
      keyPair: de(s.signedPrekey.kp),
      signature: fromBase64(s.signedPrekey.sig),
    },
    oneTimePrekeys: s.oneTimePrekeys.map((p) => ({ id: p.id, keyPair: de(p.kp) })),
    nextPrekeyId: s.nextPrekeyId,
  };
}

/* ------------------------------------------------------------------ */
/* Safety numbers (out-of-band identity verification)                  */
/* ------------------------------------------------------------------ */

function half(identityKey: Uint8Array, signingKey: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes("lop/safety/v1"), identityKey, signingKey));
}

/** Symmetric 60-digit number both parties see; a mismatch reveals a MITM. */
export function safetyNumber(
  mine: { identityKey: Uint8Array; signingKey: Uint8Array },
  theirs: { identityKey: Uint8Array; signingKey: Uint8Array },
): string {
  const a = half(mine.identityKey, mine.signingKey);
  const b = half(theirs.identityKey, theirs.signingKey);
  const ordered = bytesToHex(a) < bytesToHex(b) ? [a, b] : [b, a];
  const digest = sha256(concatBytes(ordered[0]!, ordered[1]!));
  const extra = sha256(concatBytes(digest, utf8ToBytes("2")));
  const bytes = concatBytes(digest, extra).subarray(0, 60);
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = (n * 256 + bytes[i * 5 + j]!) % 100_000;
    groups.push(String(n).padStart(5, "0"));
  }
  return groups.join(" ");
}

export function shortFingerprint(identityKey: Uint8Array): string {
  return bytesToHex(sha256(identityKey)).slice(0, 16);
}
