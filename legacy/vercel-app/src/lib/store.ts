import { randomBytes } from "crypto";
import { supabaseAdmin } from "./supabase/server";

// Alerts, filing summaries and picks live in Supabase. Only the server touches these tables.

export type AlertPrefs = {
  earnings: boolean; // earnings releases and quarterly/annual reports
  news: boolean; // other company announcements
  insider: boolean; // insider buys and sells
  picks?: boolean; // new BigStocks picks and sponsored posts (opt-in)
  mode: "instant" | "daily";
};

export type Subscriber = {
  id: string;
  email: string;
  token: string; // secret used in confirm / manage / unsubscribe links
  confirmed: boolean;
  tickers: string[];
  prefs: AlertPrefs;
  createdAt: string;
};

export type Summary = {
  accession: string;
  ticker: string;
  companyName: string;
  form: string;
  accepted: string;
  url: string;
  headline: string;
  bullets: string[];
  whyItMatters: string;
  tone: "Good news" | "Bad news" | "Mixed" | "Routine";
  importance: "High" | "Medium" | "Low";
  category: "earnings" | "news" | "insider";
  createdAt: string;
};

export type Pick = {
  id: string;
  ticker: string;
  companyName: string;
  kind: "pick" | "sponsored";
  title: string;
  why: string;
  author: string; // investor name, or "BigStocks" for sponsored posts
  tier: "free" | "members";
  postedAt: string;
  priceAtPost: number;
  ownsShares: boolean; // does the writer or BigStocks own the stock?
  ownershipNote: string;
  // Required for sponsored posts (Securities Act section 17(b)): who paid, how much, and in what form.
  sponsor?: { payer: string; amount: string; form: string };
  closedAt?: string;
  priceAtClose?: number;
};

export const newToken = () => randomBytes(24).toString("base64url");

export const DEFAULT_PREFS: AlertPrefs = { earnings: true, news: true, insider: false, picks: false, mode: "instant" };

const db = () => supabaseAdmin();

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/* ---------- Subscribers ---------- */

type SubRow = { id: string; email: string; token: string; confirmed: boolean; tickers: string[]; prefs: AlertPrefs; created_at: string };
const toSub = (r: SubRow): Subscriber => ({ id: r.id, email: r.email, token: r.token, confirmed: r.confirmed, tickers: r.tickers, prefs: r.prefs, createdAt: r.created_at });

export async function subscriberByToken(token: string) {
  if (!token) return null;
  const r = check(await db().from("alert_subscribers").select("*").eq("token", token).maybeSingle());
  return r ? toSub(r as SubRow) : null;
}

export async function subscriberByEmail(email: string) {
  const r = check(await db().from("alert_subscribers").select("*").eq("email", email.toLowerCase()).maybeSingle());
  return r ? toSub(r as SubRow) : null;
}

export async function confirmedSubscribers(filter?: { picks?: boolean }) {
  let q = db().from("alert_subscribers").select("*").eq("confirmed", true);
  if (filter?.picks) q = q.eq("prefs->>picks", "true");
  return (check(await q) as SubRow[]).map(toSub);
}

/** Add a stock to someone's alerts, creating their sign-up if it's new. */
export async function addSubscription(email: string, ticker: string, prefs: AlertPrefs, verified: boolean, maxTickers: number) {
  const existing = await subscriberByEmail(email);
  if (!existing) {
    const r = check(
      await db()
        .from("alert_subscribers")
        .insert({ email: email.toLowerCase(), token: newToken(), confirmed: verified, tickers: [ticker], prefs })
        .select("*")
        .single(),
    );
    return { sub: toSub(r as SubRow), isNew: true };
  }
  const tickers = existing.tickers.includes(ticker) || existing.tickers.length >= maxTickers ? existing.tickers : [...existing.tickers, ticker];
  const r = check(
    await db()
      .from("alert_subscribers")
      .update({ tickers, ...(existing.confirmed ? {} : { prefs }), ...(verified ? { confirmed: true } : {}) })
      .eq("id", existing.id)
      .select("*")
      .single(),
  );
  return { sub: toSub(r as SubRow), isNew: false };
}

export async function confirmSubscriber(token: string) {
  if (!token) return null;
  const r = check(await db().from("alert_subscribers").update({ confirmed: true }).eq("token", token).select("*").maybeSingle());
  return r ? toSub(r as SubRow) : null;
}

export async function updateSubscriber(token: string, change: { prefs?: AlertPrefs; tickers?: string[] }) {
  const r = check(await db().from("alert_subscribers").update(change).eq("token", token).select("id"));
  return (r?.length ?? 0) > 0;
}

export async function deleteSubscriber(token: string) {
  const r = check(await db().from("alert_subscribers").delete().eq("token", token).select("id"));
  return (r?.length ?? 0) > 0;
}

/* ---------- Filing summaries ---------- */

type SumRow = {
  accession: string;
  ticker: string;
  company_name: string;
  form: string;
  accepted: string;
  url: string;
  headline: string;
  bullets: string[];
  why_it_matters: string;
  tone: Summary["tone"];
  importance: Summary["importance"];
  category: Summary["category"];
  created_at: string;
};
const toSummary = (r: SumRow): Summary => ({
  accession: r.accession,
  ticker: r.ticker,
  companyName: r.company_name,
  form: r.form,
  accepted: r.accepted,
  url: r.url,
  headline: r.headline,
  bullets: r.bullets,
  whyItMatters: r.why_it_matters,
  tone: r.tone,
  importance: r.importance,
  category: r.category,
  createdAt: r.created_at,
});

export async function getSummary(accession: string) {
  const r = check(await db().from("filing_summaries").select("*").eq("accession", accession).maybeSingle());
  return r ? toSummary(r as SumRow) : null;
}

export async function summariesFor(accessions: string[]): Promise<Record<string, Summary>> {
  if (!accessions.length) return {};
  const rows = check(await db().from("filing_summaries").select("*").in("accession", accessions.slice(0, 200))) as SumRow[];
  return Object.fromEntries(rows.map((r) => [r.accession, toSummary(r)]));
}

export async function latestSummary(excludeForm?: string) {
  let q = db().from("filing_summaries").select("*").order("created_at", { ascending: false }).limit(1);
  if (excludeForm) q = q.neq("form", excludeForm);
  const rows = check(await q) as SumRow[];
  return rows[0] ? toSummary(rows[0]) : null;
}

/** Save a summary. ignoreIfExists keeps a Claude-written summary from being replaced by a basic fallback. */
export async function saveSummary(s: Summary, ignoreIfExists = false) {
  check(
    await db()
      .from("filing_summaries")
      .upsert(
        {
          accession: s.accession,
          ticker: s.ticker,
          company_name: s.companyName,
          form: s.form,
          accepted: s.accepted,
          url: s.url,
          headline: s.headline,
          bullets: s.bullets,
          why_it_matters: s.whyItMatters,
          tone: s.tone,
          importance: s.importance,
          category: s.category,
          created_at: s.createdAt,
        },
        { onConflict: "accession", ignoreDuplicates: ignoreIfExists },
      ),
  );
}

/* ---------- Alert bookkeeping ---------- */

export async function unseen(accessions: string[]) {
  if (!accessions.length) return [];
  const rows = check(await db().from("seen_filings").select("accession").in("accession", accessions)) as { accession: string }[];
  const seen = new Set(rows.map((r) => r.accession));
  return accessions.filter((a) => !seen.has(a));
}

/** Mark a filing as handled. Returns false if something else already claimed it. */
export async function claimFiling(accession: string) {
  const rows = check(await db().from("seen_filings").upsert({ accession }, { onConflict: "accession", ignoreDuplicates: true }).select("accession"));
  return (rows?.length ?? 0) > 0;
}

export async function getState(key: string) {
  const r = check(await db().from("app_state").select("value").eq("key", key).maybeSingle()) as { value: string } | null;
  return r?.value ?? null;
}

export async function setState(key: string, value: string) {
  check(await db().from("app_state").upsert({ key, value, updated_at: new Date().toISOString() }));
}

export async function queueDigest(subscriberId: string, accession: string) {
  check(
    await db().from("digest_queue").upsert({ subscriber_id: subscriberId, accession }, { onConflict: "subscriber_id,accession", ignoreDuplicates: true }),
  );
}

/** Everything waiting for daily emails, grouped by subscriber. */
export async function pendingDigests(): Promise<Map<string, Summary[]>> {
  const rows = check(await db().from("digest_queue").select("subscriber_id, filing_summaries(*)").order("queued_at")) as unknown as {
    subscriber_id: string;
    filing_summaries: SumRow | null;
  }[];
  const by = new Map<string, Summary[]>();
  for (const r of rows) if (r.filing_summaries) by.set(r.subscriber_id, [...(by.get(r.subscriber_id) ?? []), toSummary(r.filing_summaries)]);
  return by;
}

export async function clearDigest(subscriberId: string) {
  check(await db().from("digest_queue").delete().eq("subscriber_id", subscriberId));
}

/* ---------- Picks ---------- */

type PickRow = {
  id: string;
  ticker: string;
  company_name: string;
  kind: Pick["kind"];
  title: string;
  why: string;
  author: string;
  tier: Pick["tier"];
  posted_at: string;
  price_at_post: number | string;
  owns_shares: boolean;
  ownership_note: string;
  sponsor: Pick["sponsor"] | null;
  closed_at: string | null;
  price_at_close: number | string | null;
};
const toPick = (r: PickRow): Pick => ({
  id: r.id,
  ticker: r.ticker,
  companyName: r.company_name,
  kind: r.kind,
  title: r.title,
  why: r.why,
  author: r.author,
  tier: r.tier,
  postedAt: r.posted_at,
  priceAtPost: Number(r.price_at_post),
  ownsShares: r.owns_shares,
  ownershipNote: r.ownership_note,
  sponsor: r.sponsor ?? undefined,
  closedAt: r.closed_at ?? undefined,
  priceAtClose: r.price_at_close === null ? undefined : Number(r.price_at_close),
});

export async function listPicks(ticker?: string) {
  let q = db().from("picks").select("*").order("posted_at", { ascending: false });
  if (ticker) q = q.eq("ticker", ticker);
  return (check(await q) as PickRow[]).map(toPick);
}

export async function getPick(id: string) {
  const r = check(await db().from("picks").select("*").eq("id", id).maybeSingle());
  return r ? toPick(r as PickRow) : null;
}

export async function insertPick(p: Omit<Pick, "id" | "postedAt" | "closedAt" | "priceAtClose">) {
  const r = check(
    await db()
      .from("picks")
      .insert({
        ticker: p.ticker,
        company_name: p.companyName,
        kind: p.kind,
        title: p.title,
        why: p.why,
        author: p.author,
        tier: p.tier,
        price_at_post: p.priceAtPost,
        owns_shares: p.ownsShares,
        ownership_note: p.ownershipNote,
        sponsor: p.sponsor ?? null,
      })
      .select("*")
      .single(),
  );
  return toPick(r as PickRow);
}

export async function closePick(id: string, price: number) {
  check(await db().from("picks").update({ closed_at: new Date().toISOString(), price_at_close: price }).eq("id", id).is("closed_at", null));
}
