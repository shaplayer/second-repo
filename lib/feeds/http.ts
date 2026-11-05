import { SEC_USER_AGENT } from "./sources";

export async function fetchText(url: string, timeoutMs = 9000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/atom+xml, application/rss+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.8",
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Tiny in-process TTL cache with stale-while-revalidate. */
type Entry<T> = { value?: T; expires: number; inflight?: Promise<T> };
const g = globalThis as unknown as { __bsCache?: Map<string, Entry<unknown>> };
const store = (g.__bsCache ??= new Map());

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const e = store.get(key) as Entry<T> | undefined;
  const now = Date.now();
  if (e?.value !== undefined && e.expires > now) return e.value;

  const refresh = () => {
    const entry = (store.get(key) as Entry<T>) ?? { expires: 0 };
    if (!entry.inflight) {
      entry.inflight = load()
        .then((v) => { entry.value = v; entry.expires = Date.now() + ttlMs; return v; })
        .finally(() => { entry.inflight = undefined; });
      store.set(key, entry as Entry<unknown>);
    }
    return entry.inflight;
  };

  if (e?.value !== undefined) {
    refresh().catch(() => {}); // serve stale, refresh in background
    return e.value;
  }
  return refresh();
}
