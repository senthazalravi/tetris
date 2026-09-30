import type { ConversationId, DeliveryState, MessageId } from "@lop/types";

export type ClientToServer =
  | { type: "auth"; sessionToken: string; deviceId: string }
  | {
      type: "message.send";
      conversationId: ConversationId;
      messageId: MessageId;
      communicationEpoch: number;
      cryptoHeader: string;
      ciphertext: string;
      clientSentAt: number;
    }
  | { type: "message.ack"; messageId: MessageId; state: DeliveryState }
  | { type: "typing.start"; conversationId: ConversationId }
  | { type: "typing.stop"; conversationId: ConversationId }
  | { type: "presence.ping" };

export type ServerToClient =
  | {
      type: "message.new";
      conversationId: ConversationId;
      messageId: MessageId;
      senderUserId: string;
      cryptoHeader: string;
      ciphertext: string;
      createdAt: number;
      expiresAt: number;
    }
  | { type: "message.delivered"; messageId: MessageId }
  | { type: "message.read"; messageId: MessageId }
  | { type: "message.expired"; messageId: MessageId; conversationId: ConversationId }
  | { type: "wipe.completed"; toEpoch: number }
  | { type: "session.revoked" }
  | { type: "typing.start"; conversationId: ConversationId; userId: string }
  | { type: "typing.stop"; conversationId: ConversationId; userId: string }
  | { type: "presence.update"; userId: string; online: boolean }
  | { type: "error"; code: string; message: string };
