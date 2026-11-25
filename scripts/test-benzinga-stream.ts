import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import WebSocket, { WebSocketServer } from "ws";
import { matchNewItems } from "../lib/alerts/match";
import { getFeed } from "../lib/data/feed";
import { connectionConfig } from "../lib/db/connect";
import { parseBenzingaNews, pollBenzingaNews } from "../lib/ingest/benzinga";
import { parseBenzingaStreamMessage, runBenzingaStream, streamSession } from "../lib/ingest/benzinga-stream";
import { finish, test } from "./testing";
import { withTestDatabase } from "./testing-db";

const article = {
  id: 8273616, title: "Companies announce partnership",
  url: "https://www.benzinga.com/news/example-partnership",
  created: new Date().toISOString(), body: "Licensed text",
  stocks: [{ name: "AAPL", exchange: "NASDAQ" }, { name: "MSFT", exchange: "NASDAQ" }],
};
const event = (action: string, content: unknown = article) =>
  JSON.stringify({ id: "message-1", kind: "news", data: { action, id: article.id, content } });
const streamArticle = {
  id: 63615018, title: "Companies announce a new agreement",
  url: "https://www.benzinga.com/news/stream-agreement",
  created_at: new Date(Date.now() - 60_000).toISOString(), body: "<p>First &amp; second paragraphs.</p><p>More details.</p>",
  securities: [{ symbol: "AAPL", exchange: "NASDAQ", primary: true }, { symbol: "MSFT", exchange: "NASDAQ" }],
};
const versionedEvent = (action: string, content: unknown = streamArticle) =>
  JSON.stringify({ api_version: "websocket/v1", kind: "News/v1", data: { action, id: 111669964, content } });

async function waitUntil(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await sleep(20);
  }
  throw new Error("Timed out waiting for the stream");
}

async function main() {
  await test("stream envelopes accept created events and leave updates and removals alone", () => {
    assert.deepEqual(parseBenzingaStreamMessage(event("Created")), article);
    assert.equal(parseBenzingaStreamMessage(event("updated")), null);
    assert.equal(parseBenzingaStreamMessage(event("Deleted")), null);
    assert.equal(parseBenzingaStreamMessage("pong"), null);
    assert.throws(() => parseBenzingaStreamMessage("{"), /invalid JSON/);
    assert.throws(() => parseBenzingaStreamMessage(event("created", { ...article, id: 1 })), /invalid created/);
    assert.throws(() => parseBenzingaStreamMessage(event("unknown")), /invalid created/);
  });

  await test("versioned stream events normalize article fields for the shared news parser", () => {
    const content = parseBenzingaStreamMessage(versionedEvent("Created"));
    const items = parseBenzingaNews([content]);
    assert.equal(items.length, 1);
    assert.equal(items[0].articleId, String(streamArticle.id));
    assert.equal(items[0].title, streamArticle.title);
    assert.equal(items[0].url, streamArticle.url);
    assert.equal(items[0].publishedAt, streamArticle.created_at);
    assert.deepEqual(items[0].tickers, ["AAPL", "MSFT"]);
    assert.equal(items[0].description, "First & second paragraphs.\nMore details.");
    assert.equal(parseBenzingaStreamMessage(versionedEvent("Updated")), null);
    assert.equal(parseBenzingaStreamMessage(versionedEvent("Deleted")), null);
    assert.throws(() => parseBenzingaStreamMessage(versionedEvent("Created", { ...streamArticle, id: 0 })), /invalid created/);
    assert.throws(() => parseBenzingaStreamMessage(JSON.stringify({ kind: "other", data: { action: "Created" } })), /invalid news envelope/);
  });

  await test("socket requests replay, keeps alive and processes messages in order", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test socket did not bind");
    const stop = new AbortController();
    const received: string[] = [];
    let ping = false;
    server.on("connection", (socket) => {
      socket.on("message", (message) => {
        if (message.toString() === "replay") {
          socket.send("first");
          socket.send("second");
        } else if (message.toString() === "ping") {
          ping = true;
          socket.send("pong");
        }
      });
    });
    const session = streamSession("test-token", stop.signal, {
      pingMs: 50, sourceCheckMs: 100,
      connect: (url) => {
        assert.equal(new URL(url).searchParams.get("token"), "test-token");
        return new WebSocket(`ws://127.0.0.1:${address.port}`);
      },
    }, {
      connected: async () => {},
      enabled: async () => true,
      message: async (text) => {
        if (text === "first") await sleep(20);
        received.push(text);
      },
    });
    try {
      await waitUntil(() => received.length === 2 && ping);
      assert.deepEqual(received, ["first", "second"]);
    } finally {
      stop.abort();
      await session;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  const ran = await withTestDatabase("benzinga_stream", async (client, url) => {
    const db = new Pool({ ...connectionConfig(url), max: 4 });
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test socket did not bind");
    const stop = new AbortController();
    let connections = 0;
    let pings = 0;
    const token = "test-token-not-for-logs";
    server.on("connection", (socket) => {
      connections++;
      socket.on("message", (message) => {
        const command = message.toString();
        if (command === "ping") {
          pings++;
          socket.send("pong");
        }
        if (command === "replay") {
          socket.send(event("created"));
          socket.send(event("created"));
          socket.send(event("updated", { ...article, title: "Changed headline" }));
          socket.send(event("deleted"));
        }
      });
    });
    const worker = runBenzingaStream(db, stop.signal, {
      token, retryMs: 20, pingMs: 100, sourceCheckMs: 100,
      connect: (streamUrl) => {
        assert.equal(new URL(streamUrl).searchParams.get("token"), token);
        return new WebSocket(`ws://127.0.0.1:${address.port}`);
      },
    });
    try {
      await test("stream and poll share an atomic, idempotent writer and survive reconnect", async () => {
        await client.query(
          `insert into public.alert_subscriptions (channel, address, cik, status, unsubscribe_token)
           values ('email', 'stream-test@example.org', 789019, 'active', 'stream_test_token_123456')`,
        );
        const fakeFetch: typeof fetch = async () => new Response(JSON.stringify([article]), {
          headers: { "content-type": "application/json" },
        });
        await Promise.all([
          pollBenzingaNews(db, { fetch: fakeFetch, token }),
          waitUntil(async () => Number((await client.query(`select count(*) as n from public.news where url = $1`, [article.url])).rows[0].n) === 1),
        ]);
        await waitUntil(() => pings > 0);
        for (const socket of server.clients) socket.terminate();
        await waitUntil(() => connections >= 2);
        await waitUntil(async () => Number((await client.query(`select count(*) as n from public.benzinga_articles where article_id = $1`, [String(article.id)])).rows[0].n) === 1);
        const news = (await client.query(`select id, title, body_text from public.news where url = $1`, [article.url])).rows;
        assert.equal(news.length, 1);
        assert.equal(news[0].title, article.title);
        assert.equal(news[0].body_text, null);
        assert.equal(Number((await client.query(`select count(*) as n from public.news_companies where news_id = $1`, [news[0].id])).rows[0].n), 2);
        const changedUrl = { ...article, url: "https://www.benzinga.com/news/renamed" };
        await pollBenzingaNews(db, { fetch: async () => new Response(JSON.stringify([changedUrl])), token });
        assert.equal(Number((await client.query(`select count(*) as n from public.news where url = $1`, [changedUrl.url])).rows[0].n), 0);
        assert.ok((await getFeed(db, { cik: 789019 })).items.some((item) => item.id === `n:${news[0].id}`));
        await matchNewItems(db);
        await matchNewItems(db);
        assert.equal(Number((await client.query(
          `select count(*) as n from public.alert_events e join public.alert_subscriptions s on s.id = e.subscription_id
           where s.address = 'stream-test@example.org' and e.item_type = 'news' and e.item_ref = $1`,
          [news[0].id],
        )).rows[0].n), 1);
      });

      await test("versioned stream stores article fields and respects body permissions", async () => {
        const send = (message: string) => {
          for (const socket of server.clients) socket.send(message);
        };
        send(versionedEvent("Created"));
        await waitUntil(async () => Number((await client.query(
          `select count(*) as n from public.news where url = $1`, [streamArticle.url],
        )).rows[0].n) === 1);
        const withoutBody = (await client.query(
          `select n.id, n.title, n.body_text, n.published_at, n.ticker, b.article_id
             from public.news n join public.benzinga_articles b on b.news_id = n.id where n.url = $1`,
          [streamArticle.url],
        )).rows[0];
        assert.equal(withoutBody.title, streamArticle.title);
        assert.equal(withoutBody.body_text, null);
        assert.equal(withoutBody.ticker, "AAPL");
        assert.equal(withoutBody.article_id, String(streamArticle.id));
        assert.equal(withoutBody.published_at.toISOString(), streamArticle.created_at);
        assert.equal(Number((await client.query(
          `select count(*) as n from public.news_companies where news_id = $1`, [withoutBody.id],
        )).rows[0].n), 2);

        await client.query(`update public.news_sources set can_store_body = true where key = 'benzinga'`);
        const licensedArticle = { ...streamArticle, id: 63615019, url: "https://www.benzinga.com/news/licensed-agreement" };
        send(versionedEvent("Created", licensedArticle));
        await waitUntil(async () => Number((await client.query(
          `select count(*) as n from public.news where url = $1`, [licensedArticle.url],
        )).rows[0].n) === 1);
        const stored = (await client.query(`select body_text from public.news where url = $1`, [licensedArticle.url])).rows[0];
        assert.equal(stored.body_text, "First & second paragraphs.\nMore details.");
        await client.query(`update public.news_sources set can_store_body = false where key = 'benzinga'`);
      });

      await test("disabling the source closes the stream and stops ingestion", async () => {
        await client.query(`update public.news_sources set enabled = false where key = 'benzinga'`);
        await waitUntil(() => server.clients.size === 0);
        const current = connections;
        await sleep(250);
        assert.equal(connections, current);
      });
    } finally {
      stop.abort();
      await worker;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await db.end();
    }
  }, { ifAvailable: process.argv.includes("--if-available") });
  if (!ran) console.log("(stream database tests skipped)");
  if (!finish("benzinga stream tests")) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error("benzinga stream tests could not run:", error.message);
  process.exitCode = 1;
});
