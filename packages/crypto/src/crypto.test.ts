import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDeviceKeys,
  decryptBlob,
  deriveAuthProof,
  deriveVaultSecrets,
  deserializeDeviceKeys,
  encryptBlob,
  exportUploadBundle,
  generateSaltB64,
  initiateSession,
  ratchetDecrypt,
  ratchetEncrypt,
  safetyNumber,
  serializeDeviceKeys,
  utf8Decode,
  utf8ToBytes,
  fromBase64,
  CryptoError,
  type DeviceKeys,
  type PeerBundle,
  type RatchetState,
} from "./index";

function bundleOf(keys: DeviceKeys, deviceId: string): PeerBundle {
  const b = exportUploadBundle(keys);
  const otp = b.oneTimePrekeys[0]!;
  return {
    deviceId,
    identityKey: b.identityKey,
    signingKey: b.signingKey,
    signedPrekey: b.signedPrekey,
    oneTimePrekey: otp,
  };
}

const enc = (s: string) => utf8ToBytes(s);

async function send(state: RatchetState, text: string) {
  const r = await ratchetEncrypt(state, enc(text));
  return { state: r.state, msg: r.message };
}

test("X3DH + ratchet: bidirectional conversation", async () => {
  let aliceKeys = createDeviceKeys();
  let bobKeys = createDeviceKeys();
  let a = initiateSession(aliceKeys, bundleOf(bobKeys, "dev_bob"), "dev_alice");
  let b: RatchetState | null = null;

  const m1 = await send(a, "hello bob");
  a = m1.state;
  const d1 = await ratchetDecrypt(b, bobKeys, m1.msg);
  assert.equal(utf8Decode(d1.plaintext), "hello bob");
  b = d1.state;
  bobKeys = d1.keys;
  assert.equal(bobKeys.oneTimePrekeys.length, 49, "one-time prekey consumed");

  const m2 = await send(b, "hi alice");
  b = m2.state;
  const d2 = await ratchetDecrypt(a, aliceKeys, m2.msg);
  assert.equal(utf8Decode(d2.plaintext), "hi alice");
  a = d2.state;
  aliceKeys = d2.keys;
  assert.equal(a.x3dh, null, "handshake info dropped after reply");

  for (let i = 0; i < 5; i++) {
    const s = await send(a, `a${i}`);
    a = s.state;
    const r = await ratchetDecrypt(b, bobKeys, s.msg);
    assert.equal(utf8Decode(r.plaintext), `a${i}`);
    b = r.state;
    const s2 = await send(b, `b${i}`);
    b = s2.state;
    const r2 = await ratchetDecrypt(a, aliceKeys, s2.msg);
    assert.equal(utf8Decode(r2.plaintext), `b${i}`);
    a = r2.state;
  }
});

test("out-of-order and skipped messages", async () => {
  const aliceKeys = createDeviceKeys();
  let bobKeys = createDeviceKeys();
  let a = initiateSession(aliceKeys, bundleOf(bobKeys, "dev_bob"), "dev_alice");
  const msgs = [];
  for (let i = 0; i < 4; i++) {
    const s = await send(a, `m${i}`);
    a = s.state;
    msgs.push(s.msg);
  }
  let b: RatchetState | null = null;
  const order = [2, 0, 3, 1];
  for (const i of order) {
    const r = await ratchetDecrypt(b, bobKeys, msgs[i]!);
    assert.equal(utf8Decode(r.plaintext), `m${i}`);
    b = r.state;
    bobKeys = r.keys;
  }
});

test("replay and tampering are rejected", async () => {
  const aliceKeys = createDeviceKeys();
  const bobKeys = createDeviceKeys();
  const a = initiateSession(aliceKeys, bundleOf(bobKeys, "dev_bob"), "dev_alice");
  const s = await send(a, "secret");
  const ok = await ratchetDecrypt(null, bobKeys, s.msg);

  await assert.rejects(
    ratchetDecrypt(ok.state, ok.keys, s.msg),
    (e: unknown) => e instanceof CryptoError,
  );

  const tampered = { ...s.msg };
  const ct = fromBase64(tampered.ciphertext);
  ct[ct.length - 1]! ^= 1;
  tampered.ciphertext = btoa(String.fromCharCode(...ct));
  await assert.rejects(ratchetDecrypt(null, bobKeys, tampered), CryptoError);
});

test("forged signed prekey is refused", async () => {
  const aliceKeys = createDeviceKeys();
  const bobKeys = createDeviceKeys();
  const mallory = createDeviceKeys();
  const bundle = bundleOf(bobKeys, "dev_bob");
  bundle.signedPrekey = {
    ...bundle.signedPrekey,
    publicKey: exportUploadBundle(mallory).signedPrekey.publicKey,
  };
  assert.throws(() => initiateSession(aliceKeys, bundle, "dev_alice"), CryptoError);
});

test("simultaneous initiation resolves without losing messages", async () => {
  let aliceKeys = createDeviceKeys();
  let bobKeys = createDeviceKeys();
  let a = initiateSession(aliceKeys, bundleOf(bobKeys, "dev_bob"), "dev_alice");
  let b = initiateSession(bobKeys, bundleOf(aliceKeys, "dev_alice"), "dev_bob");
  const ma = await send(a, "from alice");
  const mb = await send(b, "from bob");
  a = ma.state;
  b = mb.state;

  const atBob = await ratchetDecrypt(b, bobKeys, ma.msg);
  const atAlice = await ratchetDecrypt(a, aliceKeys, mb.msg);
  assert.equal(utf8Decode(atBob.plaintext), "from alice");
  assert.equal(utf8Decode(atAlice.plaintext), "from bob");
  a = atAlice.state;
  b = atBob.state;
  aliceKeys = atAlice.keys;
  bobKeys = atBob.keys;

  // Exactly one side must have switched, and they must now agree.
  const s = await send(a, "follow up");
  const r = await ratchetDecrypt(b, bobKeys, s.msg);
  assert.equal(utf8Decode(r.plaintext), "follow up");
});

test("peer reset (new handshake) replaces the session", async () => {
  const aliceKeys = createDeviceKeys();
  const bobKeys = createDeviceKeys();
  let a1 = initiateSession(aliceKeys, bundleOf(bobKeys, "dev_bob"), "dev_alice");
  const m1 = await send(a1, "one");
  const first = await ratchetDecrypt(null, bobKeys, m1.msg);
  a1 = m1.state;

  const a2 = initiateSession(aliceKeys, bundleOf(first.keys, "dev_bob"), "dev_alice");
  const m2 = await send(a2, "after reset");
  const second = await ratchetDecrypt(first.state, first.keys, m2.msg);
  assert.equal(utf8Decode(second.plaintext), "after reset");
  assert.equal(second.sessionReset, true);
});

test("session state survives serialization", async () => {
  const aliceKeys = createDeviceKeys();
  const bobKeys = createDeviceKeys();
  const restored = deserializeDeviceKeys(
    JSON.parse(JSON.stringify(serializeDeviceKeys(bobKeys))),
  );
  const a = initiateSession(aliceKeys, bundleOf(bobKeys, "dev_bob"), "dev_alice");
  const s = await send(a, "persist me");
  const r = await ratchetDecrypt(null, restored, s.msg);
  assert.equal(utf8Decode(r.plaintext), "persist me");
  const reloaded: RatchetState = JSON.parse(JSON.stringify(r.state));
  const back = await send(reloaded, "still works");
  const r2 = await ratchetDecrypt(a, aliceKeys, back.msg);
  assert.equal(utf8Decode(r2.plaintext), "still works");
});

test("file encryption round trip + wrong key fails", async () => {
  const data = new Uint8Array(300_000);
  for (let i = 0; i < data.length; i += 65_536) {
    crypto.getRandomValues(data.subarray(i, Math.min(i + 65_536, data.length)));
  }
  const { ciphertext, key } = await encryptBlob(data);
  assert.notDeepEqual(ciphertext.subarray(12, 40), data.subarray(0, 28));
  assert.deepEqual(await decryptBlob(ciphertext, key), data);
  const other = await encryptBlob(data);
  await assert.rejects(decryptBlob(ciphertext, other.key));
});

test("password + passcode derivation is deterministic and separated", async () => {
  const salt = generateSaltB64();
  const p1 = await deriveAuthProof("correct horse battery", salt);
  const p2 = await deriveAuthProof("correct horse battery", salt);
  assert.equal(p1, p2);
  assert.notEqual(p1, await deriveAuthProof("correct horse batterz", salt));

  const v1 = await deriveVaultSecrets("4821", salt);
  const v2 = await deriveVaultSecrets("4821", salt);
  assert.equal(v1.verifier, v2.verifier);
  assert.notEqual(v1.verifier, (await deriveVaultSecrets("4822", salt)).verifier);
  assert.notEqual(v1.verifier, p1, "verifier is independent of auth proof");
});

test("safety numbers are symmetric", () => {
  const a = createDeviceKeys();
  const b = createDeviceKeys();
  const na = safetyNumber(
    { identityKey: a.identity.publicKey, signingKey: a.signing.publicKey },
    { identityKey: b.identity.publicKey, signingKey: b.signing.publicKey },
  );
  const nb = safetyNumber(
    { identityKey: b.identity.publicKey, signingKey: b.signing.publicKey },
    { identityKey: a.identity.publicKey, signingKey: a.signing.publicKey },
  );
  assert.equal(na, nb);
  assert.match(na, /^(\d{5} ){11}\d{5}$/);
});
