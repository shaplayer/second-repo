/**
 * Keeping what we know about a company up to date from the SEC's own record of it: who it is, what
 * it has filed lately, and (for the health check) its financial numbers. Safe to run again.
 */
import { baseForm, filingCategory, isCollectedForm } from "../plain";
import { SecHttpError, type SecClient } from "../sec/client";
import { newYorkDate } from "../sec/current-feed";
import { filingFolderUrl, filingIndexUrl } from "../sec/filing-index";
import { companyAtomUrl, companyFactsUrl, newYorkClockToIso, parseCompanyAtom, parseSubmissions, submissionsUrl } from "../sec/submissions";
import type { Db } from "./db";

const HISTORY_DAYS = 400;
const HISTORY_MAX = 60;
/** A filing this new is left to the live feed, which makes its alerts; history is never alerted on. */
const LEAVE_TO_LIVE_FEED_MS = 15 * 60_000;

const isNotFound = (e: unknown) => e instanceof SecHttpError && e.status === 404;

/**
 * Reads the SEC's record of the company: fills in the profile and stores its recent filings.
 * Those filings are history, so they are marked as already looked at and already matched: nobody is
 * ever alerted about them.
 */
export async function refreshCompanyProfile(db: Db, sec: SecClient, cik: number, opts: { now?: Date } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  let json: unknown;
  try {
    json = await sec.json(submissionsUrl(cik));
  } catch (e) {
    // The SEC has no record under this number: note that we looked, so it is not asked for every minute.
    if (isNotFound(e)) {
      await db.query(`update public.companies set profile_checked_at = now() where cik = $1`, [cik]);
      return;
    }
    throw e;
  }
  let parsed: ReturnType<typeof parseSubmissions>;
  try {
    parsed = parseSubmissions(json);
  } catch (e) {
    // Not a record we can read. Trying again in a minute will not change that.
    await db.query(`update public.companies set profile_checked_at = now() where cik = $1`, [cik]);
    throw e;
  }
  const { company, recent, reportsAsInsider } = parsed;

  // Exact acceptance times. Without them we carry on with the filing dates.
  let times = new Map<string, string>();
  try {
    times = parseCompanyAtom(await sec.text(companyAtomUrl(cik)));
  } catch {
    // carry on
  }

  const saved = await db.query<{ exchange: string | null }>(
    `insert into public.companies
       (cik, name, sic, sic_description, website, phone, fiscal_year_end, city, state, filer_category, is_emerging_growth)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (cik) do update set
       name = case when btrim(public.companies.name) = '' then excluded.name else public.companies.name end,
       sic = excluded.sic, sic_description = excluded.sic_description, website = excluded.website, phone = excluded.phone,
       fiscal_year_end = excluded.fiscal_year_end, city = excluded.city, state = excluded.state,
       filer_category = excluded.filer_category, is_emerging_growth = excluded.is_emerging_growth, updated_at = now()
     returning exchange`,
    [
      cik, company.name, company.sic, company.sicDescription, company.website, company.phone, company.fiscalYearEnd,
      company.city, company.state, company.filerCategory, company.isEmergingGrowth,
    ],
  );
  const listed = Boolean(saved.rows[0]?.exchange?.trim());

  const earliest = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const today = newYorkDate(now);
  const rows: Record<string, unknown>[] = [];
  for (const f of recent) {
    if (rows.length >= HISTORY_MAX) break;
    if (!isCollectedForm(f.form) || f.filedDate < earliest) continue;
    const { base } = baseForm(f.form);
    // The record does not say which side of these the company was on (see parseSubmissions); the live feed does.
    if (base === "SC 13D" || base === "SCHEDULE 13D" || (base === "4" && reportsAsInsider)) continue;
    const exact = times.get(f.accession);
    if (exact ? now.getTime() - Date.parse(exact) < LEAVE_TO_LIVE_FEED_MS : f.filedDate >= today) continue;
    const category = filingCategory({ form: f.form, items: f.items }, { listed });
    if (!category) continue;
    const document = f.primaryDocument && /^[\w.+~/-]+$/.test(f.primaryDocument) && !f.primaryDocument.includes("..") ? f.primaryDocument : null;
    const indexUrl = filingIndexUrl(cik, f.accession);
    rows.push({
      accession: f.accession,
      form: f.form,
      items: f.items,
      accepted_at: exact ?? newYorkClockToIso(f.filedDate, 16),
      filed_date: f.filedDate,
      primary_url: document ? filingFolderUrl(cik, f.accession) + document : indexUrl,
      index_url: indexUrl,
      category,
      primary_document: document ? document.slice(document.lastIndexOf("/") + 1) : null,
    });
  }
  if (rows.length) {
    // A filing the live feed already stored keeps its own marks: only gaps are filled in.
    await db.query(
      `insert into public.filings
         (accession, cik, form, items, accepted_at, filed_date, primary_url, index_url, category, primary_document,
          detail_checked_at, matched_at)
       select x.accession, $2, x.form, array(select jsonb_array_elements_text(x.items)), least(x.accepted_at, $3::timestamptz),
              x.filed_date, x.primary_url, x.index_url, x.category, x.primary_document, now(), now()
         from jsonb_to_recordset($1::jsonb)
           as x(accession text, form text, items jsonb, accepted_at timestamptz, filed_date date, primary_url text, index_url text,
                category text, primary_document text)
       on conflict (accession) do update set
         category = coalesce(public.filings.category, excluded.category),
         primary_document = coalesce(public.filings.primary_document, excluded.primary_document),
         primary_url = case when public.filings.primary_url = public.filings.index_url then excluded.primary_url
                            else public.filings.primary_url end
       where public.filings.cik = excluded.cik`,
      [JSON.stringify(rows), cik, now.toISOString()],
    );
  }
  await db.query(`update public.companies set profile_checked_at = now() where cik = $1`, [cik]);
}

/** What lib/health provides. Passed in by tests; the worker uses the real module. */
export type HealthDeps<F = unknown> = {
  scoreCompany: (
    facts: unknown,
    profile: { sic: string | null; isEmergingGrowth: boolean | null },
    opts: { today: string; growthRules: boolean },
  ) => F;
  saveSnapshot: (client: Db, cik: number, f: F) => Promise<void>;
};

async function loadHealth(): Promise<HealthDeps> {
  // Loaded when first needed, by a path the compiler does not follow, because lib/health is being
  // written in a separate change and this file must build and be testable without it.
  const path = "../health";
  const mod = (await import(path)) as Partial<HealthDeps> & { default?: Partial<HealthDeps> };
  const scoreCompany = mod.scoreCompany ?? mod.default?.scoreCompany;
  const saveSnapshot = mod.saveSnapshot ?? mod.default?.saveSnapshot;
  if (typeof scoreCompany !== "function" || typeof saveSnapshot !== "function") {
    throw new Error("lib/health does not export scoreCompany and saveSnapshot");
  }
  return { scoreCompany, saveSnapshot };
}

/**
 * Reads the company's financial numbers from the SEC and stores tonight's health check.
 * The SEC's data only: no price is ever fetched or stored.
 */
export async function refreshCompanyHealth(
  db: Db,
  sec: SecClient,
  cik: number,
  opts: { today: string; growthRules: boolean },
  deps?: HealthDeps,
): Promise<void> {
  const { rows } = await db.query<{ sic: string | null; is_emerging_growth: boolean | null }>(
    `select sic, is_emerging_growth from public.companies where cik = $1`,
    [cik],
  );
  if (!rows[0]) throw new Error(`Company ${cik} is not in the companies table`);
  const checked = () => db.query(`update public.companies set facts_checked_at = now() where cik = $1`, [cik]);

  // Before anything is asked of the SEC or written: a missing scorer must not mark companies as checked.
  const health = deps ?? (await loadHealth());

  let facts: unknown;
  try {
    facts = await sec.json(companyFactsUrl(cik));
  } catch (e) {
    // No financial data on file (a fund, a brand-new company...): nothing to store, and no reason to ask again tonight.
    if (isNotFound(e)) {
      await checked();
      return;
    }
    throw e;
  }
  try {
    const result = health.scoreCompany(facts, { sic: rows[0].sic, isEmergingGrowth: rows[0].is_emerging_growth }, opts);
    await health.saveSnapshot(db, cik, result);
  } catch (e) {
    // The numbers were read but could not be scored or saved. Move this company to the back of the
    // queue so it cannot hold up the others, and let the job record what went wrong.
    await checked().catch(() => {});
    throw e;
  }
  await checked();
}

/**
 * Tracked companies that are due a look: never checked first, then the ones checked longest ago,
 * as long as that was more than olderThanHours ago.
 */
export async function nextCompaniesToRefresh(db: Db, kind: "profile" | "facts", limit: number, olderThanHours: number): Promise<number[]> {
  const column = kind === "profile" ? "profile_checked_at" : "facts_checked_at";
  const { rows } = await db.query<{ cik: string }>(
    `select cik from public.companies
      where tracked and (${column} is null or ${column} < now() - make_interval(secs => $2::double precision * 3600))
      order by ${column} asc nulls first, cik
      limit $1`,
    [Math.max(0, Math.floor(limit)), Math.max(0, olderThanHours)],
  );
  return rows.map((r) => Number(r.cik));
}
