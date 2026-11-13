/**
 * The one way this project talks to the SEC.
 *
 * - Every request carries the declared User-Agent (lib/sec/user-agent.ts; there is no default).
 * - All callers of one client share one limiter: at most 8 requests start in any rolling second.
 * - Server errors and network errors are retried a few times, slowly. A 404 is not.
 * - A 403 or 429 means the SEC is throttling or has blocked the tool. The client then stops every
 *   request for 10 minutes instead of hammering, which is what turns a short block into a long one.
 *
 * The worker creates one client and hands it to every job, so the limit holds across all of them.
 */
import { secUserAgent, secUserAgentProblem, SecUserAgentError } from "./user-agent";

export type SecClient = {
  text(url: string): Promise<string>;
  json<T = unknown>(url: string): Promise<T>;
  stats(): { requests: number; retries: number; pausedUntil: number | null };
};

export class SecHttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string, message?: string) {
    super(message ?? `The SEC answered ${status} for ${url}`);
    this.name = "SecHttpError";
    this.status = status;
    this.url = url;
  }
}

export type SecClientOptions = {
  userAgent?: string;
  /** Request starts allowed in any rolling second. Never above 8, whatever is passed. */
  maxPerSecond?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Where the "paused" line goes (default: console.warn). */
  log?: (line: string) => void;
};

export const SEC_HOSTS: readonly string[] = ["www.sec.gov", "data.sec.gov"];
export const SEC_MAX_PER_SECOND = 8;
export const SEC_TIMEOUT_MS = 20_000;
export const SEC_PAUSE_MS = 10 * 60_000;
const MAX_RETRIES = 3;
const MAX_REDIRECTS = 3;
/** A little over a second, so a timer that fires a hair early can never let a ninth request in. */
const WINDOW_MS = 1010;
const ACCEPT_TEXT = "application/atom+xml, application/xml, text/xml, text/html, text/plain;q=0.9, */*;q=0.5";
const ACCEPT_JSON = "application/json, */*;q=0.5";

/** Throws unless the URL is https on one of the SEC's two hosts. */
export function assertSecUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (u.protocol !== "https:") throw new Error(`SEC requests must use https: ${url}`);
  if (!SEC_HOSTS.includes(u.hostname) || (u.port !== "" && u.port !== "443") || u.username || u.password) {
    throw new Error(`Not an SEC address (only www.sec.gov and data.sec.gov are allowed): ${url}`);
  }
  return u;
}

/** "120" (seconds) or an HTTP date -> milliseconds from now, or null. */
function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(at - now, 0) : null;
}

/** The SEC's feeds say ISO-8859-1 in their first line; everything else is UTF-8. */
function decode(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? "")?.[1];
  let charset = fromHeader;
  if (!charset) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
    charset = /<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder((charset ?? "utf-8").toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function createSecClient(opts: SecClientOptions = {}): SecClient {
  // Resolved once, here, so a missing or placeholder value stops the worker before the first request.
  let userAgent: string;
  if (opts.userAgent !== undefined) {
    const problem = secUserAgentProblem(opts.userAgent);
    if (problem) throw new SecUserAgentError(`${problem.replace("SEC_USER_AGENT", "The SEC User-Agent")}.`);
    userAgent = opts.userAgent.trim();
  } else {
    userAgent = secUserAgent();
  }
  const wanted = Math.floor(opts.maxPerSecond ?? SEC_MAX_PER_SECOND);
  const maxPerSecond = Math.min(SEC_MAX_PER_SECOND, Math.max(1, Number.isFinite(wanted) ? wanted : SEC_MAX_PER_SECOND));
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((line: string) => console.warn(line));

  let requests = 0;
  let retries = 0;
  let pausedUntil = 0;
  let pausedStatus = 0;

  const paused = () => pausedUntil > now();
  const pausedError = (url: string) =>
    new SecHttpError(
      pausedStatus,
      url,
      `SEC requests are paused until ${new Date(pausedUntil).toISOString()} after the SEC answered ${pausedStatus}; not sent: ${url}`,
    );

  /** Times of the most recent request starts (at most maxPerSecond of them). */
  const starts: number[] = [];
  /** Callers take their turn one at a time, in the order they asked. */
  let line: Promise<void> = Promise.resolve();
  function takeSlot(): Promise<void> {
    const turn = line.then(async () => {
      for (;;) {
        if (paused()) return; // the caller sees the pause and stops; nobody waits for nothing
        const t = now();
        while (starts.length && t - starts[0] >= WINDOW_MS) starts.shift();
        if (starts.length < maxPerSecond) {
          starts.push(t);
          return;
        }
        await sleep(Math.max(starts[0] + WINDOW_MS - t, 1));
      }
    });
    line = turn.catch(() => {});
    return turn;
  }

  function pause(status: number, url: string, retryAfter: number | null) {
    const until = now() + Math.max(SEC_PAUSE_MS, retryAfter ?? 0);
    const alreadyPaused = paused();
    pausedUntil = Math.max(pausedUntil, until);
    pausedStatus = status;
    if (!alreadyPaused) {
      log(
        `[sec] The SEC answered ${status} for ${url}. It is throttling or has blocked this tool: ` +
          `every SEC request is stopped until ${new Date(pausedUntil).toISOString()}. ` +
          `Check that SEC_USER_AGENT names the company and a monitored email.`,
      );
    }
  }

  /** One attempt, following redirects only while they stay on the SEC's hosts. */
  async function attempt(url: string, accept: string): Promise<Response> {
    let target = url;
    for (let hop = 0; ; hop++) {
      if (paused()) throw pausedError(url);
      await takeSlot();
      if (paused()) throw pausedError(url);
      requests++;
      const res = await doFetch(target, {
        headers: { "User-Agent": userAgent, Accept: accept, "Accept-Encoding": "gzip, deflate" },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(SEC_TIMEOUT_MS),
      });
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location || hop >= MAX_REDIRECTS) throw new SecHttpError(res.status, url, `The SEC redirected ${url} too many times or to nowhere`);
        target = assertSecUrl(new URL(location, target).toString()).toString();
        continue;
      }
      return res;
    }
  }

  async function get(url: string, accept: string): Promise<string> {
    assertSecUrl(url);
    let failure: unknown;
    for (let tries = 0; tries <= MAX_RETRIES; tries++) {
      if (tries > 0) {
        retries++;
        const wait = (failure as { retryAfter?: number | null })?.retryAfter ?? null;
        // 0.5 s, 1 s, 2 s, each with up to 250 ms added so parallel callers do not retry in step.
        await sleep(Math.min(wait ?? 500 * 2 ** (tries - 1), 60_000) + Math.floor(Math.random() * 250));
      }
      let res: Response;
      try {
        res = await attempt(url, accept);
      } catch (e) {
        if (e instanceof SecHttpError || paused()) throw e instanceof SecHttpError ? e : pausedError(url);
        failure = e; // network error or timeout: try again
        continue;
      }
      if (res.status === 403 || res.status === 429) {
        await res.body?.cancel().catch(() => {});
        pause(res.status, url, retryAfterMs(res.headers.get("retry-after"), now()));
        throw new SecHttpError(res.status, url);
      }
      if (res.status >= 500) {
        const retryAfter = retryAfterMs(res.headers.get("retry-after"), now());
        await res.body?.cancel().catch(() => {});
        failure = Object.assign(new SecHttpError(res.status, url), { retryAfter });
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new SecHttpError(res.status, url);
      }
      try {
        return decode(new Uint8Array(await res.arrayBuffer()), res.headers.get("content-type"));
      } catch (e) {
        failure = e; // the connection dropped or timed out while the body was arriving
      }
    }
    if (failure instanceof SecHttpError) throw failure;
    throw new Error(`SEC request failed after ${MAX_RETRIES + 1} tries: ${url}: ${(failure as Error)?.message ?? failure}`);
  }

  return {
    text: (url) => get(url, ACCEPT_TEXT),
    async json<T = unknown>(url: string): Promise<T> {
      const body = await get(url, ACCEPT_JSON);
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new Error(`The SEC sent something that is not JSON for ${url}`);
      }
    },
    stats: () => ({ requests, retries, pausedUntil: paused() ? pausedUntil : null }),
  };
}
