export type UserId = string;
export type DeviceId = string;
export type ConversationId = string;
export type MessageId = string;

export interface PublicUserCard {
  userId: UserId;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  identityKeyFingerprint: string | null;
}

export interface SessionUser {
  id: UserId;
  username: string;
  displayName: string;
  email: string;
  communicationEpoch: number;
}

export type UnlockOutcome = "SUCCESS" | "WRONG" | "TIMEOUT" | "ABANDONED";

export type DeliveryState = "accepted" | "delivered" | "read";

export type WipeReason = "WRONG_PASSCODE" | "TIMEOUT" | "MANUAL";
