import assert from "node:assert/strict";
import { test } from "node:test";
import { callSecurityCode, sdpFingerprint } from "./callcode";

test("both sides derive the same code whichever order the fingerprints come in", async () => {
  const a = "aa".repeat(32);
  const b = "bb".repeat(32);
  const one = await callSecurityCode(a, b);
  const two = await callSecurityCode(b, a);
  assert.equal(one, two);
  assert.match(one, /^\d{5} \d{5} \d{5} \d{5}$/);
});

test("a swapped fingerprint changes the code", async () => {
  const a = "aa".repeat(32);
  const b = "bb".repeat(32);
  const evil = "cc".repeat(32);
  assert.notEqual(
    await callSecurityCode(a, b),
    await callSecurityCode(a, evil),
  );
});

test("the fingerprint is read out of an SDP", () => {
  const sdp = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=fingerprint:sha-256 AB:CD:EF:01:23",
    "a=setup:actpass",
  ].join("\r\n");
  assert.equal(sdpFingerprint(sdp), "abcdef0123");
  assert.equal(sdpFingerprint("v=0"), null);
});
