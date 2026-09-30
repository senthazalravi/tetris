# Messaging and 24-hour expiry

## Send

1. Ensure E2EE session exists (create via key bundle if needed).  
2. Encrypt plaintext in client / crypto worker.  
3. Send ciphertext + crypto header + message id + epoch.  
4. Server sets `created_at`, `expires_at = created_at + 24h`.  

## Receive

- Online: Durable Object / WS push.  
- Offline: queue; on sync return **only** `expires_at > now`.  

## Expiry

- Mandatory for all messages and attachments.  
- Not based on read time.  
- Lazy filter on every read + cron deletion of D1 rows and R2 objects.  
- Client shows countdown as UX only; server is authority.

## Features (MVP)

- Text, emoji, reply, links  
- Image, video, PDF, generic file (encrypted)  
- Delivery / read ticks  
- Typing indicator  

## Not MVP

- Groups, reactions, edit, voice notes, calls, server-side plaintext search, backups.

## Agent checklist

- [ ] No plaintext column or log field
- [ ] Epoch validated on write
- [ ] Expired messages never returned
- [ ] Attachment plaintext never uploaded
