-- Unread-message email digests. The server never sees message text, so this only
-- tracks who has unread messages and whether they have already been told.

-- 1 when this message should count toward a notification. Reactions, edits and
-- poll votes are invisible carrier messages and are sent with 0.
ALTER TABLE messages ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;
-- Set once the message has been included in a digest email.
ALTER TABLE messages ADD COLUMN notified_at INTEGER;
-- Limits each person to one digest per 15 minutes.
ALTER TABLE users ADD COLUMN last_notified_at INTEGER;

CREATE INDEX idx_messages_notify ON messages(notified_at, delivery_state, created_at);
