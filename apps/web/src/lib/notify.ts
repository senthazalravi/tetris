/**
 * Short in-tab incoming-message tone. Generated with Web Audio so we don't
 * ship a binary asset, and so it still works offline after unlock.
 */

let ctx: AudioContext | null = null;
let armed = false;
let lastPlayed = 0;
const DEBOUNCE_MS = 900;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx || ctx.state === "closed") ctx = new AC();
  return ctx;
}

/** Call once the first live sync has finished so catch-up history stays silent. */
export function armIncomingSounds() {
  armed = true;
  // Unlock may already count as a gesture; resume now and again on the next tap.
  void audio()?.resume().catch(() => {});
  const unlock = () => {
    void audio()?.resume().catch(() => {});
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
}

function tone(ac: AudioContext, at: number, freq: number, dur: number, gain = 0.05) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Soft two-note chime. No-ops when the tab is hidden or sounds aren't armed yet. */
export function playIncomingTone() {
  if (!armed) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const now = Date.now();
  if (now - lastPlayed < DEBOUNCE_MS) return;
  const ac = audio();
  if (!ac) return;
  lastPlayed = now;
  void ac.resume().then(() => {
    const t0 = ac.currentTime;
    tone(ac, t0, 988, 0.1, 0.045);
    tone(ac, t0 + 0.1, 1319, 0.16, 0.04);
  }).catch(() => {});
}
