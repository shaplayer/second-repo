/**
 * Gives a filing its kind of news (earnings, company news, insider trade...) where it has none.
 * Rows copied from the old sites arrive without one, and a filing with no category is not shown.
 */
import { COLLECTED_FORMS, filingCategory } from "../plain";
import type { Db } from "./db";

/** Returns how many filings were classified. Safe to run again: it only fills empty categories. */
export async function classifyFilings(db: Db, limit = 5000): Promise<number> {
  const { rows } = await db.query<{ accession: string; form: string; items: string[] | null; listed: boolean }>(
    `select f.accession, f.form, f.items, (c.exchange is not null and btrim(c.exchange) <> '') as listed
       from public.filings f join public.companies c on c.cik = f.cik
      where f.category is null
        and upper(regexp_replace(btrim(f.form), '/A$', '', 'i')) = any($1::text[])
      order by f.accepted_at desc
      limit $2`,
    [COLLECTED_FORMS, Math.max(1, Math.floor(limit))],
  );
  const updates: { accession: string; category: string }[] = [];
  for (const r of rows) {
    const category = filingCategory({ form: r.form, items: r.items ?? [] }, { listed: r.listed });
    if (category) updates.push({ accession: r.accession, category });
  }
  if (!updates.length) return 0;
  const done = await db.query(
    `update public.filings f set category = u.category
       from jsonb_to_recordset($1::jsonb) as u(accession text, category text)
      where f.accession = u.accession and f.category is null`,
    [JSON.stringify(updates)],
  );
  return done.rowCount ?? 0;
}
