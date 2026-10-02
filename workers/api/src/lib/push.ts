import type { RealtimeEvent } from "@tetris/types";
import type { Env } from "../env";

/** Returns how many open tabs received the event (0 when the user is offline). */
export async function pushToUser(
  env: Env,
  userId: string,
  event: RealtimeEvent,
): Promise<number> {
  try {
    const stub = env.USER_GATEWAY.get(env.USER_GATEWAY.idFromName(userId));
    const res = await stub.fetch("https://gateway/push", {
      method: "POST",
      body: JSON.stringify(event),
    });
    const body = (await res.json().catch(() => ({}))) as { delivered?: number };
    return body.delivered ?? 0;
  } catch {
    // The user simply has no live connection; the sync feed covers them.
    return 0;
  }
}
