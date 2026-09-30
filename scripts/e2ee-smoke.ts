import {
  acceptSession,
  createDeviceKeys,
  decryptText,
  encryptText,
  exportPublicBundle,
  initiateSession,
} from "../packages/crypto/src/index.ts";

const base = "http://127.0.0.1:8787/api/v1";

type Jar = { cookie: string };

async function req(jar: Jar, path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (opts.body) headers["Content-Type"] = "application/json";
  if (jar.cookie) headers.Cookie = jar.cookie;
  const res = await fetch(base + path, { ...opts, headers });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(/lop_session=[^;]+/);
    if (m) jar.cookie = m[0];
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(json)}`);
  return json as never;
}

async function main() {
  const aliceJar: Jar = { cookie: "" };
  const bobJar: Jar = { cookie: "" };

  await req(aliceJar, "/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: "a2@example.com",
      password: "password12345",
      username: "alice2",
      displayName: "Alice2",
    }),
  });
  await req(bobJar, "/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: "b2@example.com",
      password: "password12345",
      username: "bob2",
      displayName: "Bob2",
    }),
  });

  const aliceKeys = createDeviceKeys();
  const bobKeys = createDeviceKeys();
  const aliceBundle = exportPublicBundle(aliceKeys);
  const bobBundle = exportPublicBundle(bobKeys);

  const aliceDev = (await req(aliceJar, "/devices", {
    method: "POST",
    body: JSON.stringify(aliceBundle),
  })) as { deviceId: string };
  await req(bobJar, "/devices", {
    method: "POST",
    body: JSON.stringify(bobBundle),
  });

  const bobCard = (await req(aliceJar, "/users/lookup?username=bob2")) as {
    userId: string;
  };
  const bobRemote = (await req(
    aliceJar,
    `/users/${bobCard.userId}/key-bundle`,
  )) as {
    identityPublicKey: string;
    signedPrekeyId: number;
    signedPrekeyPublicKey: string;
  };

  const { session: aSess, ephemeralPublicKey } = initiateSession(aliceKeys, {
    identityPublicKey: bobRemote.identityPublicKey,
    signedPrekeyId: bobRemote.signedPrekeyId,
    signedPrekeyPublicKey: bobRemote.signedPrekeyPublicKey,
  });
  const { envelope } = encryptText(aSess, "secret hello", {
    ephemeralPublicKey,
    senderIdentityPublicKey: aliceBundle.identityPublicKey,
  });

  const conversation = (await req(aliceJar, "/conversations", {
    method: "POST",
    body: JSON.stringify({ peerUserId: bobCard.userId }),
  })) as { conversationId: string };

  const aliceSession = (await req(aliceJar, "/auth/session")) as {
    user: { communicationEpoch: number };
  };

  await req(aliceJar, `/conversations/${conversation.conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messageId: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
      deviceId: aliceDev.deviceId,
      communicationEpoch: aliceSession.user.communicationEpoch,
      cryptoHeader: envelope.cryptoHeader,
      ciphertext: envelope.ciphertext,
    }),
  });

  const bobView = (await req(
    bobJar,
    `/conversations/${conversation.conversationId}/messages`,
  )) as {
    messages: Array<{ cryptoHeader: string; ciphertext: string }>;
  };
  const wire = bobView.messages[0]!;
  const bSess = acceptSession(
    bobKeys,
    aliceBundle.identityPublicKey,
    ephemeralPublicKey,
  );
  const { plaintext } = decryptText(bSess, {
    cryptoHeader: wire.cryptoHeader,
    ciphertext: wire.ciphertext,
  });

  console.log("ciphertext prefix", wire.ciphertext.slice(0, 32));
  console.log("decrypted", plaintext);
  if (plaintext !== "secret hello") process.exit(1);
  console.log("e2ee smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
