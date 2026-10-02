/**
 * Creates or updates the predefined groups.
 *
 *   cp groups.example.json groups.local.json   # then edit (gitignored)
 *   npm run groups:seed                        # local D1 (run users:seed first)
 *   npm run groups:seed -- --remote            # Cloudflare D1
 *
 * Group chats are end-to-end encrypted by the clients (each message is sealed
 * separately for every member); the server only stores the roster and
 * ciphertext. Re-running keeps the same group id and just syncs its members.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USERNAME_PATTERN } from "@tetris/config";

interface SeedGroup {
  name: string;
  members: string[];
}

const remote = process.argv.includes("--remote");
const file = process.argv.find((a) => a.endsWith(".json")) ?? "groups.local.json";
const DB_NAME = "lop-db";

function fail(message: string): never {
  console.error(`seed-groups: ${message}`);
  process.exit(1);
}

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`;

if (!existsSync(file)) fail(`${file} not found. Copy groups.example.json to groups.local.json first.`);
const groups = JSON.parse(readFileSync(file, "utf8")) as SeedGroup[];
if (!Array.isArray(groups) || groups.length === 0) fail(`${file} must be a non-empty array`);

const now = Date.now();
const statements: string[] = [];
for (const g of groups) {
  const name = g.name?.trim();
  if (!name || name.length > 60) fail("each group needs a name of 1-60 characters");
  if (!Array.isArray(g.members) || g.members.length < 2) fail(`group "${name}" needs 2+ members`);
  const members = [...new Set(g.members.map((m) => m.trim().toLowerCase()))];
  for (const m of members) if (!USERNAME_PATTERN.test(m)) fail(`bad username in "${name}": ${m}`);
  const id = `cnv_${randomUUID().replace(/-/g, "")}`;
  const list = members.map(sql).join(",");

  // Reuse the group with this name if it exists, otherwise create it.
  statements.push(
    `INSERT INTO conversations (id, user_a, user_b, created_at, last_message_at, kind, name)
     SELECT ${sql(id)}, 'group', ${sql(id)}, ${now}, ${now}, 'group', ${sql(name)}
     WHERE NOT EXISTS (SELECT 1 FROM conversations WHERE kind = 'group' AND name = ${sql(name)});`,
    // Roster = exactly the listed users that exist.
    `DELETE FROM group_members
     WHERE conversation_id = (SELECT id FROM conversations WHERE kind = 'group' AND name = ${sql(name)})
       AND user_id NOT IN (SELECT id FROM users WHERE username IN (${list}));`,
    `INSERT OR IGNORE INTO group_members (conversation_id, user_id, added_at)
     SELECT c.id, u.id, ${now}
     FROM conversations c, users u
     WHERE c.kind = 'group' AND c.name = ${sql(name)} AND u.username IN (${list});`,
    `INSERT INTO conversation_members (conversation_id, user_id, joined_at, communication_epoch)
     SELECT c.id, u.id, ${now}, u.communication_epoch
     FROM conversations c, users u
     WHERE c.kind = 'group' AND c.name = ${sql(name)} AND u.username IN (${list})
     ON CONFLICT(conversation_id, user_id) DO UPDATE SET communication_epoch = excluded.communication_epoch;`,
  );
}

const tmp = join(tmpdir(), `tetris-groups-${randomUUID()}.sql`);
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
console.log(`\nSeeded ${groups.length} group(s) into ${remote ? "REMOTE" : "local"} ${DB_NAME}.`);
