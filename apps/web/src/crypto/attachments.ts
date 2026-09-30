import { generateSalt, seal, open, toBase64, fromBase64 } from "@lop/crypto";

export async function encryptFile(file: File): Promise<{
  ciphertext: Uint8Array;
  contentKeyB64: string;
  name: string;
  mime: string;
  size: number;
}> {
  const key = generateSalt(32);
  const buf = new Uint8Array(await file.arrayBuffer());
  const ciphertext = seal(key, buf);
  return {
    ciphertext,
    contentKeyB64: toBase64(key),
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
}

export async function decryptFile(
  ciphertext: Uint8Array,
  contentKeyB64: string,
): Promise<Uint8Array> {
  return open(fromBase64(contentKeyB64), ciphertext);
}

export type ChatPayload =
  | { kind: "text"; body: string }
  | {
      kind: "file";
      name: string;
      mime: string;
      attachmentId: string;
      contentKeyB64: string;
    };

export function encodePayload(p: ChatPayload): string {
  return JSON.stringify(p);
}

export function decodePayload(raw: string): ChatPayload {
  try {
    const parsed = JSON.parse(raw) as ChatPayload;
    if (parsed && typeof parsed === "object" && "kind" in parsed) return parsed;
  } catch {
    /* legacy plain text */
  }
  return { kind: "text", body: raw };
}
