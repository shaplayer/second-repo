/**
 * Tests for sign-in, sign-up and confirmation, unsubscribing, matching and sending, on a throwaway
 * local database. No email is sent: a fake email service records what it is given.
 *
 *   npx tsx scripts/test-alerts.ts [--if-available]
 */
import assert from "node:assert/strict";
import type { Client } from "pg";
import {
  consumeLoginToken, createLoginToken, destroySession, getSessionUser, maskEmail, normalizeEmail, peekLoginToken, safeNextPath,
  signInVerifiedEmail,
} from "../lib/auth/accounts";
import { sha256Hex, sign, verify } from "../lib/auth/secret";
import { matchNewItems } from "../lib/alerts/match";
import { sendDigests, sendQueuedAlerts } from "../lib/alerts/send";
import {
  confirmSignup, listSubscriptions, noteConfirmationSent, peekConfirmation, peekUnsubscribe, setCadence, setCategory, signUp,
  stopEverything, suppressAddress, undoUnsubscribe, unsubscribe,
} from "../lib/alerts/subscriptions";
import { alertEmail, confirmEmail, pickEmail } from "../lib/alerts/templates";
import { createPick } from "../lib/data/picks";
import { getFeed, getFeedItem } from "../lib/data/feed";
import type { EmailMessage, EmailProvider } from "../lib/email";
import { allow } from "../lib/limits";
import { filingCategory, formLabel, formWithCode, plainHeadline } from "../lib/plain";
import { finish, test } from "./testing";
import { withTestDatabase } from "./testing-db";

const AAPL = 320193;
const MSFT = 789019;
const consent = "Email alerts from BigStocks. Unsubscribe any time. Not investment advice.";
const from = { ip: "203.0.113.9", userAgent: "TestBrowser/1.0" };

function fakeEmail(opts: { failFor?: (m: EmailMessage) => boolean; batch?: boolean } = {}) {
  const sent: { msg: EmailMessage; key?: string }[] = [];
  const provider: EmailProvider = {
    name: "fake",
    configured: () => true,
    async send(msg, o) {
      if (opts.failFor?.(msg)) throw new Error("the email service said no");
      sent.push({ msg, key: o?.idempotencyKey });
      return { id: `id-${sent.length}` };
    },
  };
  if (opts.batch) {
    provider.sendBatch = async (msgs) => {
      if (msgs.some((m) => opts.failFor?.(m))) throw new Error("the email service said no");
      for (const msg of msgs) sent.push({ msg });
      return { ids: msgs.map((_, i) => `b-${i}`) };
    };
  }
  return { provider, sent };
}

const one = async <T>(db: Client, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T;
const num = async (db: Client, sql: string, params: unknown[] = []) => Number(Object.values((await one<Record<string, unknown>>(db, sql, params)) ?? { n: NaN })[0]);
const statusOf = async (db: Client, email: string, cik: number | null) =>
  (await one<{ status: string } | undefined>(db, `select status from public.alert_subscriptions where address = $1 and cik is not distinct from $2`, [email, cik]))?.status;

async function addFiling(db: Client, accession: string, cik: number, form: string, opts: { items?: string[]; ago?: string; title?: string } = {}) {
  const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
  await db.query(
    `insert into public.filings (accession, cik, form, items, accepted_at, filed_date, primary_url, index_url, category, title)
     values ($1, $2, $3, $4, now() - $5::interval, current_date, $6, $7, $8, $9)`,
    [accession, cik, form, opts.items ?? [], opts.ago ?? "1 minute", `${folder}/doc.htm`, `${folder}/${accession}-index.htm`,
      filingCategory({ form, items: opts.items }, { listed: true }), opts.title ?? null],
  );
}

async function main() {
  process.env.COMPANY_POSTAL_ADDRESS = "BigStocks Test LLC, 1 Test Way, Testville, TS 12345";
  process.env.NEXT_PUBLIC_SITE_URL = "https://bigstocks.test";

  console.log("alert tests");

  await test("plain-English names: no form code on its own, IPO only for unlisted companies", () => {
    assert.equal(formLabel("10-Q"), "Quarterly report");
    assert.equal(formLabel("8-K/A"), "Company news (corrected)");
    assert.equal(formWithCode("10-Q"), "Quarterly report (10-Q)");
    assert.equal(formLabel("S-1"), "IPO filing");
    assert.equal(formLabel("S-1", { listed: true }), "New shares");
    assert.equal(formLabel("NPORT-P"), null);
    assert.equal(filingCategory({ form: "8-K", items: ["2.02", "9.01"] }), "earnings");
    assert.equal(filingCategory({ form: "8-K", items: ["5.02"] }), "news");
    assert.equal(filingCategory({ form: "4" }), "insider");
    assert.equal(filingCategory({ form: "S-1" }, { listed: true }), "news");
    assert.equal(filingCategory({ form: "13F-HR" }), null);
    assert.equal(plainHeadline({ form: "8-K", items: ["9.01", "5.02", "2.02"] }), "Released earnings results · Executive or board change");
    assert.equal(plainHeadline({ form: "8-K", items: [] }), "Company news announced");
    assert.equal(plainHeadline({ form: "10-Q" }), "Quarterly report filed");
    for (const text of [formLabel("4")!, plainHeadline({ form: "4" }), plainHeadline({ form: "8-K", items: ["2.01"] })]) {
      assert.ok(!/\b(10-[QK]|8-K)\b/.test(text), text);
    }
  });

  await test("signed values: wrong purpose, tampering and expiry are all refused", () => {
    const s = sign("a@example.org|1,2", "undo", 1000, 1_000_000);
    assert.equal(verify(s, "undo", 1_000_500), "a@example.org|1,2");
    assert.equal(verify(s, "other", 1_000_500), null);
    assert.equal(verify(s, "undo", 1_001_001), null);
    assert.equal(verify(s.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "undo", 1_000_500), null);
    assert.equal(verify("nonsense", "undo"), null);
    assert.equal(verify(null, "undo"), null);
  });

  await test("addresses and next-page links are cleaned up or refused", () => {
    assert.equal(normalizeEmail("  Jane.Doe+x@Example.ORG "), "jane.doe+x@example.org");
    assert.equal(normalizeEmail("not an email"), null);
    assert.equal(normalizeEmail(42), null);
    assert.equal(maskEmail("jane@gmail.com"), "j•••@gmail.com");
    assert.equal(safeNextPath("/my-stocks?x=1"), "/my-stocks?x=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "my-stocks", "/a\nb"]) assert.equal(safeNextPath(bad), null, bad);
  });

  const ran = await withTestDatabase("alerts", async (db) => {
    /* ------------------------------------------------------------- sign-in */
    await test("a sign-in link works once, only its hash is stored, and it creates the account", async () => {
      const token = await createLoginToken(db, "new@example.org", { nextPath: "/my-stocks", ip: from.ip });
      assert.equal(await num(db, `select count(*) from public.login_tokens where token_hash = $1`, [token]), 0, "the code itself is never stored");
      assert.equal(await num(db, `select count(*) from public.login_tokens where token_hash = $1`, [sha256Hex(token)]), 1);
      assert.deepEqual(await peekLoginToken(db, token), { email: "new@example.org" });
      assert.equal(await num(db, `select count(*) from public.users`), 0, "looking at the link does not sign anyone in");
      const first = await consumeLoginToken(db, token, from);
      assert.ok(first);
      assert.equal(first.user.email, "new@example.org");
      assert.equal(first.nextPath, "/my-stocks");
      assert.equal(await consumeLoginToken(db, token, from), null, "second use is refused");
      assert.equal(await peekLoginToken(db, token), null);
      assert.equal((await getSessionUser(db, first.sessionToken))?.id, first.user.id);
      assert.equal(await num(db, `select count(*) from public.sessions where id_hash = $1`, [first.sessionToken]), 0, "the cookie value is never stored");
      await destroySession(db, first.sessionToken);
      assert.equal(await getSessionUser(db, first.sessionToken), null);
    });

    await test("an expired link, a made-up code and an expired session do nothing", async () => {
      const token = await createLoginToken(db, "late@example.org");
      await db.query(`update public.login_tokens set expires_at = now() - interval '1 second' where email = 'late@example.org'`);
      assert.equal(await consumeLoginToken(db, token), null);
      assert.equal(await consumeLoginToken(db, "x".repeat(43)), null);
      assert.equal(await consumeLoginToken(db, "'; drop table users; --"), null);
      const again = await consumeLoginToken(db, await createLoginToken(db, "late@example.org"));
      await db.query(`update public.sessions set expires_at = now() - interval '1 second' where user_id = $1`, [again!.user.id]);
      assert.equal(await getSessionUser(db, again!.sessionToken), null);
    });

    await test("someone from the old app keeps their account: same email, any letter case, no second account", async () => {
      const id = "00000000-0000-4000-8000-0000000000aa";
      await db.query(`insert into public.users (id, email, display_name) values ($1, 'Old.Timer@Example.org', 'Old Timer')`, [id]);
      const r = await consumeLoginToken(db, await createLoginToken(db, normalizeEmail("OLD.timer@example.org")!));
      assert.equal(r!.user.id, id);
      assert.equal(r!.user.displayName, "Old Timer");
      assert.equal(await num(db, `select count(*) from public.users where lower(email) = 'old.timer@example.org'`), 1);
    });

    /* ------------------------------------------------------------- sign-up */
    let confirmToken = "";
    let batch = "";
    await test("signing up creates pending rows with the consent on record, and nothing is active yet", async () => {
      const r = await signUp(db, { email: "ann@example.org", cik: AAPL, source: "stock:AAPL", consentText: consent, ...from });
      assert.deepEqual([r.pending, r.activated, r.alreadyActive, r.suppressed], [2, 0, 0, false]);
      confirmToken = r.confirmToken!;
      batch = r.batch;
      assert.equal(await statusOf(db, "ann@example.org", AAPL), "pending");
      assert.equal(await statusOf(db, "ann@example.org", null), "pending");
      const row = await one<Record<string, string>>(db, `select consent_text, consent_ip, consent_user_agent, source, consent_at::text as at from public.alert_subscriptions where address = 'ann@example.org' and cik = $1`, [AAPL]);
      assert.deepEqual([row.consent_text, row.consent_ip, row.consent_user_agent, row.source], [consent, from.ip, from.userAgent, "stock:AAPL"]);
      assert.ok(row.at);
    });

    await test("a pending sign-up is never matched or sent to", async () => {
      await addFiling(db, "0000320193-26-000101", AAPL, "8-K", { items: ["2.02"] });
      const m = await matchNewItems(db);
      assert.deepEqual([m.filings, m.events], [1, 0]);
      const mail = fakeEmail();
      assert.deepEqual(await sendQueuedAlerts(db, { provider: mail.provider }), { sent: 0, failed: 0, retrying: 0, suppressed: 0 });
      assert.equal(mail.sent.length, 0);
    });

    await test("a stranger cannot slip extra stocks into someone else's confirmation", async () => {
      // Someone else types Ann's address on the Microsoft page: a different sign-up, a different batch.
      const other = await signUp(db, { email: "ann@example.org", cik: MSFT, picks: false, source: "stock:MSFT", consentText: consent, ip: "198.51.100.66", userAgent: "Other/1.0" });
      assert.notEqual(other.batch, batch);
      const view = await peekConfirmation(db, confirmToken);
      assert.deepEqual(view!.waiting.map((w) => w.ticker).sort(), ["AAPL", null].sort());
      const done = await confirmSignup(db, confirmToken, from);
      assert.equal(done!.confirmed.length, 2);
      assert.equal(await statusOf(db, "ann@example.org", AAPL), "active");
      assert.equal(await statusOf(db, "ann@example.org", null), "active");
      assert.equal(await statusOf(db, "ann@example.org", MSFT), "pending", "the row from the other sign-up still waits for its own click");
      const click = await one<{ legacy: { confirmed_from: { ip: string } } }>(db, `select legacy from public.alert_subscriptions where address = 'ann@example.org' and cik = $1`, [AAPL]);
      assert.equal(click.legacy.confirmed_from.ip, from.ip);
    });

    await test("the confirmation link works once; a second click and a made-up code change nothing", async () => {
      const again = await confirmSignup(db, confirmToken, from);
      assert.equal(again, null, "the code is cleared once used");
      assert.equal(await confirmSignup(db, "z".repeat(32), from), null);
      assert.equal(await statusOf(db, "ann@example.org", MSFT), "pending");
    });

    await test("'follow a few more while you wait' joins the same confirmation", async () => {
      const first = await signUp(db, { email: "bo@example.org", source: "home-hero", consentText: consent, ...from });
      const more = await signUp(db, { email: "bo@example.org", cik: MSFT, picks: false, batch: first.batch, source: "confirm-page", consentText: consent, ...from });
      assert.equal(more.batch, first.batch);
      const done = await confirmSignup(db, first.confirmToken!, from);
      assert.deepEqual(done!.confirmed.map((c) => c.cik).sort(), [MSFT, null].sort());
    });

    await test("confirmation emails are capped at three a day per sign-up", async () => {
      const r = await signUp(db, { email: "cy@example.org", source: "home-hero", consentText: consent, ...from });
      const sends = [];
      for (let i = 0; i < 5; i++) sends.push(await noteConfirmationSent(db, r.confirmToken!));
      assert.deepEqual(sends, [true, true, true, false, false]);
    });

    await test("a signed-in person's own address needs no confirmation email; anyone else's still does", async () => {
      const { user } = await signInVerifiedEmail(db, "dee@example.org", from);
      const own = await signUp(db, { email: "dee@example.org", cik: AAPL, picks: false, source: "my-stocks", consentText: consent, ...from, verifiedEmail: user.email, userId: user.id });
      assert.deepEqual([own.pending, own.activated], [0, 1]);
      assert.equal(await statusOf(db, "dee@example.org", AAPL), "active");
      const other = await signUp(db, { email: "victim@example.org", cik: AAPL, picks: false, source: "my-stocks", consentText: consent, ...from, verifiedEmail: user.email, userId: user.id });
      assert.deepEqual([other.pending, other.activated], [1, 0]);
      assert.equal(await statusOf(db, "victim@example.org", AAPL), "pending");
    });

    await test("signing in ties earlier subscriptions to the account", async () => {
      const r = await consumeLoginToken(db, await createLoginToken(db, "ann@example.org"));
      assert.equal(await num(db, `select count(*) from public.alert_subscriptions where address = 'ann@example.org' and user_id = $1`, [r!.user.id]), 3);
      assert.equal((await listSubscriptions(db, "ann@example.org")).length, 3);
    });

    /* ------------------------------------------------------- match and send */
    await test("a new filing is matched to active followers of that company who asked for that kind of news, once", async () => {
      await setCategory(db, "dee@example.org", "earnings", false); // Dee does not want earnings
      await addFiling(db, "0000320193-26-000102", AAPL, "8-K", { items: ["2.02"], title: "Apple reports fourth quarter results" });
      await addFiling(db, "0000789019-26-000050", MSFT, "10-Q");
      const m = await matchNewItems(db);
      assert.equal(m.filings, 2);
      // Apple earnings: Ann (active). Not Dee (earnings off), not the pending victim. Microsoft: Bo (active), not Ann (pending).
      const got = (await db.query(`select s.address, e.item_ref from public.alert_events e join public.alert_subscriptions s on s.id = e.subscription_id order by 1, 2`)).rows;
      assert.deepEqual(got, [{ address: "ann@example.org", item_ref: "0000320193-26-000102" }, { address: "bo@example.org", item_ref: "0000789019-26-000050" }]);
      assert.deepEqual(await matchNewItems(db), { filings: 0, releases: 0, picks: 0, events: 0 }, "nothing is matched twice");
      assert.equal(await num(db, `select count(*) from public.summary_jobs where reason = 'subscribed'`), 2, "followed companies' filings go on the summary list");
    });

    await test("an alert waits a moment for its summary, then goes out with the right links and headers", async () => {
      const mail = fakeEmail();
      assert.equal((await sendQueuedAlerts(db, { provider: mail.provider })).sent, 0, "held while the summary is being written");
      await db.query(`update public.summary_jobs set status = 'done'`);
      await db.query(
        `insert into public.summaries (accession, kind, model, prompt_version, headline, one_sentence, bullets, tone, importance, category, source_url)
         values ('0000320193-26-000102', 'ai', 'claude-opus-5-5', 2, 'Sales rose 6% in the quarter', 'Sales grew 6% from a year ago and profit rose.',
                 '{"Sales were $94 billion.","Profit rose 8%."}', 'Good news', 'High', 'earnings', 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000102/doc.htm')`,
      );
      const r = await sendQueuedAlerts(db, { provider: mail.provider });
      assert.deepEqual(r, { sent: 2, failed: 0, retrying: 0, suppressed: 0 });
      const toAnn = mail.sent.find((s) => s.msg.to[0] === "ann@example.org")!;
      assert.equal(toAnn.msg.subject, "$AAPL: Sales rose 6% in the quarter");
      assert.match(toAnn.msg.text, /AI-generated summary\. Can contain mistakes\./);
      assert.match(toAnn.msg.text, /Read the original on SEC\.gov: https:\/\/www\.sec\.gov\/Archives\//);
      assert.match(toAnn.msg.text, /Not investment advice\./);
      assert.match(toAnn.msg.text, /BigStocks Test LLC, 1 Test Way/);
      assert.match(toAnn.msg.headers!["List-Unsubscribe"], /^<https:\/\/bigstocks\.test\/api\/unsubscribe\?token=[A-Za-z0-9_-]+>$/);
      assert.equal(toAnn.msg.headers!["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
      assert.ok(toAnn.key?.startsWith("bs-alert-"));
      const toBo = mail.sent.find((s) => s.msg.to[0] === "bo@example.org")!;
      assert.equal(toBo.msg.subject, "$MSFT: Quarterly report filed");
      assert.ok(!/AI-generated/.test(toBo.msg.text), "no AI label when there is no AI summary");
      for (const s of mail.sent) assert.ok(!/\b(buy|sell)\b/i.test(s.msg.text.replace(/sell(s)? (shares|new shares)/gi, "")), "never advice to buy or sell");
      assert.equal((await sendQueuedAlerts(db, { provider: mail.provider })).sent, 0, "nothing is sent twice");
      assert.equal(await num(db, `select count(*) from public.alert_events where status = 'sent' and sent_at is not null and provider_message_id is not null`), 2);
    });

    await test("old items are marked as handled without alerting anyone", async () => {
      await addFiling(db, "0000320193-26-000090", AAPL, "8-K", { items: ["5.02"], ago: "3 days" });
      const m = await matchNewItems(db);
      assert.deepEqual([m.filings, m.events], [1, 0]);
      assert.equal(await num(db, `select count(*) from public.filings where matched_at is null`), 0);
    });

    await test("a failed send is retried later and given up on after five tries", async () => {
      await addFiling(db, "0000320193-26-000103", AAPL, "8-K", { items: ["5.02"] });
      await matchNewItems(db);
      await db.query(`update public.summary_jobs set status = 'done'`);
      const bad = fakeEmail({ failFor: () => true });
      const first = await sendQueuedAlerts(db, { provider: bad.provider });
      assert.deepEqual([first.sent, first.retrying, first.failed], [0, 2, 0]); // Ann and Dee both follow Apple and take company news
      const waiting = await one<{ status: string; later: boolean; error: string }>(db, `select status, next_attempt_at > now() as later, error from public.alert_events where item_ref = '0000320193-26-000103' limit 1`);
      assert.deepEqual([waiting.status, waiting.later, waiting.error], ["queued", true, "the email service said no"]);
      assert.equal((await sendQueuedAlerts(db, { provider: bad.provider })).retrying, 0, "not before its retry time");
      for (let i = 0; i < 6; i++) {
        await db.query(`update public.alert_events set next_attempt_at = now() where status = 'queued'`);
        await sendQueuedAlerts(db, { provider: bad.provider });
      }
      assert.equal(await num(db, `select count(*) from public.alert_events where item_ref = '0000320193-26-000103' and status = 'failed' and attempts = 5`), 2);
    });

    await test("a send interrupted mid-way is picked up again, with the same key so it cannot be sent twice", async () => {
      await addFiling(db, "0000320193-26-000104", AAPL, "8-K", { items: ["1.01"] });
      await matchNewItems(db);
      await db.query(`update public.summary_jobs set status = 'done'`);
      await db.query(`update public.alert_events set status = 'sending', attempts = 1, next_attempt_at = now() - interval '1 minute' where item_ref = '0000320193-26-000104'`);
      const mail = fakeEmail();
      assert.equal((await sendQueuedAlerts(db, { provider: mail.provider })).sent, 2);
      const ids = (await db.query(`select id::text as id from public.alert_events where item_ref = '0000320193-26-000104' order by id`)).rows.map((r) => r.id);
      assert.deepEqual(mail.sent.map((s) => s.key).sort(), ids.map((id) => `bs-alert-${id}`).sort());
    });

    /* ---------------------------------------------------------- unsubscribe */
    let annApple = "";
    await test("an unsubscribe link shows what it covers and changes nothing until confirmed", async () => {
      annApple = (await one<{ t: string }>(db, `select unsubscribe_token as t from public.alert_subscriptions where address = 'ann@example.org' and cik = $1`, [AAPL])).t;
      const view = await peekUnsubscribe(db, annApple);
      assert.equal(view!.email, "ann@example.org");
      assert.deepEqual(view!.matched.map((m) => m.ticker), ["AAPL"]);
      assert.equal(view!.all.length, 3);
      assert.equal(await statusOf(db, "ann@example.org", AAPL), "active");
      assert.equal(await peekUnsubscribe(db, "q".repeat(32)), null);
    });

    await test("unsubscribing takes effect at once: queued alerts are dropped and later items are not matched", async () => {
      await addFiling(db, "0000320193-26-000105", AAPL, "8-K", { items: ["8.01"] });
      await matchNewItems(db);
      const r = await unsubscribe(db, annApple, "this");
      assert.equal(r!.stopped, 1);
      assert.equal(await statusOf(db, "ann@example.org", AAPL), "unsubscribed");
      assert.equal(await statusOf(db, "ann@example.org", null), "active", "the pick list was not asked about");
      await db.query(`update public.summary_jobs set status = 'done'`);
      const mail = fakeEmail();
      await sendQueuedAlerts(db, { provider: mail.provider });
      assert.deepEqual(mail.sent.map((s) => s.msg.to[0]), ["dee@example.org"]);
      await addFiling(db, "0000320193-26-000106", AAPL, "8-K", { items: ["8.01"] });
      await matchNewItems(db);
      assert.equal(await num(db, `select count(*) from public.alert_events e join public.alert_subscriptions s on s.id = e.subscription_id where s.address = 'ann@example.org' and e.item_ref = '0000320193-26-000106'`), 0);
      // Undo restores exactly that row, once, within the hour.
      assert.equal(await undoUnsubscribe(db, r!.undoToken!), 1);
      assert.equal(await statusOf(db, "ann@example.org", AAPL), "active");
      assert.equal(await undoUnsubscribe(db, r!.undoToken!), 0);
      assert.equal(await undoUnsubscribe(db, "forged.123.abc"), 0);
    });

    await test("unsubscribed between queueing and sending: the alert is not sent", async () => {
      await addFiling(db, "0000320193-26-000107", AAPL, "8-K", { items: ["8.01"] });
      await matchNewItems(db);
      await db.query(`update public.summary_jobs set status = 'done'`);
      // Simulate the status changing without the queue being cleaned (belt and braces: the sender checks again).
      await db.query(`update public.alert_subscriptions set status = 'unsubscribed', unsubscribed_at = now() where address = 'dee@example.org'`);
      const mail = fakeEmail();
      const r = await sendQueuedAlerts(db, { provider: mail.provider });
      assert.ok(r.suppressed >= 1);
      assert.ok(!mail.sent.some((s) => s.msg.to[0] === "dee@example.org"));
    });

    await test("'everything', 'stocks only' and 'picks only' stop the right rows; signing up again needs a new confirmation", async () => {
      assert.equal((await unsubscribe(db, annApple, "picks"))!.stopped, 1);
      assert.equal(await statusOf(db, "ann@example.org", null), "unsubscribed");
      assert.equal(await statusOf(db, "ann@example.org", AAPL), "active");
      assert.equal((await unsubscribe(db, annApple, "all"))!.stopped, 2); // Apple (active) and Microsoft (pending)
      for (const cik of [AAPL, MSFT, null]) assert.equal(await statusOf(db, "ann@example.org", cik), "unsubscribed");
      const again = await signUp(db, { email: "ann@example.org", cik: AAPL, picks: false, source: "stock:AAPL", consentText: consent, ...from });
      assert.deepEqual([again.pending, again.activated], [1, 0]);
      assert.equal(await statusOf(db, "ann@example.org", AAPL), "pending", "not active until the new confirmation is clicked");
      const row = await one<{ legacy: Record<string, string> }>(db, `select legacy from public.alert_subscriptions where address = 'ann@example.org' and cik = $1`, [AAPL]);
      assert.ok(row.legacy.signed_up_again_after_opt_out_at);
      assert.equal((await stopEverything(db, "bo@example.org")), 2);
    });

    await test("an address the email service told us to stop using cannot be signed up or sent to again", async () => {
      const r = await signUp(db, { email: "eve@example.org", source: "home-hero", consentText: consent, ...from });
      await confirmSignup(db, r.confirmToken!, from);
      await suppressAddress(db, "eve@example.org", "complaint", { from: "test" });
      assert.equal(await statusOf(db, "eve@example.org", null), "unsubscribed");
      const again = await signUp(db, { email: "eve@example.org", source: "home-hero", consentText: consent, ...from });
      assert.equal(again.suppressed, true);
      assert.equal(await statusOf(db, "eve@example.org", null), "unsubscribed");
    });

    /* ----------------------------------------------------------------- picks */
    await test("a sponsored pick cannot be posted without who paid, how much and in what form", async () => {
      await assert.rejects(
        createPick(db, { ticker: "MSFT", title: "A sponsored idea about Microsoft", why: "", author: "BigStocks", ownsShares: false, sponsor: { payer: "Acme IR", amount: "", form: "cash" } }),
        /who paid, how much, and in what form/,
      );
      await assert.rejects(
        db.query(`insert into public.picks (ticker, company_name, kind, title, why, author, tier) values ('MSFT', 'Microsoft', 'sponsored', 'x', '', 'a', 'free')`),
        /sponsored_needs_disclosure/,
      );
      await assert.rejects(createPick(db, { ticker: "NOPE", title: "A pick about nothing", why: "", author: "x", ownsShares: false }), /No company with the ticker/);
    });

    await test("a pick goes once to everyone on the pick list, at once even for daily-summary people; a sponsored one says who paid first", async () => {
      for (const email of ["p1@example.org", "p2@example.org", "p3@example.org"]) {
        const r = await signUp(db, { email, cik: MSFT, source: "picks", consentText: consent, ...from });
        await confirmSignup(db, r.confirmToken!, from);
      }
      await db.query(`update public.alert_subscriptions set categories = categories || '{picks}' where address = 'p1@example.org' and cik = $1`, [MSFT]);
      await setCadence(db, "p2@example.org", "digest");
      const pick = await createPick(db, {
        ticker: "msft", title: "Cloud sales grew for a tenth quarter in a row", why: "The quarterly report shows steady growth.", author: "BigStocks",
        ownsShares: false, sponsor: { payer: "Acme Investor Relations", amount: "$5,000", form: "cash" },
      });
      const m = await matchNewItems(db);
      assert.equal(m.picks, 1);
      const mail = fakeEmail({ batch: true });
      const r = await sendQueuedAlerts(db, { provider: mail.provider });
      const picksSent = mail.sent.filter((s) => s.msg.subject === "Sponsored: $MSFT");
      assert.deepEqual(picksSent.map((s) => s.msg.to[0]).sort(), ["p1@example.org", "p2@example.org", "p3@example.org"], "one each, including p1 who has two matching rows");
      assert.equal(r.failed, 0);
      const text = picksSent[0].msg.text;
      assert.ok(text.startsWith("Sponsored. Paid for by Acme Investor Relations: $5,000, cash."), text.slice(0, 80));
      assert.match(text, /Picks are ideas to research, not advice\./);
      assert.ok(!/No one paid/.test(text));
      const free = pickEmail({ pick: { ...pick, sponsored: false, sponsor: null }, footer: { siteUrl: "https://bigstocks.test", postalAddress: "X" } });
      assert.match(free.text, /Not sponsored\. No one paid for this pick\./);
      assert.equal(free.subject, "Today's free pick: $MSFT");
    });

    /* ---------------------------------------------------------------- digest */
    await test("daily-summary people get one email with the day's items, and only then", async () => {
      await addFiling(db, "0000789019-26-000060", MSFT, "8-K", { items: ["5.02"] });
      await addFiling(db, "0000789019-26-000061", MSFT, "10-Q");
      await matchNewItems(db);
      await db.query(`update public.summary_jobs set status = 'done'`);
      const mail = fakeEmail();
      await sendQueuedAlerts(db, { provider: mail.provider });
      assert.ok(!mail.sent.some((s) => s.msg.to[0] === "p2@example.org"), "nothing straight away");
      const d = await sendDigests(db, { provider: mail.provider });
      assert.equal(d.sent, 1);
      const digest = mail.sent.find((s) => s.msg.to[0] === "p2@example.org")!;
      assert.match(digest.msg.subject, /^2 new posts on your stocks: \$MSFT/);
      assert.match(digest.msg.headers!["List-Unsubscribe"], /scope=stocks>$/);
      assert.equal((await sendDigests(db, { provider: mail.provider })).sent, 0);
      assert.equal(await num(db, `select count(*) from public.alert_events where digest_id is not null and status = 'sent'`), 2);
    });

    /* ------------------------------------------------------------- feed, etc */
    await test("the feed lists filings and releases newest first, filters by kind and company, and pages without gaps", async () => {
      await db.query(
        `insert into public.news (source, cik, ticker, company_name, title, url, published_at) values
           ('prnewswire', $1, 'AAPL', 'Apple', 'Apple announces a thing', 'https://www.prnewswire.com/news-releases/apple-1.html', now() - interval '30 seconds'),
           ('prnewswire', null, 'ZZZZ', 'Private Co', 'Private company news', 'https://www.prnewswire.com/news-releases/private-1.html', now())`,
        [AAPL],
      );
      const all = await getFeed(db, { limit: 100 });
      assert.ok(all.items.length >= 10);
      const times = all.items.map((i) => i.publishedAt);
      assert.deepEqual(times, [...times].sort().reverse());
      assert.ok(!all.items.some((i) => i.headline === "Private company news"), "a release we cannot tie to a company is left out");
      const press = await getFeed(db, { category: "press" });
      assert.deepEqual(press.items.map((i) => [i.kind, i.typeLabel, i.sourceName, i.canSummarize]), [["release", "Press release", "PR Newswire", false]]);
      const apple = await getFeed(db, { cik: AAPL, limit: 100 });
      assert.ok(apple.items.every((i) => i.ticker === "AAPL"));
      // Page through three at a time: every item exactly once, in order.
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const page = await getFeed(db, { limit: 3, before: cursor });
        seen.push(...page.items.map((x) => x.id));
        if (!page.next) break;
        cursor = page.next;
      }
      assert.deepEqual(seen, all.items.map((i) => i.id));
      // "Anything new since the post I am looking at?": exactly the items above it, newest first.
      const newer = await getFeed(db, { after: all.items[2].cursor, limit: 50 });
      assert.deepEqual(newer.items.map((i) => i.id), all.items.slice(0, 2).map((i) => i.id));
      assert.equal((await getFeed(db, { after: all.items[0].cursor })).items.length, 0);
      const item = await getFeedItem(db, "f:0000320193-26-000102");
      assert.deepEqual([item!.headline, item!.summary?.kind, item!.typeLabel, item!.category, item!.path], [
        "Sales rose 6% in the quarter", "ai", "Company news", "earnings", "/filing/0000320193-26-000102",
      ]);
      assert.equal(await getFeedItem(db, "f:nonsense"), null);
      assert.equal((await getFeed(db, { text: "fourth quarter" })).items.length, 1);
      assert.equal((await getFeed(db, { text: "$aapl", limit: 100 })).items.length, apple.items.length);
    });

    await test("rate limits count per address and stop at the limit", async () => {
      const limit = { bucket: "test", max: 3, windowSeconds: 3600 };
      const got = [];
      for (let i = 0; i < 5; i++) got.push(await allow(db, limit, "a@example.org"));
      assert.deepEqual(got, [true, true, true, false, false]);
      assert.equal(await allow(db, limit, "b@example.org"), true);
    });

    await test("emails: the confirmation says what was asked for; an alert without a summary still links to the original", async () => {
      const c = confirmEmail({
        confirmUrl: "https://bigstocks.test/confirm?token=abc", wants: { picks: true, companies: [{ ticker: "AAPL", name: "Apple Inc." }] },
        footer: { siteUrl: "https://bigstocks.test", postalAddress: "X" },
      });
      assert.match(c.text, /You asked for the free daily pick and alerts on \$AAPL\./);
      assert.match(c.html, /Yes, send me alerts/);
      const item = (await getFeedItem(db, "f:0000789019-26-000061"))!;
      const a = alertEmail({ item, footer: { siteUrl: "https://bigstocks.test", postalAddress: "X", unsubscribeUrl: "https://bigstocks.test/unsubscribe?token=t" } });
      assert.match(a.text, /Read the original on SEC\.gov: https:\/\/www\.sec\.gov\//);
      assert.match(a.text, /Unsubscribe: https:\/\/bigstocks\.test\/unsubscribe\?token=t/);
      assert.ok(!a.html.includes("<script"));
    });

    await test("without a postal address no alert email is sent (the law requires it)", async () => {
      await addFiling(db, "0000320193-26-000108", AAPL, "8-K", { items: ["8.01"] });
      const r = await signUp(db, { email: "zed@example.org", cik: AAPL, picks: false, source: "x", consentText: consent, ...from });
      await confirmSignup(db, r.confirmToken!, from);
      await matchNewItems(db);
      await db.query(`update public.summary_jobs set status = 'done'`);
      const saved = process.env.COMPANY_POSTAL_ADDRESS;
      process.env.COMPANY_POSTAL_ADDRESS = "BigStocks LLC, 123 Example St, City, ST 00000";
      const mail = fakeEmail();
      await assert.rejects(sendQueuedAlerts(db, { provider: mail.provider }), /COMPANY_POSTAL_ADDRESS is not set/);
      assert.equal(mail.sent.length, 0);
      process.env.COMPANY_POSTAL_ADDRESS = saved;
    });
  }, { ifAvailable: process.argv.includes("--if-available") });

  if (!ran) console.log("(database part skipped)");
  if (!finish("alert tests")) process.exit(1);
}

main().catch((e) => {
  console.error("alert tests could not run:", (e as Error).message);
  process.exit(1);
});
