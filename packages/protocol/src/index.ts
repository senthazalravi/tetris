/**
 * Encrypted message envelope. This JSON is what gets sealed by the Double
 * Ratchet; the server only ever sees the resulting ciphertext.
 */
export interface ReplyRef {
  id: string;
  senderId: string;
  preview: string;
}

export interface AttachmentRef {
  /** Server attachment id (ciphertext lives in R2). */
  id: string;
  /** Base64 AES-256 content key — exists only inside this E2EE envelope. */
  key: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** Tiny inline JPEG data URL for instant image previews. */
  thumb?: string;
}

export interface MessageEnvelope {
  v: 1;
  kind: "text" | "file";
  body: string;
  replyTo?: ReplyRef;
  attachment?: AttachmentRef;
}

export function encodeEnvelope(e: MessageEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(e));
}

export function decodeEnvelope(bytes: Uint8Array): MessageEnvelope {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as MessageEnvelope;
  if (parsed?.v !== 1 || (parsed.kind !== "text" && parsed.kind !== "file")) {
    throw new Error("Unsupported message envelope");
  }
  return parsed;
}
