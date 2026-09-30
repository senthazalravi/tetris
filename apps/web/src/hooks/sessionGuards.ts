import { useEffect, useState } from "react";

/**
 * Soft-locks the vault after idle time — user must re-enter passcode.
 */
export function useIdleVaultLock(
  enabled: boolean,
  onLock: () => void,
  idleMs = 5 * 60_000,
) {
  useEffect(() => {
    if (!enabled) return;
    let timer = window.setTimeout(onLock, idleMs);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onLock, idleMs);
    };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, [enabled, onLock, idleMs]);
}

/** Sync unlock/wipe across tabs in the same browser profile. */
export function useMultiTabSync(handlers: {
  onLock?: () => void;
  onWipe?: () => void;
}) {
  useEffect(() => {
    const bc = new BroadcastChannel("lop-session");
    bc.onmessage = (ev) => {
      const type = (ev.data as { type?: string })?.type;
      if (type === "lock") handlers.onLock?.();
      if (type === "wipe") handlers.onWipe?.();
    };
    return () => bc.close();
  }, [handlers]);
}

export function broadcastSessionEvent(type: "lock" | "wipe") {
  const bc = new BroadcastChannel("lop-session");
  bc.postMessage({ type });
  bc.close();
}

export function useTypingDots(active: boolean) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setFrame((f) => (f + 1) % 3), 400);
    return () => window.clearInterval(id);
  }, [active]);
  return frame;
}
