import { Hono } from "hono";
import {
  DISPLAY_NAME_MAX,
  MAX_AVATAR_BYTES,
  USERNAME_PATTERN,
} from "@lop/config";
import type { DbUser } from "../env";
import {
  avatarUrl,
  publicUser,
  requireSession,
  requireUnlocked,
  type AppEnv,
} from "../lib/session";
import { hit } from "../lib/ratelimit";
import { normalizeUsername } from "../lib/util";

export const userRoutes = new Hono<AppEnv>();

userRoutes.get("/users/me", requireUnlocked, (c) => c.json({ user: publicUser(c.get("user")) }));

userRoutes.patch("/users/me", requireUnlocked, async (c) => {
  const user = c.get("user");
  const body = await c.req
    .json<{ displayName?: string }>()
    .catch(() => ({}) as { displayName?: string });
  const displayName = (body.displayName ?? "").trim();
  if (!displayName || displayName.length > DISPLAY_NAME_MAX) {
    return c.json({ error: `Display name is required (max ${DISPLAY_NAME_MAX})` }, 400);
  }
  await c.env.DB.prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`)
    .bind(displayName, Date.now(), user.id)
    .run();
  const fresh = (await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(user.id)
    .first<DbUser>())!;
  return c.json({ user: publicUser(fresh) });
});

function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

userRoutes.put("/users/me/avatar", requireUnlocked, async (c) => {
  const user = c.get("user");
  if (!(await hit(c.env, `avatar:${user.id}`, 10, 60 * 60_000))) {
    return c.json({ error: "Too many avatar changes" }, 429);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
    return c.json({ error: "Avatar must be an image under 200 KB" }, 400);
  }
  const type = sniffImage(bytes);
  if (!type) return c.json({ error: "Use a JPEG, PNG or WebP image" }, 400);

  await c.env.ATTACHMENTS.put(`avatars/${user.id}`, bytes, {
    httpMetadata: { contentType: type },
  });
  const version = user.avatar_version + 1;
  await c.env.DB.prepare(`UPDATE users SET avatar_version = ?, updated_at = ? WHERE id = ?`)
    .bind(version, Date.now(), user.id)
    .run();
  return c.json({ avatarUrl: avatarUrl(user.id, version) });
});

userRoutes.delete("/users/me/avatar", requireUnlocked, async (c) => {
  const user = c.get("user");
  await c.env.ATTACHMENTS.delete(`avatars/${user.id}`);
  await c.env.DB.prepare(`UPDATE users SET avatar_version = 0, updated_at = ? WHERE id = ?`)
    .bind(Date.now(), user.id)
    .run();
  return c.json({ avatarUrl: null });
});

// Loaded by <img>, so it cannot carry the vault header: session cookie only.
userRoutes.get("/users/:id/avatar", requireSession, async (c) => {
  const obj = await c.env.ATTACHMENTS.get(`avatars/${c.req.param("id")}`);
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/** Exact, case-insensitive username match. There is deliberately no search. */
userRoutes.get("/users/lookup", requireUnlocked, async (c) => {
  const me = c.get("user");
  if (!(await hit(c.env, `lookup:${me.id}`, 30, 60_000))) {
    return c.json({ error: "Too many lookups. Slow down." }, 429);
  }
  const username = normalizeUsername(c.req.query("username") ?? "");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Enter a full username (3–32 letters, numbers or _)" }, 400);
  }
  const u = await c.env.DB.prepare(
    `SELECT id, username, display_name, avatar_version FROM users WHERE username = ?`,
  )
    .bind(username)
    .first<{ id: string; username: string; display_name: string; avatar_version: number }>();
  if (!u) return c.json({ error: "No user with that username" }, 404);
  return c.json({
    userId: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarUrl: avatarUrl(u.id, u.avatar_version),
    isSelf: u.id === me.id,
  });
});
