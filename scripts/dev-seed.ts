/**
 * Builds a LOCAL development database with made-up sample data, so the pages can be looked at
 * without the worker or any outside service. It refuses any host that is not local, and it drops and
 * re-creates the database it is given: never point it at anything you care about.
 *
 *   npm run dev:seed          # creates bs_dev on the local Postgres, prints the DATABASE_URL to use
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { loadCompanies } from "../lib/db/companies";
import { migrate } from "../lib/db/migrate";
import { describeTarget } from "../lib/db/target";
import { filingCategory } from "../lib/plain";
import { parseTickerFile } from "../lib/sec/companies";
import { ADMIN_URL, urlFor } from "./testing-db";

const NAME = "bs_dev";
const CIK = { AAPL: 320193, MSFT: 789019, NWBT: 9000001, HGRD: 9000002, CPLMF: 9000003 };
const folder = (cik: number, acc: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}`;

async function main() {
  const admin = describeTarget(ADMIN_URL);
  if (!admin.isLocal) throw new Error(`dev:seed only works on a local Postgres. This points at ${admin.host}.`);
  const root = new Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`drop database if exists ${NAME} with (force)`);
  await root.query(`create database ${NAME}`);
  await root.end();

  const db = new Client({ connectionString: urlFor(NAME) });
  await db.connect();
  await db.query("set client_min_messages = warning");
  await db.query(readFileSync("db/local/supabase-shim.sql", "utf8"));
  await migrate(db);
  const parsed = parseTickerFile(JSON.parse(readFileSync("scripts/fixtures/company_tickers_exchange.sample.json", "utf8")));
  await db.query("begin");
  await loadCompanies(db, parsed.tickers);
  await db.query("commit");
  await db.query(
    `update public.companies set tracked = true, profile_checked_at = now(), facts_checked_at = now(), viewed_at = now(),
            sic_description = case cik when $1 then 'Pharmaceutical Preparations' when $2 then 'Electrical Industrial Apparatus' else 'Electronic Computers' end,
            city = case cik when $1 then 'Cambridge' when $2 then 'Austin' else 'Cupertino' end,
            state = case cik when $1 then 'MA' when $2 then 'TX' else 'CA' end,
            is_emerging_growth = cik in ($1, $2)
      where cik in ($1, $2, $3, $4)`,
    [CIK.NWBT, CIK.HGRD, CIK.AAPL, CIK.MSFT],
  );

  let n = 0;
  const filing = async (
    t: keyof typeof CIK, form: string, ago: string, o: { items?: string[]; title?: string; headline?: string; one?: string; bullets?: string[]; kind?: "ai" | "rule" } = {},
  ) => {
    const cik = CIK[t];
    const acc = `${String(cik).padStart(10, "0")}-26-${String(++n).padStart(6, "0")}`;
    await db.query(
      `insert into public.filings (accession, cik, form, items, accepted_at, filed_date, primary_url, index_url, category, title, primary_document, detail_checked_at, matched_at)
       values ($1, $2, $3, $4, now() - $5::interval, (now() - $5::interval)::date, $6, $7, $8, $9, 'doc.htm', now(), now())`,
      [acc, cik, form, o.items ?? [], ago, `${folder(cik, acc)}/doc.htm`, `${folder(cik, acc)}/${acc}-index.htm`,
        filingCategory({ form, items: o.items }, { listed: true }), o.title ?? null],
    );
    if (o.headline) {
      await db.query(
        `insert into public.summaries (accession, kind, model, prompt_version, headline, one_sentence, bullets, tone, importance, category, source_url)
         values ($1, $2, $3, 2, $4, $5, $6, 'Routine', 'Medium', $7, $8)`,
        [acc, o.kind ?? "ai", (o.kind ?? "ai") === "ai" ? "claude-opus-5-5" : null, o.headline, o.one ?? o.headline, o.bullets ?? [],
          filingCategory({ form, items: o.items }, { listed: true }), `${folder(cik, acc)}/doc.htm`],
      );
    }
    return acc;
  };

  await filing("NWBT", "8-K", "20 seconds", {
    items: ["8.01"], title: "Northwind Biotherapeutics reports positive Phase 2 results for NW-210",
    headline: "Positive Phase 2 results for NW-210 in a rare liver disease",
    one: "The drug met its main goal in a mid-stage trial, and the company plans a larger, final-stage trial next year.",
    bullets: ["124 patients; liver scarring improved in 41% on the drug vs 12% on placebo.", "Side effects were mostly mild; 3 patients stopped early.", "No new money raised in this announcement."],
  });
  await filing("HGRD", "10-Q", "50 seconds", {
    headline: "Sales up 18%; first profitable quarter", one: "Sales grew 18% from a year ago and the company made a profit for the first time.",
    bullets: ["Sales of $142 million for the quarter.", "Net profit of $3.1 million, vs a $6.4 million loss a year ago.", "Raised its full-year sales forecast."],
  });
  await filing("MSFT", "4", "2 minutes", {
    kind: "rule", headline: "Chief Financial Officer bought 40,000 shares", one: "The Chief Financial Officer bought about $1.1 million of stock on the open market.",
    bullets: ["40,000 shares at about $27.50 a share.", "Open-market purchase, not granted as pay."],
  });
  await filing("AAPL", "8-K", "4 minutes", { items: ["5.02"] });
  await filing("AAPL", "10-Q", "3 hours");
  await filing("HGRD", "DEF 14A", "1 day");
  await filing("NWBT", "4", "7 days", { kind: "rule", headline: "Director bought 12,000 shares", one: "A director bought about $96,000 of stock on the open market.", bullets: ["12,000 shares at about $8.00 a share."] });
  await filing("NWBT", "10-Q", "21 days", { headline: "No sales yet, losses narrowed", one: "The company has no products on sale yet and lost less money than a year ago.", bullets: ["Net loss of $27 million, vs $31 million a year ago.", "Cash and investments of $212 million."] });
  await db.query(
    `insert into public.news (source, cik, ticker, company_name, title, url, published_at, matched_at) values
       ('prnewswire', $1, 'NWBT', 'Northwind Biotherapeutics', 'Northwind Biotherapeutics Announces Positive Topline Phase 2 Results', 'https://www.prnewswire.com/news-releases/northwind-sample-1.html', now() - interval '35 seconds', now()),
       ('businesswire', $2, 'CPLMF', 'Copperline Minerals', 'Copperline Minerals Names a New Chief Executive', 'https://www.businesswire.com/news/home/sample-2/en/', now() - interval '6 minutes', now())`,
    [CIK.NWBT, CIK.CPLMF],
  );

  const q = (end: string, revenue: number | null, netIncome: number, operatingIncome: number) => ({ end, revenue, netIncome, operatingIncome });
  const quarters = [{ end: "2025-12-31", filed: "2026-02-20" }, { end: "2026-03-31", filed: "2026-05-08" }, { end: "2026-06-30", filed: "2026-08-07" }, { end: "2026-09-30", filed: "2026-10-22" }];
  const snap = async (cik: number, verdict: string | null, checks: [string, string, string, (boolean | null)[]][], passed: number, answered: number, extra: object = {}) => {
    await db.query(
      `insert into public.fundamentals_snapshots (cik, as_of, quarters, ttm, score, verdict, rule_set, no_score_reason, source_filed)
       values ($1, current_date, $2, $3, $4, $5, 'standard', $6, '2026-10-22')`,
      [cik, JSON.stringify([q("2026-06-30", 120e6, 2e6, 3e6), q("2026-09-30", 142e6, 3.1e6, 5e6)]),
        JSON.stringify({ revenue: 510e6, netIncome: 4e6, operatingIncome: 9e6, operatingCashFlow: 20e6, cash: { liquid: 212e6, asOf: "2026-09-30", quarterlySpend: 27e6, months: 23.5 } }),
        JSON.stringify({
          ruleSet: "standard", verdict, noScoreReason: verdict ? null : "Not enough quarterly reports yet (needs 4). Shows up after the company's next quarterly report.",
          passed, answered, quarters, notes: [],
          checks: checks.map(([key, label, hint, answers]) => ({ key, label, hint, answers, counted: true })), ...extra,
        }),
        verdict, verdict ? null : "Not enough quarterly reports yet (needs 4). Shows up after the company's next quarterly report."],
    );
  };
  const std = (a: (boolean | null)[][]): [string, string, string, (boolean | null)[]][] => [
    ["salesGrew", "Sales grew", "Compared with the same quarter a year ago", a[0]],
    ["madeProfit", "Made a profit", "Earned more than it spent in the quarter", a[1]],
    ["profitGrew", "Profit grew", "Compared with the same quarter a year ago", a[2]],
    ["marginHeld", "Profit margin held up", "Kept about the same share of each sales dollar as a year ago", a[3]],
  ];
  const T = true, F = false;
  await snap(CIK.HGRD, "Strong", std([[T, T, T, T], [F, F, T, T], [T, T, T, T], [T, F, T, T]]), 13, 16);
  await snap(CIK.NWBT, "Weak", std([[null, null, null, null], [F, F, F, F], [F, T, T, T], [null, null, null, null]]), 3, 8);
  await snap(CIK.AAPL, "Mixed", std([[T, F, T, T], [T, T, T, T], [F, F, T, F], [F, T, F, T]]), 11, 16);
  await snap(CIK.MSFT, null, [], 0, 0);

  await db.query(
    `insert into public.picks (ticker, company_name, cik, kind, title, why, author, tier, posted_at, owns_shares, ownership_note, sponsor, source_url, matched_at) values
       ('HGRD', 'Halcyon Grid Systems Corp', $1, 'pick', 'First profitable quarter and a fourth quarter of sales growth in a row.',
        'The quarterly report filed this morning shows sales up 18% from a year ago and the first net profit in the company''s history.', 'BigStocks', 'free', now() - interval '3 hours', false, '', null, null, now()),
       ('CPLMF', 'Copperline Minerals Ltd', $2, 'sponsored', 'Reports new high-grade drill results at its main project.',
        'The company published assay results from twelve drill holes.', 'BigStocks', 'free', now() - interval '2 days', false, '',
        '{"payer":"Copperline Minerals Ltd","amount":"$5,000","form":"cash"}', null, now()),
       ('AAPL', 'Apple Inc.', $3, 'pick', 'Services sales reached a record for a sixth quarter in a row.', '', 'BigStocks', 'free', now() - interval '4 days', false, '', null, null, now())`,
    [CIK.HGRD, CIK.CPLMF, CIK.AAPL],
  );
  await db.query(`insert into public.users (email, is_admin) values ('dev@example.org', true)`);
  await db.end();
  console.log(`Sample database ready. Use:\n  DATABASE_URL='${urlFor(NAME)}'`);
}

main().catch((e) => {
  console.error("dev:seed failed:", (e as Error).message);
  process.exit(1);
});
