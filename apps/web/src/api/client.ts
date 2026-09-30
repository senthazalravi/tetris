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
};
