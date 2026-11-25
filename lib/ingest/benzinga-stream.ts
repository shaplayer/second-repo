import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";
import WebSocket, { type RawData } from "ws";
import { parseBenzingaNews, storeBenzingaNews } from "./benzinga";
import { runJob, setJobDetail } from "./state";

const STREAM_URL = "wss://api.benzinga.com/api/v1/news/stream";
const MAX_PENDING = 500;

type StreamOptions = {
  token?: string;
  connect?: (url: string) => WebSocket;
  pingMs?: number;
  sourceCheckMs?: number;
  connectTimeoutMs?: number;
  retryMs?: number;
};

type SessionHandlers = {
  connected: () => Promise<void>;
  enabled: () => Promise<boolean>;
  message: (text: string) => Promise<void>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decode the provider's envelope without logging its article body or credentials. */
export function parseBenzingaStreamMessage(text: string): Record<string, unknown> | null {
  if (text === "pong") return null;
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    throw new Error("Benzinga stream sent invalid JSON");
  }
  if (!record(message) || (message.kind !== "news" && message.kind !== "News/v1") || !record(message.data) || typeof message.data.action !== "string") {
    throw new Error("Benzinga stream sent an invalid news envelope");
  }
  const action = message.data.action.toLowerCase();
  if (action === "updated" || action === "deleted") return null;
  if (action !== "created" || !record(message.data.content) ||
      typeof message.data.id !== "number" || !Number.isSafeInteger(message.data.id) || message.data.id <= 0 ||
      typeof message.data.content.id !== "number" || !Number.isSafeInteger(message.data.content.id) ||
      message.data.content.id <= 0 ||
      (message.kind === "news" && message.data.id !== message.data.content.id)) {
    throw new Error("Benzinga stream sent an invalid created event");
  }
  const content = message.data.content;
  if (message.kind === "news") return content;
  return {
    ...content,
    created: content.created_at,
    stocks: Array.isArray(content.securities)
      ? content.securities.map((security: unknown) => record(security) ? { ...security, name: security.symbol } : security)
      : content.securities,
  };
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}

async function sourceEnabled(db: Pool): Promise<boolean> {
  const { rows } = await db.query(`select 1 from public.news_sources where key = 'benzinga' and enabled`);
  return rows.length > 0;
}

async function recordConnection(db: Pool, status: string): Promise<void> {
  try {
    await setJobDetail(db, "benzinga-stream", { status, at: new Date().toISOString() });
  } catch {
    console.error("[benzinga-stream] could not record connection status");
  }
}

export async function streamSession(token: string, signal: AbortSignal, opts: StreamOptions, handlers: SessionHandlers): Promise<number> {
  const url = new URL(STREAM_URL);
  url.searchParams.set("token", token);
  const socket = (opts.connect ?? ((address) => new WebSocket(address)))(url.toString());
  let openedAt = 0;
  let pending = 0;
  let failed = false;
  let awaitingPong = false;
  let queue = Promise.resolve();
  let sourceCheck: Promise<void> | undefined;
  let statusUpdate = Promise.resolve();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let sourceTimer: ReturnType<typeof setInterval> | undefined;
  const connectTimer = setTimeout(() => {
    console.error("[benzinga-stream] connection timed out");
    socket.terminate();
  }, opts.connectTimeoutMs ?? 15_000);
  const abort = () => socket.terminate();
  signal.addEventListener("abort", abort, { once: true });

  try {
    await new Promise<void>((resolve) => {
      socket.on("open", () => {
        clearTimeout(connectTimer);
        openedAt = Date.now();
        console.log("[benzinga-stream] connected; requesting recent replay");
        statusUpdate = handlers.connected();
        socket.send("replay");
        heartbeat = setInterval(() => {
          if (awaitingPong) {
            console.error("[benzinga-stream] heartbeat timed out");
            socket.terminate();
            return;
          }
          awaitingPong = true;
          socket.send("ping");
        }, opts.pingMs ?? 30_000);
        sourceTimer = setInterval(() => {
          if (sourceCheck) return;
          sourceCheck = handlers.enabled().then((enabled) => {
            if (!enabled) {
              console.log("[benzinga-stream] source disabled; disconnecting");
              socket.terminate();
            }
          }).catch(() => {
            console.error("[benzinga-stream] could not check source permissions");
            socket.terminate();
          }).finally(() => { sourceCheck = undefined; });
        }, opts.sourceCheckMs ?? 30_000);
      });
      socket.on("message", (data, binary) => {
        if (binary) {
          console.error("[benzinga-stream] unexpected binary message");
          socket.terminate();
          return;
        }
        const text = textOf(data);
        console.log(`[benzinga-stream] received message: ${text}`);
        if (text === "pong") {
          awaitingPong = false;
          return;
        }
        if (pending >= MAX_PENDING) {
          console.error("[benzinga-stream] message backlog exceeded; reconnecting for replay");
          socket.terminate();
          return;
        }
        pending++;
        queue = queue.then(async () => {
          if (failed) return;
          try {
            await handlers.message(text);
          } catch {
            failed = true;
            console.error("[benzinga-stream] message could not be stored; reconnecting for replay");
            socket.terminate();
          }
        }).finally(() => { pending--; });
      });
      socket.on("error", () => {
        // ws errors may include the URL, which contains the token.
        console.error("[benzinga-stream] connection error");
      });
      socket.on("close", () => {
        clearTimeout(connectTimer);
        if (heartbeat) clearInterval(heartbeat);
        if (sourceTimer) clearInterval(sourceTimer);
        resolve();
      });
      if (signal.aborted) abort();
    });
    await queue;
    await statusUpdate;
    await sourceCheck;
    return openedAt;
  } finally {
    clearTimeout(connectTimer);
    if (heartbeat) clearInterval(heartbeat);
    if (sourceTimer) clearInterval(sourceTimer);
    signal.removeEventListener("abort", abort);
  }
}

/** One connection per API key. Replay is bounded by the provider, so polling remains enabled. */
export async function runBenzingaStream(db: Pool, signal: AbortSignal, opts: StreamOptions = {}): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      if (await sourceEnabled(db)) {
        const token = (opts.token ?? process.env.BENZINGA_API_TOKEN ?? "").trim();
        if (!token) throw new Error("BENZINGA_API_TOKEN is required while the Benzinga source is enabled");
        const openedAt = await streamSession(token, signal, opts, {
          connected: () => recordConnection(db, "connected"),
          enabled: () => sourceEnabled(db),
          message: async (text) => {
            let article: unknown;
            try {
              article = parseBenzingaStreamMessage(text);
              console.log(`[benzinga-stream] parsed article:`, article);
            } catch (e) {
              console.error(`[benzinga-stream] ${(e as Error).message}; event ignored`);
              return;
            }
            if (article === null) return;
            const result = await runJob(db, "benzinga-stream", async () => {
              await storeBenzingaNews(db, parseBenzingaNews([article]));
              return true;
            });
            if (result === null) throw new Error("Benzinga article could not be stored");
          },
        });
        if (signal.aborted) break;
        if (openedAt && Date.now() - openedAt >= 60_000) failures = 0;
        console.error("[benzinga-stream] disconnected; replay is limited to 100 cached messages");
        await recordConnection(db, "disconnected");
        failures++;
      } else {
        failures = 0;
      }
    } catch (e) {
      // Socket errors can include the token, so do not print their messages.
      if (e instanceof Error && e.message.startsWith("BENZINGA_API_TOKEN")) throw e;
      console.error("[benzinga-stream] could not start or check connection");
      await recordConnection(db, "error");
      failures++;
    }
    const delay = failures ? Math.min((opts.retryMs ?? 2_000) * 2 ** Math.min(failures - 1, 5), 60_000) * (0.8 + Math.random() * 0.4) : (opts.sourceCheckMs ?? 30_000);
    try {
      await sleep(delay, undefined, { signal });
    } catch (e) {
      if (!signal.aborted) throw e;
    }
  }
  await recordConnection(db, "stopped");
}
