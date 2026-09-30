const JSON_HEADERS = { "Content-Type": "application/json" };

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ?? `Request failed (${res.status})`,
    );
  }
  return data;
}

export const api = {
  post<T>(path: string, body: unknown) {
    return fetch(`/api/v1${path}`, {
      method: "POST",
      credentials: "include",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }).then((r) => parse<T>(r));
  },
  get<T>(path: string) {
    return fetch(`/api/v1${path}`, {
      method: "GET",
      credentials: "include",
    }).then((r) => parse<T>(r));
  },
  async putBinary(path: string, data: Uint8Array) {
    const res = await fetch(`/api/v1${path}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: data,
    });
    return parse<{ ok: boolean }>(res);
  },
  async getBinary(path: string): Promise<Uint8Array> {
    const res = await fetch(`/api/v1${path}`, {
      method: "GET",
      credentials: "include",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Request failed (${res.status})`);
    }
    return new Uint8Array(await res.arrayBuffer());
  },
};
