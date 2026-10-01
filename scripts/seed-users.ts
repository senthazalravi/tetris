/**
 * Creates or updates the predefined users. There is no sign-up in the app.
 *
 *   cp users.example.json users.local.json   # then edit (gitignored)
 *   npm run users:seed                       # local D1
 *   npm run users:seed -- --remote           # Cloudflare D1
 *
 * Passcodes are stretched here (Argon2id) exactly like the browser does, so
 * only a salt and a hash of the verifier ever reach the database. Re-seeding an
 * existing username resets its passcode and starts a new chat epoch.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PASSCODE_PATTERN, USERNAME_PATTERN } from "@tetris/config";
import { deriveVaultSecrets, generateSaltB64 } from "@tetris/crypto";

interface SeedUser {
  username: string;
  email: string;
  displayName?: string;
  passcode: string;
}

const remote = process.argv.includes("--remote");
const file = process.argv.find((a) => a.endsWith(".json")) ?? "users.local.json";
const DB_NAME = "tetris-db";

function fail(message: string): never {
  console.error(`seed-users: ${message}`);
  process.exit(1);
}

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function main() {
  if (!existsSync(file)) fail(`${file} not found. Copy users.example.json to users.local.json first.`);
  const users = JSON.parse(readFileSync(file, "utf8")) as SeedUser[];
  if (!Array.isArray(users) || users.length === 0) fail(`${file} must be a non-empty array`);

  const now = Date.now();
  const statements: string[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    const username = u.username?.trim().toLowerCase();
    const email = u.email?.trim().toLowerCase();
    if (!username || !USERNAME_PATTERN.test(username)) fail(`bad username: ${u.username}`);
    if (seen.has(username)) fail(`duplicate username: ${username}`);
    seen.add(username);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`bad email for ${username}`);
    if (!PASSCODE_PATTERN.test(u.passcode ?? "")) fail(`passcode for ${username} must be exactly 8 digits`);

    const salt = generateSaltB64();
    const { verifier } = await deriveVaultSecrets(u.passcode, salt);
    const verifierHash = createHash("sha256").update(verifier).digest("hex");
    const displayName = (u.displayName ?? username).trim().slice(0, 40) || username;
    const id = `usr_${randomUUID().replace(/-/g, "")}`;

    statements.push(
      `INSERT INTO users (id, username, email, display_name, avatar_version, vault_salt,
                          vault_verifier_hash, trusted_device_hash, communication_epoch, created_at, updated_at)
       VALUES (${sql(id)}, ${sql(username)}, ${sql(email)}, ${sql(displayName)}, 0, ${sql(salt)},
               ${sql(verifierHash)}, NULL, 1, ${now}, ${now})
       ON CONFLICT(username) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         vault_salt = excluded.vault_salt,
         vault_verifier_hash = excluded.vault_verifier_hash,
         trusted_device_hash = NULL,
         communication_epoch = users.communication_epoch + 1,
         updated_at = excluded.updated_at;`,
    );
  }

  const tmp = join(tmpdir(), `tetris-seed-${randomUUID()}.sql`);
  writeFileSync(tmp, statements.join("\n"), "utf8");
  try {
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", DB_NAME, remote ? "--remote" : "--local", "--file", tmp],
      { stdio: "inherit", cwd: "workers/api", shell: process.platform === "win32" },
    );
  } finally {
    rmSync(tmp, { force: true });
  }
  console.log(`\nSeeded ${users.length} user(s) into ${remote ? "REMOTE" : "local"} ${DB_NAME}: ${[...seen].map((u) => "@" + u).join(", ")}`);
}

void main();
