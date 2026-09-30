import { Hono } from "hono";
import type { Env } from "../env";
import {
  loadSessionUser,
  readSessionToken,
  type AppVars,
} from "../lib/session";
import { randomId } from "../lib/crypto";

export const deviceRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

function b64Encode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function b64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function authed(c: {
  env: Env;
  req: { header: (n: string) => string | undefined };
}) {
  const token = readSessionToken(c as never);
  if (!token) return null;
  return loadSessionUser(c.env, token);
}

deviceRoutes.post("/devices", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{
    identityPublicKey?: string;
    signedPrekeyId?: number;
    signedPrekeyPublicKey?: string;
  }>();

  if (!body.identityPublicKey || !body.signedPrekeyPublicKey || !body.signedPrekeyId) {
    return c.json({ error: "Missing key material" }, 400);
  }

  const now = Date.now();
  const deviceId = randomId("dev");
  const identity = b64Decode(body.identityPublicKey);
  const signed = b64Decode(body.signedPrekeyPublicKey);

  await c.env.DB.prepare(
    `INSERT INTO devices (id, user_id, identity_public_key, signing_public_key, created_at, last_seen_at, revoked_at, communication_epoch)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      deviceId,
      loaded.user.id,
      identity,
      signed,
      now,
      now,
      loaded.user.communication_epoch,
    )
    .run();

  const prekeyId = randomId("pk");
  await c.env.DB.prepare(
    `INSERT INTO prekeys (id, device_id, key_id, public_key, signature, kind, consumed_at)
     VALUES (?, ?, ?, ?, NULL, 'signed', NULL)`,
  )
    .bind(prekeyId, deviceId, body.signedPrekeyId, signed)
    .run();

  return c.json({ deviceId }, 201);
});

deviceRoutes.get("/users/:userId/key-bundle", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const userId = c.req.param("userId");
  const device = await c.env.DB.prepare(
    `SELECT id, identity_public_key, communication_epoch FROM devices
     WHERE user_id = ? AND revoked_at IS NULL
     ORDER BY last_seen_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{
      id: string;
      identity_public_key: ArrayBuffer;
      communication_epoch: number;
    }>();

  if (!device) return c.json({ error: "No device keys published" }, 404);

  const signed = await c.env.DB.prepare(
    `SELECT key_id, public_key FROM prekeys
     WHERE device_id = ? AND kind = 'signed' AND consumed_at IS NULL
     ORDER BY key_id DESC LIMIT 1`,
  )
    .bind(device.id)
    .first<{ key_id: number; public_key: ArrayBuffer }>();

  if (!signed) return c.json({ error: "No signed prekey" }, 404);

  return c.json({
    userId,
    deviceId: device.id,
    identityPublicKey: b64Encode(device.identity_public_key),
    signedPrekeyId: signed.key_id,
    signedPrekeyPublicKey: b64Encode(signed.public_key),
    communicationEpoch: device.communication_epoch,
  });
});
