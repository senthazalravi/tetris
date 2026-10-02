# Tetris

A private, end-to-end encrypted messenger hidden inside a game of Tetris. You sign in with a username and an 8-digit passcode, land on a playable Tetris board, and finish a round to unlock search. Pick a person or a group and the chat opens beside the game.

Developed by [Manas Dutta](https://www.manasdutta.com/).

## Features

- **End-to-end encryption** for text, replies, reactions, edits, polls, voice notes and files. Everything is sealed in the browser before it is sent.
- **Sign in with a username and an 8-digit passcode.** There is no account password and no sign-up screen. Accounts are created by an administrator.
- **One attempt, 30 seconds.** Every time you open the app you get one try at your passcode. A wrong or late attempt clears your chats and contacts on that browser and expires the passcode.
- **Forgot your passcode?** Confirm the email on file, then choose a new one. No email link is involved.
- **Tetris home screen.** Play a round and the search bar unlocks. Score, lines, next piece and the controls sit in a panel beside the board.
- **Search to chat.** Press `Ctrl+K` (Windows, Linux) or `Cmd+K` (macOS), or click the search bar, and type part of a username or a group name. Matches appear as you type.
- **Chat beside the game.** Opening a chat slides the game to the left and shows the conversation on the right. Press `Esc` or the close button to go back to the game.
- **Groups.** Predefined groups are end-to-end encrypted: each message is sealed separately for every member. Members can send text, attachments, voice notes, polls and reactions.
- **@mentions in groups.** Type `@` and a few letters to pick a member. Mentions are highlighted in the message.
- **Messages vanish.** Direct messages and files disappear after 24 hours. Group messages and files last 7 days.
- **Email notifications.** If you have unread messages after a few minutes, you get one short email that says how many messages arrived and from whom (a person or a group). The email never shows the messages themselves.
- **Install as an app.** In Chrome, Edge or Brave an **Install app** button appears next to the theme toggle. It adds Tetris to your desktop or home screen and opens it in its own window, like any web app.
- **Sound and desktop notifications.** A clear chime plays for new messages. Turn on desktop notifications from your profile to be told who wrote while Tetris is in the background.
- Delivery and read ticks, typing indicators, nicknames, delete for me or for everyone, photos, documents, audio (up to 90 MB) and video (up to 16 MB).
- Light and dark themes.

## How to use

1. Open the app and enter your username and passcode within 30 seconds.
2. Play Tetris. When a round ends, the search bar unlocks.
3. Search for a person or a group and select it. The chat opens on the right.
4. Switch to someone else at any time by searching again.
5. Open your profile (top left) to change your passcode, set a display name and avatar, or turn on desktop notifications.

Game controls: arrow keys to move, rotate and soft drop, `Space` for a hard drop, `P` to pause. On phones there are on-screen buttons.

## Run locally

Requires **Node.js 20+**.

```bash
git clone https://github.com/manasdutta04/tetris.git
cd tetris
npm install
cp workers/api/.dev.vars.example workers/api/.dev.vars
npm run db:migrate:local
```

Create your users and groups. These files stay on your machine and are never committed:

```bash
cp users.example.json users.local.json     # username, email, 8-digit passcode per user
cp groups.example.json groups.local.json   # group name and member usernames
npm run users:seed
npm run groups:seed
```

Start the API and the web app in two terminals:

```bash
npm run dev:api          # API on http://127.0.0.1:8787
npm run dev              # web on http://localhost:5173
```

Open http://localhost:5173 and sign in with one of your users. Use two browsers or profiles to chat between two accounts.

To start over with a clean list of users, run `npm run users:seed -- --replace` and then `npm run groups:seed`.

### Email notifications

Notification emails are sent through [Resend](https://resend.com). They are off until you add these to `workers/api/.dev.vars`:

```bash
RESEND_API_KEY=your-resend-api-key
MAIL_FROM=Tetris <notify@your-verified-domain>
```

To try the flow without sending anything, set `MAIL_DRY_RUN=true`. The digest is then printed in the API log instead of being emailed.

An email is sent only when a message has stayed unread for 3 minutes, at most once every 15 minutes per person, and never more than 90 a day.

### Checks

```bash
npm run typecheck
npm test
npm run test:e2e         # needs the API running; takes a few minutes
```

## Workspace

```text
apps/web          React client (game, chat, search, install)
workers/api       API, realtime gateway, scheduled cleanup and email digests
packages/crypto   Argon2id, X3DH, Double Ratchet, file crypto
packages/protocol Message envelope types
packages/types    Shared types
packages/config   Shared constants
db/migrations     Database schema
scripts           User and group seeding, icon generation, e2e tests
```

## Security summary

| Piece | What happens |
| --- | --- |
| Passcode | Never sent. It derives a local key that seals your data in the browser; the server stores only a verifier hash |
| Messages | Signal-style X3DH and Double Ratchet with AES-256-GCM. The server holds ciphertext and routing details only |
| Groups | Each message is encrypted once per member using the same pairwise sessions |
| Attachments | A random key per file; the key travels inside the encrypted message |
| Sessions | A cookie alone never unlocks chats; a per-tab key held in memory is required after unlock |
| Emails | Contain counts and sender or group names only, never message text |

More detail and how to report issues: [SECURITY.md](./SECURITY.md).

## Good to know

- Only the browser that last unlocked an account can wipe it by failing or abandoning the unlock. Any other browser gets a rate-limited failure.
- The Tetris screen is a design choice, not a security control: your chats are already unlocked in memory while you play.
- An 8-digit passcode is short, so the one-attempt rule and rate limits are what protect it.
- One device is unlocked per account. Signing in somewhere else takes over your keys.
- A forgotten passcode cannot be recovered. After it expires, anyone who knows a username and its email can set a new one, and the chats are already wiped by then.
- A group member who has never signed in has no keys yet, so they miss messages sent before their first sign-in.
- Other people may keep copies of messages until they expire.
