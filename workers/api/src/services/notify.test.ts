import assert from "node:assert/strict";
import { test } from "node:test";
import { composeDigest } from "./notify";

const base = {
  recipientName: "Ravi",
  recipientUsername: "ravi1",
  appUrl: "https://example.test",
};

test("a digest names senders and groups with counts, and says who it is for", () => {
  const d = composeDigest({
    ...base,
    lines: [
      { kind: "dm", label: "Manas", count: 2 },
      { kind: "group", label: "Kalki", count: 1 },
    ],
  });
  assert.equal(d.subject, "@ravi1: 3 new messages on Tetris");
  assert.match(d.text, /2 messages from Manas/);
  assert.match(d.text, /1 message in Kalki/);
  assert.match(d.html, /Sent for @ravi1/);
  assert.match(d.text, /https:\/\/example\.test/);
});

test("singular wording for a single message", () => {
  const d = composeDigest({ ...base, lines: [{ kind: "dm", label: "Manas", count: 1 }] });
  assert.equal(d.subject, "@ravi1: 1 new message on Tetris");
  assert.match(d.text, /1 unread message\./);
});

test("names are escaped in HTML and no message body can leak in", () => {
  const d = composeDigest({
    ...base,
    lines: [{ kind: "dm", label: '<img src=x onerror="1">', count: 1 }],
  });
  assert.ok(!d.html.includes("<img"));
  assert.ok(d.html.includes("&lt;img"));
  // The only inputs are counts and labels: there is nothing else to leak.
  assert.ok(!/secret|password|passcode/i.test(d.text));
});
