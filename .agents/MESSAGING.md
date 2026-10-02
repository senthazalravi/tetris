# Messaging and expiry

## Send (direct)

1. Ensure an E2EE session exists (create via key bundle if needed).
2. Encrypt plaintext in the client.
3. Send ciphertext + crypto header + message id + epoch. Invisible carriers (reactions, edits, votes) are sent with `notify: false`.
4. Server sets `created_at`, `expires_at = created_at + 24h`.

## Send (group)

- The client encrypts the same envelope separately for every member's active device (pairwise Double Ratchet sessions) and posts all copies in one request: `POST /conversations/:id/group-messages`.
- The server stores one row per recipient plus one sender row that carries the aggregate receipt. `expires_at = created_at + 7 days`.
- Attachments are encrypted once; the key travels inside every copy.
- Members who have never signed in have no keys yet and are skipped.
- `@username` mentions are plain text inside the encrypted body; the client highlights them.

## Receive

- Online: Durable Object / WebSocket push, plus a once-a-minute fallback sync.
- Offline: queue; on sync return **only** `expires_at > now`.
- On arrival the client plays a chime and, if the tab is in the background and permission was granted, shows a notification naming only the sender or group.

## Unread email digests

- A message counts after it has stayed unread for 3 minutes. One digest per person per 15 minutes, capped at 90 a day.
- The email lists counts and sender or group names, never text.

## Expiry

- Mandatory for all messages and attachments: 24 hours for direct chats, 7 days for groups.
- Not based on read time.
- Lazy filter on every read + cron deletion of database rows and stored files.
- The client shows countdowns as UX only; the server is the authority.

## Features

- Text, emoji, reply, links, reactions, edits, polls
- Image, video, audio, voice notes, PDF, generic file (encrypted)
- Delivery / read ticks, typing indicator (direct chats only)
- Group chats with @mentions

## Not supported

- Calls, server-side plaintext search, backups, blocking.

## Agent checklist

- [ ] No plaintext column or log field
- [ ] Epoch validated on write
- [ ] Expired messages never returned
- [ ] Attachment plaintext never uploaded
- [ ] Emails and notifications never contain message text
