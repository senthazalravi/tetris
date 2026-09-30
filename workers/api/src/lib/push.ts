import type { RealtimeEvent } from "@lop/types";
import type { Env } from "../env";

export async function pushToUser(
  env: Env,
  userId: string,
  event: RealtimeEvent,
): Promise<void> {
  try {
    const stub = env.USER_GATEWAY.get(env.USER_GATEWAY.idFromName(userId));
    await stub.fetch("https://gateway/push", {
      method: "POST",
      body: JSON.stringify(event),
    });
  } catch {
    // The user simply has no live connection; the sync feed covers them.
  }
}
