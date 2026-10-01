# Contacts and discovery

## WhatsApp mapping

| WhatsApp | Tetris |
|---|---|
| Save phone number | Save exact `@username` / user id |
| Address book sync | Manual add + chat list only |
| See only your contacts/chats | Same — no global directory |
| Start chat with a number | Start chat after exact lookup match |

## Exact lookup only

`GET /users/lookup?username=alice`

- Case-insensitive **exact** match.
- `200` public card or `404`.
- Never implement prefix search, suggestions, or “list users” admin UI in MVP client.

Public card fields only: userId, username, displayName, avatar, identity fingerprint.

## Contact list privacy

- `GET /contacts` returns **only** `owner_user_id = current user`.
- Adding a contact does not publish your list to anyone.
- Blocking is per-owner and must stop message delivery / typing / presence as designed.

## UI expectations

- Empty: “No contacts yet”.
- New chat: search box for exact user ID + list of existing contacts.
- Sidebar chat list: conversations for this user/epoch only.

## Agent checklist

- [ ] No API that enumerates all users
- [ ] Lookup is exact
- [ ] Contact rows keyed by owner
- [ ] Wipe clears contacts for that user
