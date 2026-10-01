export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let vaultToken: string | null = null;
let onAuthLost: ((code: string) => void) | null = null;

export function setVaultToken(token: string | null) {
  vaultToken = token;
}
export function getVaultToken() {
  return vaultToken;
}
export function setAuthLostHandler(fn: ((code: string) => void) | null) {
  onAuthLost = fn;
}

async function request<T>(
  method: string,
  path: string,
  init: { body?: unknown; raw?: Uint8Array; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.raw) {
    headers["Content-Type"] = "application/octet-stream";
    body = init.raw as unknown as BodyInit;
  } else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  if (vaultToken) headers["X-Tetris-Vault"] = vaultToken;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body,
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "You appear to be offline", "NETWORK");
  }

  const isBinary = res.headers.get("content-type")?.includes("octet-stream");
  if (res.ok) {
    if (isBinary) return new Uint8Array(await res.arrayBuffer()) as unknown as T;
    return (await res.json().catch(() => ({}))) as T;
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  } & Record<string, unknown>;
  const err = new ApiError(
    res.status,
    data.error ?? `Request failed (${res.status})`,
    data.code,
    data,
  );
  if (
    (res.status === 403 && data.code === "VAULT_LOCKED") ||
    (res.status === 401 && data.code === "NO_SESSION")
  ) {
    onAuthLost?.(data.code);
  }
  throw err;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  del: <T>(path: string) => request<T>("DELETE", path),
  putBinary: <T>(path: string, raw: Uint8Array) => request<T>("PUT", path, { raw }),
  getBinary: (path: string) => request<Uint8Array>("GET", path),
};
