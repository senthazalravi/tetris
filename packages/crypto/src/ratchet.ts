/**
 * X3DH key agreement + Double Ratchet (Signal specification), built on
 * X25519 / HKDF-SHA256 / HMAC-SHA256 / AES-256-GCM.
 *
 * All state is plain JSON (base64 strings) so it can be sealed into the
 * device vault. Every function is pure: it clones the state, and the caller
 * only persists the returned state after success.
 */

import type { DeviceKeys } from "./identity";
import { signedPrekeyMessage } from "./identity";
import {
  aeadOpen,
  aeadSeal,
  bytesToHex,
  concatBytes,
  dh,
  fromBase64,
  generateX25519,
  hkdf32,
  hmac256,
  toBase64,
  utf8Decode,
  utf8ToBytes,
  verify,
} from "./primitives";

const MAX_SKIP = 500;
const MAX_STORED_SKIPPED = 1000;

export class CryptoError extends Error {
  constructor(
    public code:
      | "NO_SESSION"
      | "BAD_SIGNATURE"
      | "BAD_HEADER"
      | "DUPLICATE"
      | "TOO_MANY_SKIPPED"
      | "UNKNOWN_PREKEY"
      | "DECRYPT_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "CryptoError";
  }
}

export interface PeerBundle {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  signedPrekey: { id: number; publicKey: string; signature: string };
  oneTimePrekey: { id: number; publicKey: string } | null;
}

/** Attached to every message of an initiator until the peer replies. */
export interface X3dhHeader {
  ik: string; // initiator identity key
  sk: string; // initiator signing key
  ek: string; // initiator ephemeral key
  spkId: number;
  opkId: number | null;
  /** Sender device id, so the responder can bind the session to it. */
  did: string;
}

export interface RatchetState {
  v: 1;
  role: "initiator" | "responder";
  peerDeviceId: string;
  peerIdentityKey: string;
  peerSigningKey: string;
  ad: string;
  dhs: { pub: string; priv: string };
  dhr: string | null;
  rk: string;
  cks: string | null;
  ckr: string | null;
  ns: number;
  nr: number;
  pn: number;
  skipped: Record<string, string>;
  x3dh: X3dhHeader | null;
  received: number;
}

interface MessageHeader {
  dh: string;
  pn: number;
  n: number;
  x?: X3dhHeader;
}

export interface WireMessage {
  cryptoHeader: string;
  ciphertext: string;
}

/* ------------------------------------------------------------------ */
/* KDF chains                                                          */
/* ------------------------------------------------------------------ */

function kdfRk(rk: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdf32(dhOut, rk, "lop/ratchet-rk/v1", 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

function kdfCk(ck: Uint8Array): [Uint8Array, Uint8Array] {
  return [hmac256(ck, Uint8Array.of(2)), hmac256(ck, Uint8Array.of(1))];
}

function messageAesKey(mk: Uint8Array): Uint8Array {
  return hkdf32(mk, new Uint8Array(32), "lop/message-key/v1");
}

function x3dhSecret(parts: Uint8Array[]): Uint8Array {
  const f = new Uint8Array(32).fill(0xff);
  return hkdf32(concatBytes(f, ...parts), new Uint8Array(32), "lop/x3dh/v1");
}

function clone(state: RatchetState): RatchetState {
  return { ...state, dhs: { ...state.dhs }, skipped: { ...state.skipped } };
}

/* ------------------------------------------------------------------ */
/* Session creation                                                    */
/* ------------------------------------------------------------------ */

export function initiateSession(
  keys: DeviceKeys,
  bundle: PeerBundle,
  ourDeviceId: string,
): RatchetState {
  const theirIk = fromBase64(bundle.identityKey);
  const theirSigning = fromBase64(bundle.signingKey);
  const theirSpk = fromBase64(bundle.signedPrekey.publicKey);

  if (
    !verify(
      theirSigning,
      signedPrekeyMessage(theirSpk),
      fromBase64(bundle.signedPrekey.signature),
    )
  ) {
    throw new CryptoError("BAD_SIGNATURE", "Signed prekey signature invalid");
  }

  const ek = generateX25519();
  const parts = [
    dh(keys.identity.privateKey, theirSpk),
    dh(ek.privateKey, theirIk),
    dh(ek.privateKey, theirSpk),
  ];
  if (bundle.oneTimePrekey) {
    parts.push(dh(ek.privateKey, fromBase64(bundle.oneTimePrekey.publicKey)));
  }
  const sk = x3dhSecret(parts);

  const dhs = generateX25519();
  const [rk, cks] = kdfRk(sk, dh(dhs.privateKey, theirSpk));

  return {
    v: 1,
    role: "initiator",
    peerDeviceId: bundle.deviceId,
    peerIdentityKey: bundle.identityKey,
    peerSigningKey: bundle.signingKey,
    ad: toBase64(concatBytes(keys.identity.publicKey, theirIk)),
    dhs: { pub: toBase64(dhs.publicKey), priv: toBase64(dhs.privateKey) },
    dhr: bundle.signedPrekey.publicKey,
    rk: toBase64(rk),
    cks: toBase64(cks),
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    x3dh: {
      ik: toBase64(keys.identity.publicKey),
      sk: toBase64(keys.signing.publicKey),
      ek: toBase64(ek.publicKey),
      spkId: bundle.signedPrekey.id,
      opkId: bundle.oneTimePrekey?.id ?? null,
      did: ourDeviceId,
    },
    received: 0,
  };
}

function acceptSession(
  keys: DeviceKeys,
  x: X3dhHeader,
): { state: RatchetState; keys: DeviceKeys } {
  if (x.spkId !== keys.signedPrekey.id) {
    throw new CryptoError("UNKNOWN_PREKEY", "Unknown signed prekey");
  }
  const theirIk = fromBase64(x.ik);
  const theirEk = fromBase64(x.ek);
  const parts = [
    dh(keys.signedPrekey.keyPair.privateKey, theirIk),
    dh(keys.identity.privateKey, theirEk),
    dh(keys.signedPrekey.keyPair.privateKey, theirEk),
  ];
  let nextKeys = keys;
  if (x.opkId !== null) {
    const opk = keys.oneTimePrekeys.find((p) => p.id === x.opkId);
    if (!opk) throw new CryptoError("UNKNOWN_PREKEY", "One-time prekey already used");
    parts.push(dh(opk.keyPair.privateKey, theirEk));
    nextKeys = {
      ...keys,
      oneTimePrekeys: keys.oneTimePrekeys.filter((p) => p.id !== x.opkId),
    };
  }
  const sk = x3dhSecret(parts);
  const spk = keys.signedPrekey.keyPair;
  return {
    keys: nextKeys,
    state: {
      v: 1,
      role: "responder",
      peerDeviceId: x.did,
      peerIdentityKey: x.ik,
      peerSigningKey: x.sk,
      ad: toBase64(concatBytes(theirIk, keys.identity.publicKey)),
      dhs: { pub: toBase64(spk.publicKey), priv: toBase64(spk.privateKey) },
      dhr: null,
      rk: toBase64(sk),
      cks: null,
      ckr: null,
      ns: 0,
      nr: 0,
      pn: 0,
      skipped: {},
      x3dh: x,
      received: 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Encrypt                                                             */
/* ------------------------------------------------------------------ */

export async function ratchetEncrypt(
  input: RatchetState,
  plaintext: Uint8Array,
): Promise<{ state: RatchetState; message: WireMessage }> {
  const state = clone(input);
  if (!state.cks) throw new CryptoError("NO_SESSION", "Sending chain not ready");

  const [nextCk, mk] = kdfCk(fromBase64(state.cks));
  const header: MessageHeader = {
    dh: state.dhs.pub,
    pn: state.pn,
    n: state.ns,
    ...(state.x3dh && state.role === "initiator" ? { x: state.x3dh } : {}),
  };
  const headerBytes = utf8ToBytes(JSON.stringify(header));
  const ct = await aeadSeal(
    messageAesKey(mk),
    plaintext,
    concatBytes(fromBase64(state.ad), headerBytes),
  );
  state.cks = toBase64(nextCk);
  state.ns += 1;
  return {
    state,
    message: { cryptoHeader: toBase64(headerBytes), ciphertext: toBase64(ct) },
  };
}

/* ------------------------------------------------------------------ */
/* Decrypt                                                             */
/* ------------------------------------------------------------------ */

function skipMessageKeys(state: RatchetState, until: number) {
  if (!state.ckr) return;
  if (until - state.nr > MAX_SKIP) {
    throw new CryptoError("TOO_MANY_SKIPPED", "Too many skipped messages");
  }
  let ck = fromBase64(state.ckr);
  while (state.nr < until) {
    const [nextCk, mk] = kdfCk(ck);
    state.skipped[`${state.dhr}:${state.nr}`] = toBase64(mk);
    ck = nextCk;
    state.nr += 1;
  }
  state.ckr = toBase64(ck);
  const keys = Object.keys(state.skipped);
  if (keys.length > MAX_STORED_SKIPPED) {
    for (const k of keys.slice(0, keys.length - MAX_STORED_SKIPPED)) {
      delete state.skipped[k];
    }
  }
}

function dhRatchet(state: RatchetState, theirDh: string) {
  state.pn = state.ns;
  state.ns = 0;
  state.nr = 0;
  state.dhr = theirDh;
  const theirPub = fromBase64(theirDh);
  const [rk1, ckr] = kdfRk(fromBase64(state.rk), dh(fromBase64(state.dhs.priv), theirPub));
  const fresh = generateX25519();
  const [rk2, cks] = kdfRk(rk1, dh(fresh.privateKey, theirPub));
  state.dhs = { pub: toBase64(fresh.publicKey), priv: toBase64(fresh.privateKey) };
  state.rk = toBase64(rk2);
  state.ckr = toBase64(ckr);
  state.cks = toBase64(cks);
}

async function decryptWithState(
  input: RatchetState,
  headerBytes: Uint8Array,
  header: MessageHeader,
  ciphertext: Uint8Array,
): Promise<{ state: RatchetState; plaintext: Uint8Array }> {
  const state = clone(input);
  const aad = concatBytes(fromBase64(state.ad), headerBytes);

  const skippedId = `${header.dh}:${header.n}`;
  const skippedKey = state.skipped[skippedId];
  if (skippedKey) {
    delete state.skipped[skippedId];
    const plaintext = await openOrThrow(fromBase64(skippedKey), ciphertext, aad);
    return { state, plaintext };
  }

  if (header.dh === state.dhr && header.n < state.nr) {
    throw new CryptoError("DUPLICATE", "Message already processed");
  }

  if (header.dh !== state.dhr) {
    skipMessageKeys(state, header.pn);
    dhRatchet(state, header.dh);
  }
  skipMessageKeys(state, header.n);

  if (!state.ckr) throw new CryptoError("NO_SESSION", "Receiving chain not ready");
  const [nextCk, mk] = kdfCk(fromBase64(state.ckr));
  const plaintext = await openOrThrow(mk, ciphertext, aad);
  state.ckr = toBase64(nextCk);
  state.nr += 1;
  state.received += 1;
  // The peer answered, so it holds our session: stop attaching X3DH info.
  if (state.role === "initiator") state.x3dh = null;
  return { state, plaintext };
}

async function openOrThrow(
  mk: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  try {
    return await aeadOpen(messageAesKey(mk), ciphertext, aad);
  } catch {
    throw new CryptoError("DECRYPT_FAILED", "Message authentication failed");
  }
}

export interface DecryptResult {
  plaintext: Uint8Array;
  /** State to persist (may be the untouched existing state). */
  state: RatchetState;
  keys: DeviceKeys;
  /** True when a new session replaced (or created) the stored one. */
  sessionReset: boolean;
}

export async function ratchetDecrypt(
  existing: RatchetState | null,
  keys: DeviceKeys,
  message: WireMessage,
): Promise<DecryptResult> {
  let headerBytes: Uint8Array;
  let header: MessageHeader;
  try {
    headerBytes = fromBase64(message.cryptoHeader);
    header = JSON.parse(utf8Decode(headerBytes)) as MessageHeader;
    if (
      typeof header.dh !== "string" ||
      !Number.isInteger(header.n) ||
      !Number.isInteger(header.pn)
    ) {
      throw new Error("shape");
    }
  } catch {
    throw new CryptoError("BAD_HEADER", "Malformed message header");
  }
  const ciphertext = fromBase64(message.ciphertext);
  const x = header.x;

  if (!x) {
    if (!existing) throw new CryptoError("NO_SESSION", "No session with sender");
    const r = await decryptWithState(existing, headerBytes, header, ciphertext);
    return { ...r, keys, sessionReset: false };
  }

  // Same handshake we already accepted: normal ratchet message.
  if (existing?.role === "responder" && existing.x3dh?.ek === x.ek) {
    const r = await decryptWithState(existing, headerBytes, header, ciphertext);
    return { ...r, keys, sessionReset: false };
  }

  // Both sides started a session at the same time: deterministic tie-break.
  // The initiator with the smaller identity key wins. If we win we still
  // decrypt this one message with a throwaway session so nothing is lost.
  if (existing?.role === "initiator" && existing.received === 0 && existing.x3dh) {
    const theirWins =
      bytesToHex(fromBase64(x.ik)) < bytesToHex(fromBase64(existing.x3dh.ik));
    const accepted = acceptSession(keys, x);
    const r = await decryptWithState(accepted.state, headerBytes, header, ciphertext);
    if (theirWins) {
      return { plaintext: r.plaintext, state: r.state, keys: accepted.keys, sessionReset: true };
    }
    return { plaintext: r.plaintext, state: existing, keys: accepted.keys, sessionReset: false };
  }

  const accepted = acceptSession(keys, x);
  const r = await decryptWithState(accepted.state, headerBytes, header, ciphertext);
  return { plaintext: r.plaintext, state: r.state, keys: accepted.keys, sessionReset: true };
}
