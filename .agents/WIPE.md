# Communication wipe

## Triggers

| Event | Wipe? |
|---|---|
| Correct vault passcode within 30s | **No** |
| Wrong passcode (single attempt) | **Yes** |
| Timeout / abandoned challenge | **Yes** |
| Explicit future “panic wipe” control | Optional later; same pipeline |

## Survives

Account id, username, display name, avatar, auth session (as designed).

## Destroyed

Contacts, conversations membership, messages, attachments, local IndexedDB chat/crypto vault material for old epoch, offline queues for old epoch.

## Mechanism

1. Increment `communication_epoch`.  
2. Delete or invalidate data bound to previous epoch.  
3. Notify connected clients `wipe.completed`.  
4. Client runs local wipe checklist and shows empty WhatsApp-like shell.

## Peer copies

Do **not** remotely erase the other person’s device. Their copies expire via 24h TTL. They may see session/identity change signals when you re-key after wipe.

## Agent checklist

- [ ] Idempotent wipe operation id  
- [ ] Multi-tab: BroadcastChannel + WS revoke  
- [ ] In-flight uploads cancelled/deleted  
- [ ] UI copy warns wipe is permanent  
- [ ] Security events logged without message content  
