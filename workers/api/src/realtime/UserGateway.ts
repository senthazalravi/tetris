import { DurableObject } from "cloudflare:workers";

/**
 * One Durable Object per user. It only fans small JSON events out to that
 * user's open tabs; message bodies never pass through it (clients pull the
 * ciphertext from /sync after a nudge).
 */
export class UserGateway extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    // Keep-alive without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (request.method === "POST" && url.pathname === "/push") {
      const payload = await request.text();
      let delivered = 0;
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(payload);
          delivered += 1;
        } catch {
          // Socket is closing; the runtime cleans it up.
        }
      }
      return Response.json({ ok: true, delivered });
    }

    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(): void {
    // Clients only send keep-alive pings, handled by the auto-response.
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code, "closed");
    } catch {
      // Already closed.
    }
  }
}
