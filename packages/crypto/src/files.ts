import {
  aeadOpen,
  aeadSeal,
  fromBase64,
  importAesKey,
  randomBytes,
  toBase64,
} from "./primitives";

export interface EncryptedBlob {
  /** `nonce || ciphertext || tag` — the only thing that is ever uploaded. */
  ciphertext: Uint8Array;
  /** Random per-file key. Travels only inside the E2EE message envelope. */
  key: string;
}

/** Native AES-256-GCM; fast enough for tens of megabytes in the browser. */
export async function encryptBlob(plain: Uint8Array): Promise<EncryptedBlob> {
  const raw = randomBytes(32);
  const key = await importAesKey(raw);
  return { ciphertext: await aeadSeal(key, plain), key: toBase64(raw) };
}

export async function decryptBlob(
  ciphertext: Uint8Array,
  keyB64: string,
): Promise<Uint8Array> {
  const key = await importAesKey(fromBase64(keyB64));
  return aeadOpen(key, ciphertext);
}
