/**
 * Call security code.
 *
 * Call setup passes through our server, so in theory a malicious server could
 * swap the two sides' connection fingerprints and sit in the middle. Both
 * sides therefore derive a short code from the two fingerprints. If the people
 * read out the same code, nobody is in between (the same idea as the safety
 * numbers used for chats).
 */

/** The DTLS certificate fingerprint of an SDP, lowercased and without colons. */
export function sdpFingerprint(sdp: string): string | null {
  const m = /^a=fingerprint:\S+\s+([0-9A-Fa-f:]+)\s*$/m.exec(sdp);
  return m ? m[1]!.replace(/:/g, "").toLowerCase() : null;
}

/** "12345 67890 24680 13579": identical on both sides, whichever order they pass the arguments. */
export async function callSecurityCode(
  fingerprintA: string,
  fingerprintB: string,
): Promise<string> {
  const [first, second] = [fingerprintA, fingerprintB].sort();
  const data = new TextEncoder().encode(`tetris-call|${first}|${second}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const view = new DataView(digest.buffer);
  const groups: string[] = [];
  for (let i = 0; i < 4; i++)
    groups.push(String(view.getUint32(i * 4) % 100_000).padStart(5, "0"));
  return groups.join(" ");
}
