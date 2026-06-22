export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const isServer = typeof window === "undefined";
  const base = isServer
    ? (process.env.TASKFORGE_API_URL ?? "http://localhost:3001")
    : "";
  const url = `${base}${path}`;

  const headers = new Headers(options?.headers);
  if (isServer) {
    try {
      const { cookies } = await import("next/headers");
      const cookieStore = cookies();
      const cookie = cookieStore.toString();
      if (cookie) {
        headers.set("Cookie", cookie);
      }
    } catch {
      // Not in a request context (e.g. static generation)
    }
  }

  if (options?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
    cache: options?.cache ?? "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `API ${options?.method ?? "GET"} ${path} failed: ${res.status} ${text}`,
    );
  }

  return res.json() as Promise<T>;
}
