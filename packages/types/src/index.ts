export type UserId = string;
export type DeviceId = string;
export type ConversationId = string;
export type MessageId = string;

export type DeliveryState = "accepted" | "delivered" | "read";

export type WipeReason = "WRONG_PASSCODE" | "TIMEOUT" | "MANUAL";

export interface SessionUser {
  id: UserId;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  communicationEpoch: number;
}

export interface PublicUserCard {
  userId: UserId;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ContactDto extends PublicUserCard {
  blocked: boolean;
  createdAt: number;
}

export interface ConversationPeer extends PublicUserCard {
  /** Peer's currently active device; null until they finish vault setup. */
  deviceId: DeviceId | null;
  identityKey: string | null;
  signingKey: string | null;
}

export interface GroupInfo {
  name: string;
  /** Every member, including the caller. */
  members: ConversationPeer[];
}

export interface ConversationDto {
  id: ConversationId;
  /** For a group this is a stand-in carrying the group name. */
  peer: ConversationPeer;
  lastMessageAt: number;
  blocked: boolean;
  /** Present only for group conversations. */
  group?: GroupInfo;
}

/** One encrypted copy of a group message, addressed to a single member. */
export interface GroupCopy {
  recipientUserId: UserId;
  recipientDeviceId: DeviceId;
  cryptoHeader: string;
  ciphertext: string;
}

/** One row of the incremental sync feed. */
export interface SyncMessage {
  /** Row id: the sync cursor and receipts use this. */
  id: MessageId;
  /** Stable message id shared by every copy of a group message (equals `id` for direct chats). */
  messageId: MessageId;
  conversationId: ConversationId;
  senderUserId: UserId;
  senderDeviceId: DeviceId;
  /** Present only when the caller is the recipient. */
  cryptoHeader: string | null;
  ciphertext: string | null;
  attachmentId: string | null;
  direction: "in" | "out";
  state: DeliveryState;
  deleted: boolean;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  /** Outgoing messages only: when the recipient's device received / read it. */
  deliveredAt: number | null;
  readAt: number | null;
}

export interface SyncResponse {
  serverTime: number;
  messages: SyncMessage[];
  hasMore: boolean;
}

export interface ChallengeDto {
  id: string;
  /** Milliseconds left on the server clock at response time. */
  remainingMs: number;
  vaultSalt: string;
}

export type RealtimeEvent =
  | { type: "message.new"; conversationId: ConversationId }
  | { type: "message.state"; conversationId: ConversationId }
  | { type: "message.deleted"; conversationId: ConversationId; messageId: MessageId }
  | { type: "conversation.refresh" }
  | { type: "typing"; conversationId: ConversationId; userId: UserId; active: boolean }
  | { type: "wipe.completed" }
  | { type: "session.revoked" };
