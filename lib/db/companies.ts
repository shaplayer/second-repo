/** Writes the SEC ticker list into companies and company_tickers. Safe to run again. */
import type { Client, PoolClient } from "pg";
import type { TickerRow } from "../sec/companies";

export type LoadCompaniesResult = {
  tickersInFile: number;
  companiesInFile: number;
  companiesAdded: number;
  companiesChanged: number;
  tickersAdded: number;
  tickersMoved: number;
  companiesDelisted: number;
  tickersRemoved: number;
  byExchange: Record<string, number>;
};

/** A real SEC file has well over ten thousand tickers; anything much smaller is a broken download. */
export const MIN_ROWS_FOR_PRUNE = 5000;

const CHUNK = 2000;

/**
 * Upserts every row. Never removes anything unless `prune` is set, in which case companies that are no
 * longer in the file lose their ticker (the company row stays, because filings point at it).
 * Runs inside the caller's transaction.
 */
export async function loadCompanies(client: Client | PoolClient, rows: TickerRow[], opts: { prune?: boolean } = {}): Promise<LoadCompaniesResult> {
  if (opts.prune && rows.length < MIN_ROWS_FOR_PRUNE) {
    throw new Error(
      `Refusing to prune with only ${rows.length} tickers in the file (expected at least ${MIN_ROWS_FOR_PRUNE}). ` +
        `A short file usually means a failed download.`,
    );
  }
  await client.query(`create temporary table tmp_sec_tickers (
      ticker text primary key, cik bigint not null, name text not null, exchange text, is_primary boolean not null, tv_symbol text
    ) on commit drop`);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await client.query(
      `insert into tmp_sec_tickers (ticker, cik, name, exchange, is_primary, tv_symbol)
       select ticker, cik, name, exchange, "isPrimary", "tvSymbol"
         from jsonb_to_recordset($1::jsonb)
           as t(ticker text, cik bigint, name text, exchange text, "isPrimary" boolean, "tvSymbol" text)`,
      [JSON.stringify(rows.slice(i, i + CHUNK))],
    );
  }

  // 1. Let go of tickers that now belong to a different company, so the unique rules can't trip.
  const moved = await client.query(
    `delete from public.company_tickers ct using tmp_sec_tickers t where ct.ticker = t.ticker and ct.cik <> t.cik`,
  );
  await client.query(
    `update public.companies c set ticker = null, updated_at = now()
      where c.ticker is not null
        and exists (select 1 from tmp_sec_tickers t where t.is_primary and t.ticker = c.ticker and t.cik <> c.cik)`,
  );
  await client.query(
    `update public.company_tickers ct set is_primary = false
       from tmp_sec_tickers t
      where t.is_primary and ct.cik = t.cik and ct.ticker <> t.ticker and ct.is_primary`,
  );
  // A company's main ticker changed to one it did not have before: free the old value first.
  await client.query(
    `update public.companies c set ticker = null
       from tmp_sec_tickers t
      where t.is_primary and t.cik = c.cik and c.ticker is distinct from t.ticker`,
  );

  // 2. Companies (one row per CIK, taken from its main ticker's line).
  const before = Number((await client.query(`select count(*) from public.companies`)).rows[0].count);
  const changed = await client.query(
    `insert into public.companies (cik, ticker, name, exchange, tv_symbol)
     select cik, ticker, name, exchange, tv_symbol from tmp_sec_tickers where is_primary
     on conflict (cik) do update
       set ticker = excluded.ticker, name = excluded.name, exchange = excluded.exchange,
           tv_symbol = excluded.tv_symbol, updated_at = now()
     where (public.companies.ticker, public.companies.name, public.companies.exchange, public.companies.tv_symbol)
           is distinct from (excluded.ticker, excluded.name, excluded.exchange, excluded.tv_symbol)`,
  );
  const after = Number((await client.query(`select count(*) from public.companies`)).rows[0].count);

  // 3. Every ticker.
  const tickersBefore = Number((await client.query(`select count(*) from public.company_tickers`)).rows[0].count);
  await client.query(
    `insert into public.company_tickers (ticker, cik, exchange, is_primary)
     select ticker, cik, exchange, is_primary from tmp_sec_tickers
     on conflict (ticker) do update
       set cik = excluded.cik, exchange = excluded.exchange, is_primary = excluded.is_primary
     where (public.company_tickers.cik, public.company_tickers.exchange, public.company_tickers.is_primary)
           is distinct from (excluded.cik, excluded.exchange, excluded.is_primary)`,
  );
  const tickersAfter = Number((await client.query(`select count(*) from public.company_tickers`)).rows[0].count);

  // 4. Optional: companies that have left the SEC list no longer answer to a ticker.
  let delisted = 0;
  let removed = 0;
  if (opts.prune) {
    removed =
      (await client.query(
        `delete from public.company_tickers ct where not exists (select 1 from tmp_sec_tickers t where t.ticker = ct.ticker)`,
      )).rowCount ?? 0;
    delisted =
      (await client.query(
        `update public.companies c set ticker = null, tv_symbol = null, updated_at = now()
          where c.ticker is not null and not exists (select 1 from tmp_sec_tickers t where t.cik = c.cik)`,
      )).rowCount ?? 0;
  }

  const byExchange: Record<string, number> = {};
  for (const r of rows) byExchange[r.exchange ?? "(none)"] = (byExchange[r.exchange ?? "(none)"] ?? 0) + 1;
  const added = after - before;
  return {
    tickersInFile: rows.length,
    companiesInFile: rows.filter((r) => r.isPrimary).length,
    companiesAdded: added,
    companiesChanged: Math.max((changed.rowCount ?? 0) - added, 0),
    tickersAdded: tickersAfter - tickersBefore,
    tickersMoved: moved.rowCount ?? 0,
    companiesDelisted: delisted,
    tickersRemoved: removed,
    byExchange,
  };
}
