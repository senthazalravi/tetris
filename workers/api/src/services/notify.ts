import type { Env } from "../env";
import { hit } from "../lib/ratelimit";

/**
 * "You have new messages" emails. The server cannot read messages, so this
 * works from metadata only: who sent how many unread messages to whom. The
 * email names senders or groups and counts, and never includes any text.
 *
 * Runs from the once-a-minute cron. A message is only counted once it has sat
 * unread for NOTIFY_GRACE_MS, and each person gets at most one digest per
 * NOTIFY_MIN_GAP_MS. Global caps keep us under Resend's free tier
 * (100 a day, 3,000 a month).
 */

export const NOTIFY_GRACE_MS = 3 * 60_000;
export const NOTIFY_MIN_GAP_MS = 15 * 60_000;
const MAX_PER_RUN = 10;
const DAILY_CAP = 90;
const MONTHLY_CAP = 2_800;
const DAY_MS = 24 * 60 * 60_000;

export interface DigestLine {
  kind: "dm" | "group";
  /** Sender's name for a direct chat, the group's name for a group. */
  label: string;
  count: number;
}

export interface DigestInput {
  recipientName: string;
  recipientUsername: string;
  lines: DigestLine[];
  appUrl: string;
}

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Subject, plain text and HTML for one digest. Pure, so it is easy to test. */
export function composeDigest(input: DigestInput): { subject: string; text: string; html: string } {
  const total = input.lines.reduce((n, l) => n + l.count, 0);
  const parts = input.lines.map((l) =>
    l.kind === "group"
      ? `${plural(l.count, "message", "messages")} in ${l.label}`
      : `${plural(l.count, "message", "messages")} from ${l.label}`,
  );
  const subject = `@${input.recipientUsername}: ${plural(total, "new message", "new messages")} on Tetris`;
  const intro = `Hi ${input.recipientName}, you have ${plural(total, "unread message", "unread messages")}.`;
  const cta = "Open Tetris to read them. For your privacy, the messages themselves are never sent by email.";

  const text = [intro, "", ...parts.map((p) => `- ${p}`), "", cta, input.appUrl].join("\n");
  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#141413">`,
    `<p>${esc(intro)}</p>`,
    `<ul>${parts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`,
    `<p>${esc(cta)}</p>`,
    `<p><a href="${esc(input.appUrl)}" style="color:#b4532f">Open Tetris</a></p>`,
    `<p style="color:#6b6a64;font-size:12px">Sent for @${esc(input.recipientUsername)}.</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}

async function sendEmail(
  env: Env,
  to: string,
  mail: { subject: string; text: string; html: string },
  who: string,
): Promise<boolean> {
  if (env.MAIL_DRY_RUN === "true") {
    console.log(`notify (dry run) for @${who}: ${mail.subject}`);
    console.log(mail.text);
    return true;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });
  if (!res.ok) {
    console.warn(`notify: Resend rejected the email for @${who} (${res.status})`);
  }
  return res.ok;
}

/** Find people with long-unread messages and mail each one a digest. */
export async function sweepNotifications(env: Env): Promise<number> {
  const live = env.MAIL_DRY_RUN === "true" || Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
  if (!live) return 0;

  const now = Date.now();
  const cutoff = now - NOTIFY_GRACE_MS;

  // One digest per recipient, built from their (conversation, sender) groups.
  const perUser = new Map<string, Array<{ cid: string; sid: string; n: number }>>();
  const detail = await env.DB.prepare(
    `SELECT m.recipient_user_id AS uid, m.conversation_id AS cid, m.sender_user_id AS sid, COUNT(*) AS n
     FROM messages m
     JOIN users u ON u.id = m.recipient_user_id
     WHERE m.notified_at IS NULL AND m.recipient_user_id != '' AND m.deleted_at IS NULL
       AND m.notify = 1 AND m.delivery_state != 'read'
       AND m.created_at <= ?1 AND m.expires_at > ?2
       AND (u.last_notified_at IS NULL OR u.last_notified_at <= ?3)
     GROUP BY m.recipient_user_id, m.conversation_id, m.sender_user_id`,
  )
    .bind(cutoff, now, now - NOTIFY_MIN_GAP_MS)
    .all<{ uid: string; cid: string; sid: string; n: number }>();
  for (const r of detail.results ?? []) {
    const list = perUser.get(r.uid) ?? [];
    list.push({ cid: r.cid, sid: r.sid, n: r.n });
    perUser.set(r.uid, list);
  }
  if (perUser.size === 0) return 0;

  const convIds = [...new Set([...perUser.values()].flat().map((r) => r.cid))];
  const senderIds = [...new Set([...perUser.values()].flat().map((r) => r.sid))];
  const marks = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `?${i + from}`).join(",");
  const convs = new Map(
    (
      await env.DB.prepare(`SELECT id, kind, name FROM conversations WHERE id IN (${marks(convIds.length)})`)
        .bind(...convIds)
        .all<{ id: string; kind: string; name: string | null }>()
    ).results?.map((c) => [c.id, c]) ?? [],
  );
  const senders = new Map(
    (
      await env.DB.prepare(`SELECT id, display_name FROM users WHERE id IN (${marks(senderIds.length)})`)
        .bind(...senderIds)
        .all<{ id: string; display_name: string }>()
    ).results?.map((u) => [u.id, u.display_name]) ?? [],
  );

  let sent = 0;
  for (const [uid, groups] of perUser) {
    if (sent >= MAX_PER_RUN) break;
    // Stay under Resend's free limits no matter how busy the chats are.
    if (!(await hit(env, "email:day", DAILY_CAP, DAY_MS))) break;
    if (!(await hit(env, "email:month", MONTHLY_CAP, 30 * DAY_MS))) break;

    const user = await env.DB.prepare(
      `SELECT username, display_name, email FROM users WHERE id = ?`,
    )
      .bind(uid)
      .first<{ username: string; display_name: string; email: string | null }>();
    if (!user?.email) continue;

    // Group chats collapse to one line; direct chats list each sender.
    const lines = new Map<string, DigestLine>();
    for (const g of groups) {
      const conv = convs.get(g.cid);
      if (conv?.kind === "group") {
        const key = `g:${g.cid}`;
        const cur = lines.get(key) ?? { kind: "group" as const, label: conv.name ?? "a group", count: 0 };
        cur.count += g.n;
        lines.set(key, cur);
      } else {
        const key = `d:${g.sid}`;
        const cur =
          lines.get(key) ?? { kind: "dm" as const, label: senders.get(g.sid) ?? "someone", count: 0 };
        cur.count += g.n;
        lines.set(key, cur);
      }
    }
    const mail = composeDigest({
      recipientName: user.display_name,
      recipientUsername: user.username,
      lines: [...lines.values()],
      appUrl: env.APP_ORIGIN ?? "https://tetris.manasdutta512.workers.dev",
    });

    const ok = await sendEmail(env, user.email, mail, user.username);
    const stamp = env.DB.prepare(`UPDATE users SET last_notified_at = ? WHERE id = ?`).bind(now, uid);
    if (ok) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE messages SET notified_at = ?1
           WHERE recipient_user_id = ?2 AND notified_at IS NULL AND notify = 1
             AND delivery_state != 'read' AND created_at <= ?3`,
        ).bind(now, uid, cutoff),
        stamp,
      ]);
      sent += 1;
    } else {
      // A rejected address is retried at most once per gap, never in a tight loop.
      await stamp.run();
    }
  }
  return sent;
}
