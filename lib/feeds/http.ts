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

/**
 * Polite fetch for feeds that get polled repeatedly (RSS, EDGAR "latest filings").
 * - Sends If-None-Match / If-Modified-Since, so an unchanged feed is a cheap 304.
 * - After a 403 or 429 (blocked or rate-limited), stops asking that host for 30 minutes
 *   (or the Retry-After it gives) instead of hammering it, which tends to extend a block.
 */
type Validators = { etag?: string; lastModified?: string; body: string };
const gv = globalThis as unknown as { __bsFeedCache?: Map<string, Validators>; __bsBackoff?: Map<string, number> };
const validators = (gv.__bsFeedCache ??= new Map());
const backoff = (gv.__bsBackoff ??= new Map());
const BACKOFF_MS = 30 * 60 * 1000;

export async function fetchFeed(url: string, timeoutMs = 9000): Promise<string> {
  const host = new URL(url).host;
  const until = backoff.get(host) ?? 0;
  if (until > Date.now()) {
    throw new Error(`${host} refused recently; backing off until ${new Date(until).toISOString().slice(11, 16)} UTC`);
  }
  const prev = validators.get(url);
  const headers: Record<string, string> = {
    "User-Agent": SEC_USER_AGENT,
    Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
  };
  if (prev?.etag) headers["If-None-Match"] = prev.etag;
  if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (res.status === 304 && prev) return prev.body;
  if (res.status === 403 || res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    backoff.set(host, Date.now() + (retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS));
    throw new Error(`${res.status} ${res.statusText} for ${url} (pausing ${host} for ${retryAfter > 0 ? `${retryAfter}s` : "30 min"})`);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const body = await res.text();
  validators.set(url, {
    etag: res.headers.get("etag") ?? undefined,
    lastModified: res.headers.get("last-modified") ?? undefined,
    body,
  });
  return body;
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
