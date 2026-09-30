import { useEffect, useRef } from "react";

/** Connects to the user gateway WebSocket for live events. */
export function useRealtime(onEvent: (data: unknown) => void, enabled: boolean) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    // Dev: Vite proxies /api; WS goes to API host via relative upgrade through proxy if configured.
    const url = `${proto}://${window.location.host}/api/v1/ws`;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          handler.current(JSON.parse(String(ev.data)));
        } catch {
          /* ignore */
        }
      };
      ws.onopen = () => {
        retry = 0;
      };
      ws.onclose = () => {
        if (closed) return;
        const delay = Math.min(10_000, 500 * 2 ** retry);
        retry += 1;
        window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [enabled]);
}
