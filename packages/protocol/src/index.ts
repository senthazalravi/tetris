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
  /** A recorded voice message (rendered as a voice-note player). */
  voice?: boolean;
  /** Length of audio in ms, when known (MediaRecorder output has no duration). */
  durationMs?: number;
}

/** A reaction to an earlier message. `emoji: null` removes the sender's reaction. */
export interface ReactionRef {
  target: string;
  emoji: string | null;
}

export const POLL_MAX_OPTIONS = 12;
export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 100;

/** A poll. Votes are separate ratcheted `vote` messages, like reactions. */
export interface PollRef {
  question: string;
  options: string[];
  /** May a voter pick more than one option? */
  multi: boolean;
}

/** The sender's current choices (option indexes). An empty list retracts the vote. */
export interface VoteRef {
  target: string;
  choices: number[];
}

/** Replaces the text of the author's earlier message. `body` is the new text. */
export interface EditRef {
  target: string;
}

export const EDIT_BODY_MAX = 8000;

export type EnvelopeKind = "text" | "file" | "reaction" | "poll" | "vote" | "edit";

export interface MessageEnvelope {
  v: 1;
  kind: EnvelopeKind;
  body: string;
  replyTo?: ReplyRef;
  attachment?: AttachmentRef;
  reaction?: ReactionRef;
  poll?: PollRef;
  vote?: VoteRef;
  edit?: EditRef;
  /** True when this message was forwarded from another chat. */
  forwarded?: boolean;
}

export function encodeEnvelope(e: MessageEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(e));
}

const KINDS: readonly string[] = ["text", "file", "reaction", "poll", "vote", "edit"];

export function decodeEnvelope(bytes: Uint8Array): MessageEnvelope {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as MessageEnvelope;
  if (parsed?.v !== 1 || !KINDS.includes(parsed.kind)) {
    throw new Error("Unsupported message envelope");
  }
  if (parsed.kind === "reaction") {
    const r = parsed.reaction;
    if (!r || typeof r.target !== "string" || (r.emoji !== null && typeof r.emoji !== "string")) {
      throw new Error("Malformed reaction");
    }
    if (r.emoji !== null && r.emoji.length > 16) throw new Error("Malformed reaction");
  }
  if (parsed.kind === "poll") {
    const p = parsed.poll;
    if (
      !p ||
      typeof p.question !== "string" ||
      !Array.isArray(p.options) ||
      p.options.length < 2 ||
      p.options.length > POLL_MAX_OPTIONS ||
      p.options.some((o) => typeof o !== "string") ||
      typeof p.multi !== "boolean"
    ) {
      throw new Error("Malformed poll");
    }
  }
  if (parsed.kind === "vote") {
    const v = parsed.vote;
    if (
      !v ||
      typeof v.target !== "string" ||
      !Array.isArray(v.choices) ||
      v.choices.length > POLL_MAX_OPTIONS ||
      v.choices.some((n) => !Number.isInteger(n) || n < 0 || n >= POLL_MAX_OPTIONS)
    ) {
      throw new Error("Malformed vote");
    }
  }
  if (parsed.kind === "edit") {
    if (
      !parsed.edit ||
      typeof parsed.edit.target !== "string" ||
      typeof parsed.body !== "string" ||
      parsed.body.length > EDIT_BODY_MAX
    ) {
      throw new Error("Malformed edit");
    }
  }
  if (parsed.forwarded !== undefined && typeof parsed.forwarded !== "boolean") {
    throw new Error("Malformed forward flag");
  }
  return parsed;
}
