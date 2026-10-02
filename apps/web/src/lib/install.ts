import { useSyncExternalStore } from "react";

/**
 * "Install app" support. Browsers fire `beforeinstallprompt` once, early, and
 * only if the site is installable (manifest + service worker + HTTPS). We keep
 * that event so any button can open the browser's own install dialog later,
 * the same way YouTube does.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Call once at startup, before React renders. */
export function initInstallPrompt() {
  installed = standalone();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** Register the (cache-free) service worker. Production only, so dev stays simple. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installability is optional; the app works without it */
    });
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** True while the browser is willing to show its install dialog. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null && !installed,
    () => false,
  );
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const ev = deferred;
  if (!ev) return "unavailable";
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  // The event can only be used once; the browser fires a new one if it is dismissed.
  deferred = null;
  emit();
  return outcome;
}
