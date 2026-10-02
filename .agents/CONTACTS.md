# Discovery: search, people and groups

## Who can be found

- Accounts are predefined by an administrator. There is no sign-up and no invite flow.
- Groups are predefined too (see `groups.example.json`). Only members see a group.

## Search

`GET /users/search?q=ra`

- Case-insensitive substring match on usernames; usernames that start with the text come first.
- Also returns the caller's groups whose name matches, as `groups`.
- Never returns the caller, never accepts wildcards, returns at most 8 users and 5 groups, and is rate-limited.
- Locked in the client until a Tetris round has ended. `Ctrl+K` or `Cmd+K` focuses the search bar.

Public fields only: userId, username, displayName, avatar.

## Contact list privacy

- `GET /contacts` returns **only** `owner_user_id = current user`.
- There is no block feature.
- A wipe clears the user's contacts; group membership is permanent and survives a wipe.

## UI expectations

- No sidebar, chat list or unread counters. The search bar is the only way to open a chat.
- Picking a result opens the chat in a panel beside the game.

## Agent checklist

- [ ] Search never lists the caller or returns more than a handful of matches
- [ ] Wildcards in the query are escaped
- [ ] Groups are only returned to their members
- [ ] Wipe clears contacts for that user
