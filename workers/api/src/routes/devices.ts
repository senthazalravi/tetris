import { Hono } from "hono";
import { ONE_TIME_PREKEY_LOW_WATER } from "@tetris/config";
import { requireUnlocked, type AppEnv } from "../lib/session";
import { hit } from "../lib/ratelimit";
import { pushToUser } from "../lib/push";
import { b64Decode, isBase64, randomId } from "../lib/util";

export const deviceRoutes = new Hono<AppEnv>();

const MAX_ONE_TIME = 100;

function keyOk(v: unknown, bytes: number): v is string {
  if (!isBase64(v, bytes)) return false;
  try {
    return b64Decode(v).length === bytes;
  } catch {
    return false;
  }
}

interface UploadBody {
  identityKey?: string;
  signingKey?: string;
  signedPrekey?: { id?: number; publicKey?: string; signature?: string };
  oneTimePrekeys?: { id?: number; publicKey?: string }[];
}

function validOneTime(list: unknown): list is { id: number; publicKey: string }[] {
  return (
    Array.isArray(list) &&
    list.length <= MAX_ONE_TIME &&
    list.every(
      (p) =>
        p &&
        Number.isInteger(p.id) &&
        p.id > 0 &&
        keyOk(p.publicKey, 32),
    )
  );
}

/** Register this browser as the account's single active device. */
deviceRoutes.post("/devices", requireUnlocked, async (c) => {
  const user = c.get("user");
  if (!(await hit(c.env, `device:${user.id}`, 10, 60 * 60_000))) {
    return c.json({ error: "Too many device registrations" }, 429);
  }
  const body = await c.req.json<UploadBody>().catch(() => ({}) as UploadBody);
  const spk = body.signedPrekey;
  if (
    !keyOk(body.identityKey, 32) ||
    !keyOk(body.signingKey, 32) ||
    !spk ||
    !Number.isInteger(spk.id) ||
    !keyOk(spk.publicKey, 32) ||
    !keyOk(spk.signature, 64) ||
    !validOneTime(body.oneTimePrekeys)
  ) {
    return c.json({ error: "Malformed key bundle" }, 400);
  }

  const deviceId = randomId("dev");
  const now = Date.now();
  const stmts = [
    c.env.DB.prepare(
      `DELETE FROM prekeys WHERE device_id IN (SELECT id FROM devices WHERE user_id = ? AND revoked_at IS NULL)`,
    ).bind(user.id),
    c.env.DB.prepare(
      `UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(now, user.id),
    c.env.DB.prepare(
      `INSERT INTO devices (id, user_id, identity_key, signing_key, spk_id, spk_public, spk_signature, communication_epoch, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      deviceId,
      user.id,
      body.identityKey,
      body.signingKey,
      spk.id,
      spk.publicKey,
      spk.signature,
      user.communication_epoch,
      now,
    ),
    ...body.oneTimePrekeys.map((p) =>
      c.env.DB.prepare(
        `INSERT INTO prekeys (device_id, key_id, public_key) VALUES (?, ?, ?)`,
      ).bind(deviceId, p.id, p.publicKey),
    ),
  ];
  // Tell any other open browser it has just been replaced (one device per account).
  await pushToUser(c.env, user.id, { type: "session.revoked" });
  await c.env.DB.batch(stmts);
  return c.json({ deviceId }, 201);
});

/** Is my locally stored device still the active one, and how many prekeys remain? */
deviceRoutes.get("/devices/:id/status", requireUnlocked, async (c) => {
  const user = c.get("user");
  const dev = await c.env.DB.prepare(
    `SELECT id FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  )
    .bind(c.req.param("id"), user.id)
    .first();
  if (!dev) return c.json({ active: false, oneTimePrekeys: 0, needsPrekeys: false });
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM prekeys WHERE device_id = ?`,
  )
    .bind(dev.id as string)
    .first<{ n: number }>();
  const n = row?.n ?? 0;
  return c.json({
    active: true,
    oneTimePrekeys: n,
    needsPrekeys: n < ONE_TIME_PREKEY_LOW_WATER,
  });
});

deviceRoutes.post("/devices/:id/prekeys", requireUnlocked, async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("id");
  const dev = await c.env.DB.prepare(
    `SELECT id FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  )
    .bind(deviceId, user.id)
    .first();
  if (!dev) return c.json({ error: "Unknown device" }, 404);
  const body = await c.req
    .json<{ oneTimePrekeys?: unknown }>()
    .catch(() => ({}) as { oneTimePrekeys?: unknown });
  if (!validOneTime(body.oneTimePrekeys) || body.oneTimePrekeys.length === 0) {
    return c.json({ error: "Malformed prekeys" }, 400);
  }
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM prekeys WHERE device_id = ?`,
  )
    .bind(deviceId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) + body.oneTimePrekeys.length > 200) {
    return c.json({ error: "Too many prekeys stored" }, 400);
  }
  await c.env.DB.batch(
    body.oneTimePrekeys.map((p) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO prekeys (device_id, key_id, public_key) VALUES (?, ?, ?)`,
      ).bind(deviceId, p.id, p.publicKey),
    ),
  );
  return c.json({ ok: true }, 201);
});

/** Public bundle for starting a session. Consumes one one-time prekey. */
deviceRoutes.get("/users/:userId/key-bundle", requireUnlocked, async (c) => {
  const me = c.get("user");
  const target = c.req.param("userId");
  if (
    !(await hit(c.env, `bundle:${me.id}`, 60, 60_000)) ||
    !(await hit(c.env, `bundle:${me.id}:${target}`, 12, 60_000))
  ) {
    return c.json({ error: "Too many key requests" }, 429);
  }
  const device = await c.env.DB.prepare(
    `SELECT id, identity_key, signing_key, spk_id, spk_public, spk_signature
     FROM devices WHERE user_id = ? AND revoked_at IS NULL LIMIT 1`,
  )
    .bind(target)
    .first<{
      id: string;
      identity_key: string;
      signing_key: string;
      spk_id: number;
      spk_public: string;
      spk_signature: string;
    }>();
  if (!device) {
    return c.json({ error: "This person hasn't finished setting up yet", code: "PEER_NOT_READY" }, 404);
  }
  const otp = await c.env.DB.prepare(
    `DELETE FROM prekeys
     WHERE device_id = ?1 AND key_id = (SELECT MIN(key_id) FROM prekeys WHERE device_id = ?1)
     RETURNING key_id, public_key`,
  )
    .bind(device.id)
    .first<{ key_id: number; public_key: string }>();

  return c.json({
    deviceId: device.id,
    identityKey: device.identity_key,
    signingKey: device.signing_key,
    signedPrekey: {
      id: device.spk_id,
      publicKey: device.spk_public,
      signature: device.spk_signature,
    },
    oneTimePrekey: otp ? { id: otp.key_id, publicKey: otp.public_key } : null,
  });
});
