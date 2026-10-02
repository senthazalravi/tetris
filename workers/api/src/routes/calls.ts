import { Hono } from "hono";
import type { CallSignalKind } from "@tetris/types";
import { requireUnlocked, type AppEnv } from "../lib/session";
import { hit } from "../lib/ratelimit";
import { pushToUser } from "../lib/push";

/**
 * One-to-one voice calls. The audio itself flows browser to browser over
 * WebRTC (encrypted with DTLS-SRTP); this route only relays the small setup
 * messages (offer, answer, ICE candidates, hang-up) to the other person's open
 * tabs. It stores nothing.
 */
export const callRoutes = new Hono<AppEnv>();

const CALL_ID = /^call_[a-f0-9]{32}$/;
const KINDS: readonly CallSignalKind[] = [
  "offer",
  "answer",
  "candidate",
  "decline",
  "busy",
  "hangup",
];
/** Largest accepted payload per kind (JSON bytes). Candidates are tiny; SDP is a few KB. */
const MAX_DATA: Record<CallSignalKind, number> = {
  offer: 16_384,
  answer: 16_384,
  candidate: 2_048,
  decline: 0,
  busy: 0,
  hangup: 0,
};

/** Free public STUN servers. A TURN relay is added only if the operator configures one. */
const STUN = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"];

callRoutes.get("/calls/ice", requireUnlocked, (c) => {
  const iceServers: Array<{
    urls: string[];
    username?: string;
    credential?: string;
  }> = [{ urls: STUN }];
  const turn = (c.env.TURN_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (turn.length && c.env.TURN_USERNAME && c.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: turn,
      username: c.env.TURN_USERNAME,
      credential: c.env.TURN_CREDENTIAL,
    });
  }
  return c.json({ iceServers });
});

callRoutes.post("/calls/signal", requireUnlocked, async (c) => {
  const me = c.get("user");
  if (!(await hit(c.env, `callsig:${me.id}`, 240, 60_000))) {
    return c.json({ error: "Too many call messages" }, 429);
  }
  const body = await c.req
    .json<{ to?: string; callId?: string; kind?: string; data?: unknown }>()
    .catch(
      () =>
        ({}) as { to?: string; callId?: string; kind?: string; data?: unknown },
    );

  const kind = body.kind as CallSignalKind;
  if (
    !body.to ||
    typeof body.to !== "string" ||
    body.to === me.id ||
    !body.callId ||
    !CALL_ID.test(body.callId) ||
    !KINDS.includes(kind)
  ) {
    return c.json({ error: "Invalid call message" }, 400);
  }
  const size = body.data === undefined ? 0 : JSON.stringify(body.data).length;
  if (size > MAX_DATA[kind])
    return c.json({ error: "Call message too large" }, 413);

  // New calls are limited separately so nobody can ring someone over and over.
  if (
    kind === "offer" &&
    !(await hit(c.env, `callstart:${me.id}`, 10, 60_000))
  ) {
    return c.json(
      { error: "You are calling too often. Try again in a minute." },
      429,
    );
  }

  // Only people who share a direct chat can call each other.
  const [a, b] = me.id < body.to ? [me.id, body.to] : [body.to, me.id];
  const chat = await c.env.DB.prepare(
    `SELECT 1 AS x FROM conversations WHERE kind = 'dm' AND user_a = ? AND user_b = ?`,
  )
    .bind(a, b)
    .first();
  if (!chat)
    return c.json(
      { error: "You can only call someone you have a chat with" },
      403,
    );

  const delivered = await pushToUser(c.env, body.to, {
    type: "call.signal",
    from: me.id,
    callId: body.callId,
    kind,
    ...(body.data === undefined ? {} : { data: body.data }),
  });
  return c.json({ ok: true, delivered });
});
