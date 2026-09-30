/**
 * Low-level primitives shared by every part of Lop's E2EE stack.
 * Everything here is either a vetted `@noble/*` primitive or native WebCrypto.
 */

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export { sha256, bytesToHex, utf8ToBytes };

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/* ------------------------------------------------------------------ */
/* bytes / base64                                                      */
/* ------------------------------------------------------------------ */

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ */
/* asymmetric keys                                                     */
/* ------------------------------------------------------------------ */

export function generateX25519(): KeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export function generateEd25519(): KeyPair {
  const privateKey = ed25519.utils.randomSecretKey();
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) };
}

export function dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}

export function sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

export function verify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* KDFs                                                                */
/* ------------------------------------------------------------------ */

export function hkdf32(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length = 32,
): Uint8Array {
  return hkdf(sha256, ikm, salt, utf8ToBytes(info), length);
}

export function hmac256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data);
}

/**
 * Memory-hard secret stretching (Argon2id, OWASP minimum profile).
 * Used client-side for the account password and the vault passcode so that
 * neither ever leaves the browser in usable form.
 */
export async function stretchSecret(
  secret: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return argon2idAsync(utf8ToBytes(secret.normalize("NFKC")), salt, {
    t: 2,
    m: 19_456,
    p: 1,
    dkLen: 64,
    asyncTick: 20,
  });
}

/* ------------------------------------------------------------------ */
/* AEAD (AES-256-GCM via WebCrypto)                                    */
/* ------------------------------------------------------------------ */

function buf(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export async function importAesKey(
  raw: Uint8Array,
  extractable = false,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", buf(raw), "AES-GCM", extractable, [
    "encrypt",
    "decrypt",
  ]);
}

export type AeadKey = Uint8Array | CryptoKey;

async function asCryptoKey(key: AeadKey): Promise<CryptoKey> {
  return key instanceof Uint8Array ? importAesKey(key) : key;
}

/** Returns `nonce(12) || ciphertext||tag`. */
export async function aeadSeal(
  key: AeadKey,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const nonce = randomBytes(12);
  const ck = await asCryptoKey(key);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: buf(nonce),
        ...(aad ? { additionalData: buf(aad) } : {}),
      },
      ck,
      buf(plaintext),
    ),
  );
  return concatBytes(nonce, ct);
}

export async function aeadOpen(
  key: AeadKey,
  sealed: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  if (sealed.length < 12 + 16) throw new Error("ciphertext too short");
  const ck = await asCryptoKey(key);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: buf(sealed.subarray(0, 12)),
        ...(aad ? { additionalData: buf(aad) } : {}),
      },
      ck,
      buf(sealed.subarray(12)),
    ),
  );
}

export async function sealJson(key: AeadKey, value: unknown): Promise<Uint8Array> {
  return aeadSeal(key, utf8ToBytes(JSON.stringify(value)));
}

export async function openJson<T>(key: AeadKey, sealed: Uint8Array): Promise<T> {
  return JSON.parse(utf8Decode(await aeadOpen(key, sealed))) as T;
}
