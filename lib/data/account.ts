/** A signed-in person's stocks ("My stocks") and the alerts on them. */
import type { Client, Pool, PoolClient } from "pg";
import { signUp, stopOwnSubscription } from "../alerts/subscriptions";
import type { User } from "../auth/accounts";
import type { Verdict } from "../health";
import { getFeed, type FeedItem } from "./feed";

type Db = Pool | PoolClient | Client;

export type MyStock = {
  cik: number;
  ticker: string | null;
  name: string;
  tvSymbol: string | null;
  verdict: Verdict | null;
  /** Email alerts for this company are on. */
  alerts: boolean;
  latest: FeedItem | null;
  /** Posts since `since` (the person's previous visit). */
  fresh: number;
};

/** Add a company to My stocks and, unless told otherwise, switch its email alerts on. */
export async function followCompany(
  db: Db, user: User, cik: number,
  opts: { alerts?: boolean; consentText: string; source: string; ip: string | null; userAgent: string | null },
): Promise<void> {
  await db.query(`insert into public.watchlists (user_id, cik) values ($1, $2) on conflict do nothing`, [user.id, cik]);
  await db.query(`update public.companies set tracked = true where cik = $1 and not tracked`, [cik]);
  if (opts.alerts !== false) await setStockAlerts(db, user, cik, true, opts);
}

/** Remove a company from My stocks and stop its alerts. */
export async function unfollowCompany(db: Db, user: User, cik: number): Promise<void> {
  await db.query(`delete from public.watchlists where user_id = $1 and cik = $2`, [user.id, cik]);
  await stopOwnSubscription(db, user.email, cik);
}

/** The "Email" switch on a stock card. The address is the person's own, proved by signing in, so it applies at once. */
export async function setStockAlerts(
  db: Db, user: User, cik: number, on: boolean,
  opts: { consentText: string; source: string; ip: string | null; userAgent: string | null },
): Promise<void> {
  if (!on) {
    await stopOwnSubscription(db, user.email, cik);
    return;
  }
  await signUp(db, {
    email: user.email, cik, picks: false, source: opts.source, consentText: opts.consentText, ip: opts.ip, userAgent: opts.userAgent,
    verifiedEmail: user.email, userId: user.id,
  });
}

/** Companies whose email alerts are on for this person. */
export async function alertCiks(db: Db, email: string): Promise<number[]> {
  const { rows } = await db.query<{ cik: string }>(
    `select cik::text as cik from public.alert_subscriptions where channel = 'email' and address = $1 and status = 'active' and cik is not null`,
    [email],
  );
  return rows.map((r) => Number(r.cik));
}

export async function watchlistCiks(db: Db, userId: string): Promise<number[]> {
  const { rows } = await db.query<{ cik: string }>(`select cik::text as cik from public.watchlists where user_id = $1`, [userId]);
  return rows.map((r) => Number(r.cik));
}

/**
 * Everything the My stocks page shows. Companies the person gets alerts for but never added by hand
 * (for example follows copied from the old sites) are included too, so nothing they follow is hidden.
 */
export async function listMyStocks(db: Db, user: User, since?: Date): Promise<MyStock[]> {
  const { rows } = await db.query<{
    cik: string; ticker: string | null; name: string; tv_symbol: string | null; verdict: Verdict | null; alerts: boolean; fresh: string;
  }>(
    `with mine as (
       select cik, added_at from public.watchlists where user_id = $1
       union
       select cik, created_at from public.alert_subscriptions
        where channel = 'email' and address = $2 and status = 'active' and cik is not null
     )
     select c.cik::text as cik, c.ticker, c.name, c.tv_symbol,
            (select verdict from public.fundamentals_snapshots s where s.cik = c.cik order by as_of desc limit 1) as verdict,
            exists (select 1 from public.alert_subscriptions a
                     where a.channel = 'email' and a.address = $2 and a.cik = c.cik and a.status = 'active') as alerts,
            (select count(*) from public.filings f where f.cik = c.cik and f.category is not null and f.accepted_at > $3)
          + (select count(*) from public.news n where n.cik = c.cik and n.source <> 'sec' and n.published_at > $3) as fresh
       from (select cik, min(added_at) as added_at from mine group by cik) m
       join public.companies c on c.cik = m.cik
      order by m.added_at desc, c.name`,
    [user.id, user.email, (since ?? new Date()).toISOString()],
  );
  const out: MyStock[] = [];
  for (const r of rows) {
    const latest = (await getFeed(db, { cik: Number(r.cik), limit: 1 })).items[0] ?? null;
    out.push({
      cik: Number(r.cik), ticker: r.ticker, name: r.name, tvSymbol: r.tv_symbol, verdict: r.verdict, alerts: r.alerts, latest,
      fresh: since ? Number(r.fresh) : 0,
    });
  }
  return out;
}
