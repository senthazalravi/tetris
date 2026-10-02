-- A group is gated by a short code. Every member starts as 'pending'; the first
-- time they open the group they get 30 seconds and two tries. A right code makes
-- them 'granted' for good; running out of tries or time makes them 'denied' for
-- good, and the group never shows up for them again.

ALTER TABLE group_members ADD COLUMN access TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE group_members ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE group_members ADD COLUMN unlock_started_at INTEGER;

-- PBKDF2 hash of the group's code (set by the seed script, never the code itself).
ALTER TABLE conversations ADD COLUMN access_code_hash TEXT;

-- Until someone enters the code they must not sync, send or upload in the group.
DELETE FROM conversation_members
WHERE conversation_id IN (SELECT id FROM conversations WHERE kind = 'group');
