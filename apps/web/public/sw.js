/*
 * Minimal service worker. It exists so the browser offers "Install app" and so
 * notifications can be shown and clicked. It deliberately caches nothing:
 * every request goes to the network, so messages and keys are never stored by
 * the worker and a new deploy is picked up immediately.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only page loads get a (tiny) offline message; everything else is untouched.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response("You are offline. Reconnect to open Tetris.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) return w.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
