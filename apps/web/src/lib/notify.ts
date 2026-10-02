/**
 * Incoming-message alerts: a clear, audible chime (Web Audio, so no binary
 * asset) and, when the tab is in the background, a system notification.
 * Notifications never show message text, only who it is from.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let armed = false;
let lastPlayed = 0;
const DEBOUNCE_MS = 900;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx || ctx.state === "closed") {
    ctx = new AC();
    // A gentle limiter lets the chime be loud without clipping on small speakers.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  return ctx;
}

/** Call once the first live sync has finished so catch-up history stays silent. */
export function armIncomingSounds() {
  armed = true;
  // Unlock may already count as a gesture; resume now and again on the next tap.
  void audio()
    ?.resume()
    .catch(() => {});
  const unlock = () => {
    void audio()
      ?.resume()
      .catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function disarmIncomingSounds() {
  armed = false;
  void ctx?.close().catch(() => {});
  ctx = null;
  master = null;
}

/** One bell-like note: a triangle fundamental plus a sine an octave up for clarity. */
function note(ac: AudioContext, at: number, freq: number, dur: number, gain: number) {
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0005, at + dur);
  out.connect(master ?? ac.destination);

  for (const [type, mult, level] of [
    ["triangle", 1, 1],
    ["sine", 2, 0.35],
  ] as const) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq * mult;
    g.gain.value = level;
    osc.connect(g);
    g.connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }
}

/**
 * Three rising notes (A5, E6, A6), loud and bright. Plays in the background too,
 * so a message is heard even when the tab is not in front. Silent until armed.
 */
export function playIncomingTone() {
  if (!armed) return;
  const now = Date.now();
  if (now - lastPlayed < DEBOUNCE_MS) return;
  const ac = audio();
  if (!ac) return;
  lastPlayed = now;
  void ac
    .resume()
    .then(() => {
      const t0 = ac.currentTime;
      note(ac, t0, 880, 0.2, 0.55);
      note(ac, t0 + 0.14, 1319, 0.2, 0.55);
      note(ac, t0 + 0.28, 1760, 0.5, 0.6);
    })
    .catch(() => {});
}

/* ------------------------- system notifications ------------------------- */

export type NotifyPermission = NotificationPermission | "unsupported";

export function notificationPermission(): NotifyPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Must be called from a click: browsers only show the permission prompt for a gesture. */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Shown only while the app is in the background; clicking brings it back. */
export function showIncomingNotification(body: string, tag: string) {
  if (notificationPermission() !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  const options: NotificationOptions & { renotify?: boolean } = {
    body,
    tag,
    renotify: true,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  };
  const fallback = () => {
    try {
      const n = new Notification("Tetris", options);
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* some mobile browsers only allow service-worker notifications */
    }
  };
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => (reg ? reg.showNotification("Tetris", options) : fallback()))
      .catch(fallback);
  } else {
    fallback();
  }
}
