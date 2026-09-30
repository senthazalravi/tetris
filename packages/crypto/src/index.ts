/**
 * Crypto facade — identity, vault KDF, and (later) Signal-style sessions.
 * Private keys never leave the client.
 */

import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/webcrypto.js";

export interface IdentityKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function generateIdentityKeyPair(): IdentityKeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

export function fingerprintPublicKey(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey)).slice(0, 16);
}

export async function deriveVaultKey(
  passcode: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return argon2id(utf8ToBytes(passcode), salt, {
    t: 3,
    m: 32_768,
    p: 1,
    dkLen: 32,
  });
}

export function generateSalt(length = 16): Uint8Array {
  return randomBytes(length);
}

/** AEAD-wrap arbitrary bytes with a 32-byte key. Returns nonce||ciphertext. */
export function seal(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(12);
  const aes = gcm(key, nonce);
  const ciphertext = aes.encrypt(plaintext);
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return out;
}

export function open(key: Uint8Array, sealed: Uint8Array): Uint8Array {
  const nonce = sealed.slice(0, 12);
  const ciphertext = sealed.slice(12);
  const aes = gcm(key, nonce);
  return aes.decrypt(ciphertext);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
