/**
 * Picks: the free daily pick and sponsored picks. A sponsored pick always says who paid, how much and
 * in what form: the database refuses one without it, and picks can never be deleted.
 * No price is ever fetched, stored or shown here.
 */
import type { Client, Pool, PoolClient } from "pg";
import { inTransaction } from "../alerts/subscriptions";
import { normalizeTicker } from "../sec/companies";
export { sponsorLine } from "../pick-disclosure";

type Db = Pool | PoolClient | Client;

export type Sponsor = { payer: string; amount: string; form: string };

export type StockPick = {
  id: string;
  ticker: string;
  company: string;
  cik: number | null;
  sponsored: boolean;
  /** The reason in one sentence. */
  title: string;
  /** A short paragraph: why it is on our radar. */
  why: string;
  postedAt: string;
  /** Publication and email eligibility time. */
  startsAt: string;
  /** Who paid, how much, in what form (sponsored picks made here). */
  sponsor: Sponsor | null;
  /** The disclosure exactly as it was sent (sponsored picks copied from the old site). */
  disclosureText: string | null;
  /** The filing or release the pick is about, if any. */
  sourceUrl: string | null;
  /** Whether BigStocks staff own shares, when recorded. */
  ownsShares: boolean | null;
  ownershipNote: string;
};

const COLS = `p.id::text as id, p.ticker, p.company_name, p.cik::text as cik, p.kind, p.title, p.why, p.posted_at, p.starts_at, p.sponsor,
  p.disclosure_text, p.source_url, p.owns_shares, p.ownership_note`;

type Row = {
  id: string; ticker: string; company_name: string; cik: string | null; kind: "pick" | "sponsored"; title: string; why: string;
  posted_at: Date; starts_at: Date; sponsor: Partial<Sponsor> | null; disclosure_text: string | null; source_url: string | null;
  owns_shares: boolean | null; ownership_note: string | null;
};

function toPick(r: Row): StockPick {
  const s = r.sponsor;
  const sponsor = s && s.payer && s.amount && s.form ? { payer: String(s.payer), amount: String(s.amount), form: String(s.form) } : null;
  return {
    id: r.id, ticker: r.ticker, company: r.company_name, cik: r.cik === null ? null : Number(r.cik), sponsored: r.kind === "sponsored",
    title: r.title, why: r.why, postedAt: new Date(r.posted_at).toISOString(), startsAt: new Date(r.starts_at).toISOString(), sponsor, disclosureText: r.disclosure_text,
    sourceUrl: r.source_url, ownsShares: r.owns_shares, ownershipNote: r.ownership_note ?? "",
  };
}

/** The newest pick that is not sponsored (the "today's pick" card), or null. */
export async function latestFreePick(db: Db): Promise<StockPick | null> {
  const { rows } = await db.query<Row>(`select ${COLS} from public.picks p where p.kind = 'pick' and p.starts_at <= now() order by p.starts_at desc limit 1`);
  return rows[0] ? toPick(rows[0]) : null;
}

/** Published picks, newest first. Staff may include scheduled picks. */
export async function listPicks(db: Db, opts: { before?: string; limit?: number | null; cik?: number; includeScheduled?: boolean } = {}): Promise<StockPick[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (!opts.includeScheduled) where.push("p.starts_at <= now()");
  if (opts.before && !Number.isNaN(Date.parse(opts.before))) where.push(`p.starts_at < $${params.push(opts.before)}`);
  if (opts.cik) where.push(`p.cik = $${params.push(opts.cik)}`);
  const limit = opts.limit === null ? "" : `limit $${params.push(Math.min(Math.max(opts.limit ?? 30, 1), 100))}`;
  const { rows } = await db.query<Row>(
    `select ${COLS} from public.picks p ${where.length ? "where " + where.join(" and ") : ""} order by p.starts_at desc ${limit}`,
    params,
  );
  return rows.map(toPick);
}

/** All picks that have not yet become public, for staff only. */
export async function listScheduledPicks(db: Db): Promise<StockPick[]> {
  const { rows } = await db.query<Row>(
    `select ${COLS} from public.picks p where p.starts_at > now() order by p.starts_at`,
  );
  return rows.map(toPick);
}

export async function getPick(db: Db, id: string): Promise<StockPick | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { rows } = await db.query<Row>(`select ${COLS} from public.picks p where p.id = $1 and p.starts_at <= now()`, [id]);
  return rows[0] ? toPick(rows[0]) : null;
}

export type NewPick = {
  ticker: string;
  title: string;
  why: string;
  author: string;
  sourceUrl?: string | null;
  ownsShares: boolean;
  ownershipNote?: string;
} & (
  | {
    sponsored: true;
    sponsor: Sponsor;
    /** YYYY-MM-DD; starts at midnight New York time. */
    startDate: string;
  }
  | { sponsored: false; sponsor?: null; startDate?: never }
);

export class PickInputError extends Error {}
export class PickNotEditableError extends Error {}

async function preparePick(db: Db, input: NewPick) {
  const ticker = normalizeTicker(input.ticker);
  if (!ticker) throw new PickInputError("That ticker doesn't look right.");
  const title = input.title.trim();
  const why = input.why.trim();
  if (title.length < 10 || title.length > 200) throw new PickInputError("The one-sentence reason needs 10 to 200 characters.");
  if (why.length > 2000) throw new PickInputError("The explanation is too long (2,000 characters at most).");
  if (input.sourceUrl && !/^https:\/\/\S+$/.test(input.sourceUrl)) throw new PickInputError("The source link must start with https://");
  if (input.sponsored && !input.sponsor) throw new PickInputError("A sponsored pick must say who paid, how much, and in what form.");
  if (!input.sponsored && (input.sponsor || input.startDate !== undefined)) throw new PickInputError("Only sponsored picks can have sponsor details or a start date.");
  const sponsor = input.sponsored
    ? { payer: input.sponsor.payer.trim(), amount: input.sponsor.amount.trim(), form: input.sponsor.form.trim() }
    : null;
  if (sponsor && !(sponsor.payer && sponsor.amount && sponsor.form)) {
    throw new PickInputError("A sponsored pick must say who paid, how much, and in what form (cash, shares…).");
  }
  const startDate = input.sponsored ? input.startDate : null;
  if (input.sponsored && (typeof startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
    || Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))
    || new Date(`${startDate}T00:00:00Z`).toISOString().slice(0, 10) !== startDate
    || startDate < "0001-01-01")) {
    throw new PickInputError("A sponsored pick needs a valid start date (YYYY-MM-DD).");
  }
  const co = await db.query<{ cik: string; name: string }>(
    `select c.cik::text as cik, c.name from public.company_tickers t join public.companies c on c.cik = t.cik where t.ticker = $1`,
    [ticker],
  );
  if (!co.rows[0]) throw new PickInputError(`No company with the ticker ${ticker} in the SEC's list.`);
  return { ticker, title, why, sponsor, startDate, company: co.rows[0] };
}

/**
 * Saves a pick. Sponsored picks publish at midnight New York time on their start date; the worker
 * sends eligible picks after that time. Invalid details throw a plain-English error.
 */
export async function createPick(db: Db, input: NewPick): Promise<StockPick> {
  const { ticker, title, why, sponsor, startDate, company } = await preparePick(db, input);
  const { rows } = await db.query<Row>(
    `insert into public.picks as p (ticker, company_name, cik, kind, title, why, author, tier, owns_shares, ownership_note, sponsor, source_url, starts_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'free', $8, $9, $10, $11, coalesce($12::date::timestamp at time zone 'America/New_York', now()))
     returning ${COLS}`,
    [ticker, company.name, company.cik, sponsor ? "sponsored" : "pick", title, why, input.author.trim() || "BigStocks",
      input.ownsShares, input.ownershipNote?.trim() ?? "", sponsor ? JSON.stringify(sponsor) : null, input.sourceUrl ?? null, startDate],
  );
  return toPick(rows[0]);
}

/** Update only a still-private, unmatched pick. The worker locks the same row when matching. */
export async function updateScheduledPick(db: Db, id: string, input: NewPick): Promise<StockPick> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new PickNotEditableError("This pick cannot be edited.");
  }
  const { ticker, title, why, sponsor, startDate, company } = await preparePick(db, input);
  return inTransaction(db, async (c) => {
    await c.query(`select id from public.picks where id = $1 for update`, [id]);
    const { rows } = await c.query<Row>(
      `update public.picks as p
          set ticker = $2, company_name = $3, cik = $4, kind = $5, title = $6, why = $7,
              owns_shares = $8, ownership_note = $9, sponsor = $10, source_url = $11,
              starts_at = coalesce($12::date::timestamp at time zone 'America/New_York', clock_timestamp())
        where p.id = $1 and p.starts_at > clock_timestamp() and p.matched_at is null
        returning ${COLS}`,
      [id, ticker, company.name, company.cik, sponsor ? "sponsored" : "pick", title, why,
        input.ownsShares, input.ownershipNote?.trim() ?? "", sponsor ? JSON.stringify(sponsor) : null, input.sourceUrl ?? null, startDate],
    );
    if (!rows[0]) throw new PickNotEditableError("This pick is no longer editable. It may already be public.");
    return toPick(rows[0]);
  });
}
