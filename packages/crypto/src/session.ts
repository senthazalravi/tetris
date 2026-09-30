import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  fromBase64,
  generateIdentityKeyPair,
  generateSalt,
  open,
  seal,
  toBase64,
  type IdentityKeyPair,
} from "./primitives";

export interface DeviceKeys {
  identity: IdentityKeyPair;
  signedPrekey: IdentityKeyPair;
  signedPrekeyId: number;
}

export interface PublicKeyBundle {
  identityPublicKey: string;
  signedPrekeyId: number;
  signedPrekeyPublicKey: string;
}

export interface SessionState {
  peerUserId: string;
  rootKey: string;
  sendChain: number;
  recvChain: number;
}

export function createDeviceKeys(): DeviceKeys {
  return {
    identity: generateIdentityKeyPair(),
    signedPrekey: generateIdentityKeyPair(),
    signedPrekeyId: 1,
  };
}

export function exportPublicBundle(keys: DeviceKeys): PublicKeyBundle {
  return {
    identityPublicKey: toBase64(keys.identity.publicKey),
    signedPrekeyId: keys.signedPrekeyId,
    signedPrekeyPublicKey: toBase64(keys.signedPrekey.publicKey),
  };
}

export function wrapDeviceKeys(
  vaultKey: Uint8Array,
  keys: DeviceKeys,
): string {
  const payload = JSON.stringify({
    identityPrivate: toBase64(keys.identity.privateKey),
    identityPublic: toBase64(keys.identity.publicKey),
    signedPrekeyPrivate: toBase64(keys.signedPrekey.privateKey),
    signedPrekeyPublic: toBase64(keys.signedPrekey.publicKey),
    signedPrekeyId: keys.signedPrekeyId,
  });
  return toBase64(seal(vaultKey, utf8ToBytes(payload)));
}

export function unwrapDeviceKeys(
  vaultKey: Uint8Array,
  wrappedB64: string,
): DeviceKeys {
  const raw = new TextDecoder().decode(open(vaultKey, fromBase64(wrappedB64)));
  const data = JSON.parse(raw) as {
    identityPrivate: string;
    identityPublic: string;
    signedPrekeyPrivate: string;
    signedPrekeyPublic: string;
    signedPrekeyId: number;
  };
  return {
    identity: {
      privateKey: fromBase64(data.identityPrivate),
      publicKey: fromBase64(data.identityPublic),
    },
    signedPrekey: {
      privateKey: fromBase64(data.signedPrekeyPrivate),
      publicKey: fromBase64(data.signedPrekeyPublic),
    },
    signedPrekeyId: data.signedPrekeyId,
  };
}

/** X3DH-style shared secret for 1:1 session bootstrap. */
export function initiateSession(
  ourKeys: DeviceKeys,
  theirBundle: PublicKeyBundle,
): { session: SessionState; ephemeralPublicKey: string } {
  const ephemeral = generateIdentityKeyPair();
  const theirIdentity = fromBase64(theirBundle.identityPublicKey);
  const theirSigned = fromBase64(theirBundle.signedPrekeyPublicKey);

  const dh1 = x25519.getSharedSecret(ourKeys.identity.privateKey, theirSigned);
  const dh2 = x25519.getSharedSecret(ephemeral.privateKey, theirIdentity);
  const dh3 = x25519.getSharedSecret(ephemeral.privateKey, theirSigned);

  const ikm = new Uint8Array(dh1.length + dh2.length + dh3.length);
  ikm.set(dh1, 0);
  ikm.set(dh2, dh1.length);
  ikm.set(dh3, dh1.length + dh2.length);

  const rootKey = hkdf(sha256, ikm, new Uint8Array(32), utf8ToBytes("lop-x3dh-v1"), 32);

  return {
    session: {
      peerUserId: "",
      rootKey: toBase64(rootKey),
      sendChain: 0,
      recvChain: 0,
    },
    ephemeralPublicKey: toBase64(ephemeral.publicKey),
  };
}

export function acceptSession(
  ourKeys: DeviceKeys,
  theirIdentityPublicKey: string,
  theirEphemeralPublicKey: string,
): SessionState {
  const theirIdentity = fromBase64(theirIdentityPublicKey);
  const theirEphemeral = fromBase64(theirEphemeralPublicKey);

  const dh1 = x25519.getSharedSecret(ourKeys.signedPrekey.privateKey, theirIdentity);
  const dh2 = x25519.getSharedSecret(ourKeys.identity.privateKey, theirEphemeral);
  const dh3 = x25519.getSharedSecret(ourKeys.signedPrekey.privateKey, theirEphemeral);

  const ikm = new Uint8Array(dh1.length + dh2.length + dh3.length);
  ikm.set(dh1, 0);
  ikm.set(dh2, dh1.length);
  ikm.set(dh3, dh1.length + dh2.length);

  const rootKey = hkdf(sha256, ikm, new Uint8Array(32), utf8ToBytes("lop-x3dh-v1"), 32);

  return {
    peerUserId: "",
    rootKey: toBase64(rootKey),
    sendChain: 0,
    recvChain: 0,
  };
}

function messageKey(rootKeyB64: string, counter: number): Uint8Array {
  return hkdf(
    sha256,
    fromBase64(rootKeyB64),
    utf8ToBytes(`lop-msg-${counter}`),
    utf8ToBytes("lop-msg-v1"),
    32,
  );
}

export interface WireEnvelope {
  cryptoHeader: string;
  ciphertext: string;
}

export function encryptText(
  session: SessionState,
  plaintext: string,
  headerExtra: Record<string, unknown> = {},
): { envelope: WireEnvelope; nextSession: SessionState } {
  const counter = session.sendChain;
  const key = messageKey(session.rootKey, counter);
  const sealed = seal(key, utf8ToBytes(plaintext));
  const header = {
    v: 1,
    n: counter,
    ...headerExtra,
  };
  return {
    envelope: {
      cryptoHeader: toBase64(utf8ToBytes(JSON.stringify(header))),
      ciphertext: toBase64(sealed),
    },
    nextSession: { ...session, sendChain: counter + 1 },
  };
}

export function decryptText(
  session: SessionState,
  envelope: WireEnvelope,
): { plaintext: string; nextSession: SessionState } {
  const header = JSON.parse(
    new TextDecoder().decode(fromBase64(envelope.cryptoHeader)),
  ) as { n: number };
  const key = messageKey(session.rootKey, header.n);
  const plaintext = new TextDecoder().decode(open(key, fromBase64(envelope.ciphertext)));
  const nextRecv = Math.max(session.recvChain, header.n + 1);
  return {
    plaintext,
    nextSession: { ...session, recvChain: nextRecv },
  };
}

export { generateSalt };
