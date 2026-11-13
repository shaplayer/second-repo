/**
 * Picks: the free daily pick and sponsored picks. A sponsored pick always says who paid, how much and
 * in what form: the database refuses one without it, and picks can never be deleted.
 * No price is ever fetched, stored or shown here.
 */
import type { Client, Pool, PoolClient } from "pg";
import { normalizeTicker } from "../sec/companies";

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

const COLS = `p.id::text as id, p.ticker, p.company_name, p.cik::text as cik, p.kind, p.title, p.why, p.posted_at, p.sponsor,
  p.disclosure_text, p.source_url, p.owns_shares, p.ownership_note`;

type Row = {
  id: string; ticker: string; company_name: string; cik: string | null; kind: "pick" | "sponsored"; title: string; why: string;
  posted_at: Date; sponsor: Partial<Sponsor> | null; disclosure_text: string | null; source_url: string | null;
  owns_shares: boolean | null; ownership_note: string | null;
};

function toPick(r: Row): StockPick {
  const s = r.sponsor;
  const sponsor = s && s.payer && s.amount && s.form ? { payer: String(s.payer), amount: String(s.amount), form: String(s.form) } : null;
  return {
    id: r.id, ticker: r.ticker, company: r.company_name, cik: r.cik === null ? null : Number(r.cik), sponsored: r.kind === "sponsored",
    title: r.title, why: r.why, postedAt: new Date(r.posted_at).toISOString(), sponsor, disclosureText: r.disclosure_text,
    sourceUrl: r.source_url, ownsShares: r.owns_shares, ownershipNote: r.ownership_note ?? "",
  };
}

/** The sentence that must accompany a sponsored pick everywhere it appears: page, email, text. */
export function sponsorLine(p: StockPick): string | null {
  if (!p.sponsored) return null;
  if (p.sponsor) return `Sponsored. Paid for by ${p.sponsor.payer}: ${p.sponsor.amount}, ${p.sponsor.form}.`;
  return p.disclosureText?.trim() || "Sponsored.";
}

/** The newest pick that is not sponsored (the "today's pick" card), or null. */
export async function latestFreePick(db: Db): Promise<StockPick | null> {
  const { rows } = await db.query<Row>(`select ${COLS} from public.picks p where p.kind = 'pick' order by p.posted_at desc limit 1`);
  return rows[0] ? toPick(rows[0]) : null;
}

/** Every pick, newest first: free and sponsored together, each clearly marked. */
export async function listPicks(db: Db, opts: { before?: string; limit?: number; cik?: number } = {}): Promise<StockPick[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.before && !Number.isNaN(Date.parse(opts.before))) where.push(`p.posted_at < $${params.push(opts.before)}`);
  if (opts.cik) where.push(`p.cik = $${params.push(opts.cik)}`);
  params.push(Math.min(Math.max(opts.limit ?? 30, 1), 100));
  const { rows } = await db.query<Row>(
    `select ${COLS} from public.picks p ${where.length ? "where " + where.join(" and ") : ""} order by p.posted_at desc limit $${params.length}`,
    params,
  );
  return rows.map(toPick);
}

export async function getPick(db: Db, id: string): Promise<StockPick | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { rows } = await db.query<Row>(`select ${COLS} from public.picks p where p.id = $1`, [id]);
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
  /** Required for a sponsored pick: all three parts. */
  sponsor?: Sponsor | null;
};

/**
 * Posts a pick. The worker then sends it to the pick list. Throws a plain-English error when the
 * ticker is unknown or a sponsored pick lacks who paid, how much, or in what form.
 */
export async function createPick(db: Db, input: NewPick): Promise<StockPick> {
  const ticker = normalizeTicker(input.ticker);
  if (!ticker) throw new Error("That ticker doesn't look right.");
  const title = input.title.trim();
  const why = input.why.trim();
  if (title.length < 10 || title.length > 200) throw new Error("The one-sentence reason needs 10 to 200 characters.");
  if (why.length > 2000) throw new Error("The explanation is too long (2,000 characters at most).");
  if (input.sourceUrl && !/^https:\/\/\S+$/.test(input.sourceUrl)) throw new Error("The source link must start with https://");
  const sponsor = input.sponsor
    ? { payer: input.sponsor.payer.trim(), amount: input.sponsor.amount.trim(), form: input.sponsor.form.trim() }
    : null;
  if (sponsor && !(sponsor.payer && sponsor.amount && sponsor.form)) {
    throw new Error("A sponsored pick must say who paid, how much, and in what form (cash, shares…).");
  }
  const co = await db.query<{ cik: string; name: string }>(
    `select c.cik::text as cik, c.name from public.company_tickers t join public.companies c on c.cik = t.cik where t.ticker = $1`,
    [ticker],
  );
  if (!co.rows[0]) throw new Error(`No company with the ticker ${ticker} in the SEC's list.`);
  const { rows } = await db.query<Row>(
    `insert into public.picks as p (ticker, company_name, cik, kind, title, why, author, tier, owns_shares, ownership_note, sponsor, source_url)
     values ($1, $2, $3, $4, $5, $6, $7, 'free', $8, $9, $10, $11)
     returning ${COLS}`,
    [ticker, co.rows[0].name, co.rows[0].cik, sponsor ? "sponsored" : "pick", title, why, input.author.trim() || "BigStocks",
      input.ownsShares, input.ownershipNote?.trim() ?? "", sponsor ? JSON.stringify(sponsor) : null, input.sourceUrl ?? null],
  );
  return toPick(rows[0]);
}
