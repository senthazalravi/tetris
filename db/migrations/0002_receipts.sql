-- When a message was delivered to / read by the recipient (shown in "Message info").
ALTER TABLE messages ADD COLUMN delivered_at INTEGER;
ALTER TABLE messages ADD COLUMN read_at INTEGER;
