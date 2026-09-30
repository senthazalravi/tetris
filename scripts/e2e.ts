/**
 * End-to-end acceptance test against a running `wrangler dev` (real Worker,
 * real D1, real R2, real Durable Object). Mirrors LLD §14.
 *
 *   npm run dev:api        # terminal 1
 *   npm run test:e2e       # terminal 2
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  createDeviceKeys,
  decryptBlob,
  deriveAuthProof,
  deriveVaultSecrets,
  encryptBlob,
  exportUploadBundle,
  generateSaltB64,
  initiateSession,
  ratchetDecrypt,
  ratchetEncrypt,
  utf8Decode,
  utf8ToBytes,
  type DeviceKeys,
  type PeerBundle,
  type RatchetState,
} from "@lop/crypto";

const BASE = process.env.LOP_URL ?? "http://127.0.0.1:8787";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = () => Math.random().toString(36).slice(2, 8);

class Client {
  cookie = "";
  vault = "";
  keys!: DeviceKeys;
  deviceId = "";
  sessions = new Map<string, RatchetState>();
  constructor(
    public name: string,
    public username = `${name}_${rand()}`,
    public email = `${name}_${rand()}@example.com`,
    public password = "correct horse battery staple",
    public passcode = "2468",
  ) {}

  async req(method: string, path: string, body?: unknown, raw?: Uint8Array) {
    const headers: Record<string, string> = { Origin: BASE };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.vault) headers["X-Lop-Vault"] = this.vault;
    let payload: BodyInit | undefined;
    if (raw) {
      headers["Content-Type"] = "application/octet-stream";
      payload = raw as unknown as BodyInit;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers, body: payload });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!.includes("=;") ? "" : set.split(";")[0]!;
    const isBin = res.headers.get("content-type")?.includes("octet-stream");
    const data = isBin
      ? new Uint8Array(await res.arrayBuffer())
      : ((await res.json().catch(() => ({}))) as Record<string, any>);
    return { status: res.status, data: data as any };
  }

  async register() {
    const authSalt = generateSaltB64();
    const vaultSalt = generateSaltB64();
    const v = await deriveVaultSecrets(this.passcode, vaultSalt);
    const r = await this.req("POST", "/auth/register", {
      email: this.email,
      username: this.username,
      displayName: this.name,
      authSalt,
      authProof: await deriveAuthProof(this.password, authSalt),
      vaultSalt,
      vaultVerifier: v.verifier,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    this.vault = r.data.vaultToken;
    this.userId = r.data.user.id;
    await this.setupDevice();
  }
  userId = "";

  async setupDevice() {
    this.keys = createDeviceKeys();
    const r = await this.req("POST", "/devices", exportUploadBundle(this.keys));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    this.deviceId = r.data.deviceId;
    this.sessions.clear();
  }

  async login(login = this.username) {
    this.vault = "";
    const pre = await this.req("POST", "/auth/prelogin", { login });
    const r = await this.req("POST", "/auth/login", {
      login,
      authProof: await deriveAuthProof(this.password, pre.data.authSalt),
    });
    return r;
  }

  async unlock(challenge: { id: string; vaultSalt: string }, passcode = this.passcode) {
    const v = await deriveVaultSecrets(passcode, challenge.vaultSalt);
    const r = await this.req("POST", "/auth/unlock", {
      challengeId: challenge.id,
      verifier: v.verifier,
    });
    if (r.data.vaultToken) this.vault = r.data.vaultToken;
    return r;
  }

  async setupVault(passcode = this.passcode) {
    const vaultSalt = generateSaltB64();
    const v = await deriveVaultSecrets(passcode, vaultSalt);
    const r = await this.req("POST", "/auth/vault", { vaultSalt, vaultVerifier: v.verifier });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    this.vault = r.data.vaultToken;
    await this.setupDevice();
  }

  async openChat(peer: Client) {
    const l = await this.req("GET", `/users/lookup?username=${peer.username}`);
    assert.equal(l.status, 200);
    const c = await this.req("POST", "/conversations", { peerUserId: l.data.userId });
    assert.equal(c.status, 201, JSON.stringify(c.data));
    return c.data.conversation as { id: string; peer: { deviceId: string } };
  }

  async send(convId: string, peer: Client, text: string, attachmentId?: string) {
    let state = this.sessions.get(peer.userId);
    if (!state) {
      const b = await this.req("GET", `/users/${peer.userId}/key-bundle`);
      assert.equal(b.status, 200, JSON.stringify(b.data));
      state = initiateSession(this.keys, b.data as PeerBundle, this.deviceId);
    }
    const peerDevice = state.peerDeviceId;
    const enc = await ratchetEncrypt(state, utf8ToBytes(text));
    this.sessions.set(peer.userId, enc.state);
    const id = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
    const r = await this.req("POST", `/conversations/${convId}/messages`, {
      messageId: id,
      senderDeviceId: this.deviceId,
      recipientDeviceId: peerDevice,
      cryptoHeader: enc.message.cryptoHeader,
      ciphertext: enc.message.ciphertext,
      attachmentId,
    });
    return { id, ...r };
  }

  async receive(from: Client) {
    const s = await this.req("GET", "/sync?ts=0&id=");
    assert.equal(s.status, 200, JSON.stringify(s.data));
    const out: { id: string; text: string; attachmentId: string | null }[] = [];
    for (const m of s.data.messages.filter((x: any) => x.direction === "in" && !x.deleted)) {
      const r = await ratchetDecrypt(this.sessions.get(from.userId) ?? null, this.keys, {
        cryptoHeader: m.cryptoHeader,
        ciphertext: m.ciphertext,
      });
      this.sessions.set(from.userId, r.state);
      this.keys = r.keys;
      out.push({ id: m.id, text: utf8Decode(r.plaintext), attachmentId: m.attachmentId });
    }
    return { out, raw: s.data };
  }
}

let step = 0;
const ok = (label: string) => console.log(`  ✓ ${String(++step).padStart(2, "0")} ${label}`);

async function main() {
  console.log(`Lop e2e → ${BASE}\n`);

  const alice = new Client("alice");
  const bob = new Client("bob");
  const carol = new Client("carol");
  await alice.register();
  await bob.register();
  await carol.register();
  ok("register three accounts (password + passcode derived client-side)");

  // --- auth surface ---------------------------------------------------
  let r = await alice.login();
  assert.equal(r.status, 200);
  assert.ok(r.data.challenge?.id, "login returns an unlock challenge");
  assert.ok(r.data.challenge.remainingMs <= 30_000);
  const noVault = await alice.req("GET", "/contacts");
  assert.equal(noVault.status, 403);
  assert.equal(noVault.data.code, "VAULT_LOCKED");
  ok("cookie alone unlocks nothing: data endpoints are 403 VAULT_LOCKED");

  const badLogin = await new Client("x", alice.username, "x@example.com", "definitely not the password").login();
  assert.equal(badLogin.status, 401);
  ok("wrong account password rejected");

  const resume = await alice.req("POST", "/auth/resume");
  assert.equal(resume.data.challenge.id, r.data.challenge.id);
  assert.ok(resume.data.challenge.remainingMs <= r.data.challenge.remainingMs);
  ok("reload cannot restart the 30s clock: resume returns the same challenge");

  const un = await alice.unlock(r.data.challenge);
  assert.equal(un.data.unlocked, true);
  const again = await alice.unlock(r.data.challenge);
  assert.equal(again.status, 409);
  ok("correct passcode unlocks; a second attempt is rejected (one attempt)");

  // bob logs in fresh so his session is unlocked through the real path
  r = await bob.login();
  await bob.unlock(r.data.challenge);
  r = await carol.login();
  await carol.unlock(r.data.challenge);

  // --- contacts -------------------------------------------------------
  const partial = await alice.req("GET", `/users/lookup?username=${bob.username.slice(0, 5)}`);
  assert.equal(partial.status, 404);
  const exact = await alice.req("GET", `/users/lookup?username=${bob.username.toUpperCase()}`);
  assert.equal(exact.status, 200);
  assert.equal((await alice.req("GET", "/users")).status, 404);
  ok("exact (case-insensitive) lookup only: partial → 404, no list endpoint");

  const conv = await alice.openChat(bob);
  const aliceContacts = await alice.req("GET", "/contacts");
  assert.deepEqual(aliceContacts.data.contacts.map((c: any) => c.userId), [bob.userId]);
  assert.equal((await carol.req("GET", "/contacts")).data.contacts.length, 0);
  ok("contacts are private: only people alice opened a chat with");

  // --- E2EE text ------------------------------------------------------
  const secret = `top secret ${rand()}`;
  const sent = await alice.send(conv.id, bob, secret);
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.ok(sent.data.expiresAt - sent.data.createdAt === 86_400_000);
  ok("send: server stamps created_at and expires_at = +24h");

  const bobConvs = await bob.req("GET", "/conversations");
  assert.equal(bobConvs.data.conversations.length, 1);
  const rx = await bob.receive(alice);
  assert.equal(rx.out[0]!.text, secret);
  assert.ok(!JSON.stringify(rx.raw).includes(secret), "wire data never contains plaintext");
  const dump = execSync(
    `npx wrangler d1 execute lop-db --local --json --command "SELECT hex(ciphertext) AS c FROM messages"`,
    { cwd: "workers/api", encoding: "utf8" },
  );
  assert.ok(!dump.includes(Buffer.from(secret).toString("hex").toUpperCase()));
  ok("E2EE: bob decrypts; plaintext is absent from the API and from D1");

  const carolSync = await carol.req("GET", "/sync?ts=0&id=");
  assert.equal(carolSync.data.messages.length, 0);
  ok("third parties see nothing");

  // --- receipts + reply ------------------------------------------------
  await bob.req("POST", "/messages/ack", { ids: [sent.id], state: "read" });
  const aSync = await alice.req("GET", "/sync?ts=0&id=");
  assert.equal(aSync.data.messages.find((m: any) => m.id === sent.id).state, "read");
  const rcpt = aSync.data.messages.find((m: any) => m.id === sent.id);
  assert.ok(rcpt.readAt > 0 && rcpt.deliveredAt > 0, "sender learns delivered/read times");
  assert.ok(rcpt.deliveredAt <= rcpt.readAt);
  const bSyncRcpt = (await bob.req("GET", "/sync?ts=0&id=")).data.messages.find((m: any) => m.id === sent.id);
  assert.equal(bSyncRcpt.readAt, null, "recipient is not shown receipt times");
  const back = await bob.send(conv.id, alice, "got it");
  assert.equal(back.status, 201);
  const rxA = await alice.receive(bob);
  assert.ok(rxA.out.some((m) => m.text === "got it"));
  ok("read receipts and two-way ratchet");

  // --- attachments -----------------------------------------------------
  const file = new Uint8Array(200_000).map((_, i) => (i * 7) % 251);
  const blob = await encryptBlob(file);
  const up = await alice.req("PUT", `/conversations/${conv.id}/attachments`, undefined, blob.ciphertext);
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const withFile = await alice.send(conv.id, bob, "photo", up.data.attachmentId);
  assert.equal(withFile.status, 201, JSON.stringify(withFile.data));
  const dl = await bob.req("GET", `/attachments/${up.data.attachmentId}`);
  assert.equal(dl.status, 200);
  assert.notDeepEqual(dl.data.slice(12, 60), file.slice(0, 48));
  assert.deepEqual(await decryptBlob(dl.data, blob.key), file);
  assert.equal((await carol.req("GET", `/attachments/${up.data.attachmentId}`)).status, 404);
  ok("attachments: ciphertext in R2, bob decrypts, carol is refused");

  const big = await alice.req("PUT", `/conversations/${conv.id}/attachments`, undefined, new Uint8Array(91 * 1024 * 1024));
  assert.equal(big.status, 413);
  ok("oversize attachment rejected (90 MB hard cap)");

  const mid = await alice.req("PUT", `/conversations/${conv.id}/attachments`, undefined, new Uint8Array(30 * 1024 * 1024));
  assert.equal(mid.status, 201, JSON.stringify(mid.data));
  ok("a 30 MB document/photo is accepted (only videos are capped lower, client-side)");

  // --- delete for everyone ---------------------------------------------
  const del = await alice.req("DELETE", `/messages/${withFile.id}`);
  assert.equal(del.status, 200);
  assert.equal((await bob.req("GET", `/attachments/${up.data.attachmentId}`)).status, 404);
  const afterDel = await bob.req("GET", "/sync?ts=0&id=");
  assert.equal(afterDel.data.messages.find((m: any) => m.id === withFile.id).deleted, true);
  ok("delete for everyone removes ciphertext and the R2 object");

  // --- 24h expiry ------------------------------------------------------
  execSync(
    `npx wrangler d1 execute lop-db --local --command "UPDATE messages SET expires_at = 1 WHERE id = '${sent.id}'"`,
    { cwd: "workers/api", stdio: "ignore" },
  );
  const expired = await bob.req("GET", "/sync?ts=0&id=");
  assert.ok(!expired.data.messages.some((m: any) => m.id === sent.id));
  const cron = await fetch(`${BASE}/cdn-cgi/handler/scheduled`);
  assert.equal(cron.status, 200);
  await sleep(500);
  const left = execSync(
    `npx wrangler d1 execute lop-db --local --json --command "SELECT COUNT(*) AS n FROM messages WHERE id = '${sent.id}'"`,
    { cwd: "workers/api", encoding: "utf8" },
  );
  assert.ok(left.includes('"n": 0'), left);
  ok("expired messages are unreadable immediately and physically deleted by cron");

  // --- WRONG passcode wipe ---------------------------------------------
  const before = await alice.req("GET", "/conversations");
  assert.equal(before.data.conversations.length, 1);
  const a2 = new Client("alice", alice.username, alice.email, alice.password, alice.passcode);
  a2.userId = alice.userId;
  r = await a2.login();
  const wrong = await a2.unlock(r.data.challenge, "0000");
  assert.equal(wrong.data.wiped, true);
  assert.equal(wrong.data.reason, "WRONG_PASSCODE");
  assert.equal(wrong.data.vaultSetupRequired, true);
  assert.equal((await a2.req("GET", "/contacts")).status, 403);
  await a2.setupVault("1357");
  assert.equal((await a2.req("GET", "/contacts")).data.contacts.length, 0);
  assert.equal((await a2.req("GET", "/conversations")).data.conversations.length, 0);
  const acct = await a2.req("GET", "/users/me");
  assert.equal(acct.data.user.username, alice.username);
  const relog = await a2.login();
  assert.equal(relog.status, 200);
  ok("wrong passcode: contacts + chats wiped, account/profile survive, can log in again");

  // old vault token of the wiped user is dead everywhere
  assert.equal((await alice.req("GET", "/contacts")).status, 403);
  ok("wipe revokes every existing vault token (other tabs are locked out)");

  // peer's device-change signalling: bob's old session targets alice's dead device
  const stale = await bob.send(conv.id, alice, "are you there?");
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, "DEVICE_CHANGED");
  ok("peer is told keys changed (DEVICE_CHANGED) so it can re-key");

  // --- TIMEOUT wipe: explicit expiry call --------------------------------
  const b2 = new Client("bob", bob.username, bob.email, bob.password, bob.passcode);
  r = await b2.login();
  const early = await b2.req("POST", "/auth/unlock", { challengeId: r.data.challenge.id, verifier: null });
  assert.equal(early.status, 400);
  console.log("    …waiting 31s for the unlock window to close");
  await sleep(31_000);
  const to = await b2.req("POST", "/auth/unlock", { challengeId: r.data.challenge.id, verifier: null });
  assert.equal(to.data.reason, "TIMEOUT");
  assert.equal(to.data.wiped, true);
  ok("timeout: cannot be declared early; after 30s the server wipes");

  // --- TIMEOUT wipe: tab closed, discovered lazily on next contact -----------
  const c2 = new Client("carol", carol.username, carol.email, carol.password, carol.passcode);
  r = await c2.login();
  assert.ok(r.data.challenge);
  console.log("    …abandoning the challenge for 31s (tab closed)");
  await sleep(31_000);
  const c3 = new Client("carol", carol.username, carol.email, carol.password, carol.passcode);
  const relogin = await c3.login();
  assert.equal(relogin.data.vaultSetupRequired, true, "abandoned challenge already wiped");
  ok("abandoned challenge (tab closed) is wiped on the account's next request");

  // --- late correct passcode must not save you ------------------------------
  const d = new Client("dave");
  await d.register();
  r = await d.login();
  console.log("    …waiting 31s, then submitting the CORRECT passcode too late");
  await sleep(31_000);
  const late = await d.unlock(r.data.challenge);
  assert.equal(late.data.wiped, true);
  assert.equal(late.data.reason, "TIMEOUT");
  ok("a correct passcode after 30s is still a timeout wipe");

  // --- begin claims the single attempt, then unlock settles it ---------------
  const e = new Client("erin");
  await e.register();
  r = await e.login();
  const begun = await e.req("POST", "/auth/unlock/begin", { challengeId: r.data.challenge.id });
  assert.equal(begun.status, 200, JSON.stringify(begun.data));
  const rebegin = await e.req("POST", "/auth/unlock/begin", { challengeId: r.data.challenge.id });
  assert.equal(rebegin.status, 409);
  const resumed = await e.req("POST", "/auth/resume");
  assert.equal(resumed.data.challenge?.id, r.data.challenge.id, "reload returns the same challenge");
  const fin = await e.unlock(r.data.challenge);
  assert.equal(fin.data.unlocked, true, JSON.stringify(fin.data));
  ok("unlock/begin claims the one attempt; the correct passcode still settles it");

  // --- realtime channel ------------------------------------------------------
  // @ts-ignore: `ws` ships with vite; only used here to send a Cookie header.
  const { default: WS } = await import("ws");
  const wsUrl = BASE.replace(/^http/, "ws") + `/api/v1/ws?vt=${encodeURIComponent(e.vault)}`;
  const outcome = await new Promise<string>((resolve) => {
    const sock = new WS(wsUrl, { headers: { Cookie: e.cookie, Origin: BASE } });
    const t = setTimeout(() => resolve("timeout"), 8000);
    sock.on("open", () => {
      clearTimeout(t);
      sock.close();
      resolve("open");
    });
    sock.on("unexpected-response", (_req: unknown, res: { statusCode: number }) => {
      clearTimeout(t);
      resolve(`http ${res.statusCode}`);
    });
    sock.on("error", (err: Error) => {
      clearTimeout(t);
      resolve(`error ${err.message}`);
    });
  });
  assert.equal(outcome, "open", `websocket: ${outcome}`);
  const badToken = await new Promise<string>((resolve) => {
    const sock = new WS(BASE.replace(/^http/, "ws") + "/api/v1/ws?vt=nope", {
      headers: { Cookie: e.cookie, Origin: BASE },
    });
    sock.on("open", () => resolve("open"));
    sock.on("unexpected-response", (_r: unknown, res: { statusCode: number }) => resolve(`http ${res.statusCode}`));
    sock.on("error", () => resolve("error"));
  });
  assert.equal(badToken, "http 403");
  ok("websocket upgrades with cookie + vault token, and is refused without a valid token");

  console.log("\nAll e2e checks passed.");
}

main().catch((e) => {
  console.error("\n✗ e2e failed:", e);
  process.exit(1);
});


