import { b64Decode, b64Encode, safeEqual } from "./util";

/**
 * Hash of a group's code. The code is only four digits, so the hash is not what
 * protects it (two tries and a 30-second window are); it just keeps the code
 * out of the database in the clear. Same format is used by scripts/seed-groups.ts.
 */
const ITERATIONS = 100_000;

async function derive(
  code: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return b64Encode(new Uint8Array(bits));
}

export async function hashGroupCode(code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `p1$${ITERATIONS}$${b64Encode(salt)}$${await derive(code, salt, ITERATIONS)}`;
}

export async function verifyGroupCode(
  code: string,
  stored: string | null,
): Promise<boolean> {
  const [tag, iter, salt, hash] = (stored ?? "").split("$");
  if (tag !== "p1" || !iter || !salt || !hash) return false;
  const iterations = Number(iter);
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > ITERATIONS
  )
    return false;
  return safeEqual(await derive(code, b64Decode(salt), iterations), hash);
}
