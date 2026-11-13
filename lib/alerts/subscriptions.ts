/**
 * Who gets which email alerts: signing up, confirming, changing and unsubscribing.
 *
 * The rules (CLAUDE.md, plan Phase 4):
 * - Double opt-in for every list. A sign-up creates rows with status 'pending'; nothing is sent to a
 *   pending row except its confirmation email. Only the click on that email's link makes it 'active'.
 * - One confirmation click confirms what was asked for in that sign-up (its "batch") and nothing else.
 * - The wording the person agreed to, the time, their IP address and browser are stored with the row.
 * - Unsubscribing takes effect at once. Signing up again after unsubscribing needs a new confirmation.
 * - An address the email service told us to stop using (suppressions) is never signed up again here.
 * - A signed-in person has already proved the address is theirs, so their own changes apply at once.
 *
 * Email only for now. Rows with channel 'sms' (copied from the old site) are never changed here.
 */
import type { Client, Pool, PoolClient } from "pg";
import { randomToken, sign, verify } from "../auth/secret";
import type { Category } from "../plain";

type Db = Pool | PoolClient | Client;

/** What following a company means by default: everything it publishes. */
export const COMPANY_CATEGORIES: Category[] = ["press", "earnings", "news", "insider", "proxy"];
export const ALL_ALERT_CATEGORIES = ["picks", "press", "earnings", "news", "insider", "ipo", "proxy"] as const;
export type AlertCategory = (typeof ALL_ALERT_CATEGORIES)[number];

export type Subscription = {
  id: number;
  address: string;
  /** Null = the free pick list. */
  cik: number | null;
  ticker: string | null;
  company: string | null;
  categories: AlertCategory[];
  cadence: "instant" | "digest";
  status: "pending" | "active" | "unsubscribed";
};

const SUB_COLS = `s.id::text as id, s.address, s.cik::text as cik, c.ticker, c.name as company, s.categories, s.cadence, s.status`;
type SubRow = {
  id: string; address: string; cik: string | null; ticker: string | null; company: string | null; categories: string[];
  cadence: "instant" | "digest"; status: Subscription["status"];
};
const toSub = (r: SubRow): Subscription => ({
  id: Number(r.id), address: r.address, cik: r.cik === null ? null : Number(r.cik), ticker: r.ticker, company: r.company,
  categories: r.categories as AlertCategory[], cadence: r.cadence, status: r.status,
});

/**
 * Runs `fn` as one all-or-nothing step. A Pool hands out a dedicated connection. A connection that is
 * already inside a transaction (a caller's, or a test's) gets a savepoint instead, so this never
 * commits or rolls back work that belongs to the caller.
 */
export async function inTransaction<T>(db: Db, fn: (c: PoolClient | Client) => Promise<T>): Promise<T> {
  const pooled = "totalCount" in db;
  const c = pooled ? await (db as Pool).connect() : (db as PoolClient | Client);
  let nested = false;
  if (!pooled) {
    // SET LOCAL only sticks inside a transaction: that tells us whether the caller has one open.
    const mark = randomToken(6);
    await c.query(`select set_config('bigstocks.txn_probe', $1, true)`, [mark]);
    nested = (await c.query(`select current_setting('bigstocks.txn_probe', true) as v`)).rows[0].v === mark;
  }
  const point = `sp_${randomToken(6).replace(/[^a-zA-Z0-9]/g, "x")}`;
  try {
    await c.query(nested ? `savepoint ${point}` : "begin");
    const out = await fn(c);
    await c.query(nested ? `release savepoint ${point}` : "commit");
    return out;
  } catch (e) {
    await c.query(nested ? `rollback to savepoint ${point}` : "rollback").catch(() => {});
    throw e;
  } finally {
    if (pooled) (c as PoolClient).release();
  }
}

export async function isSuppressed(db: Db, email: string): Promise<boolean> {
  const { rows } = await db.query(`select 1 from public.suppressions where channel = 'email' and address = $1`, [email]);
  return rows.length > 0;
}

/* ------------------------------------------------------------------ sign-up */

export type SignupRequest = {
  /** Already normalised (lib/auth/accounts.ts normalizeEmail). */
  email: string;
  /** A company to follow, if any. */
  cik?: number | null;
  /** Join the free pick list. Default true. */
  picks?: boolean;
  /** Which page or form this came from, e.g. "home-hero", "stock:NWBT". */
  source: string;
  /** The exact fine print shown next to the button the person pressed. */
  consentText: string;
  ip: string | null;
  userAgent: string | null;
  /** Add to a sign-up already in progress (the "follow a few stocks while you wait" step). */
  batch?: string | null;
  /** The signed-in person's own address, when there is one. Their changes need no confirmation email. */
  verifiedEmail?: string | null;
  /** Their account id, to tie the rows to. */
  userId?: string | null;
};

export type SignupResult = {
  /** True when the address may not be signed up (the email service told us to stop sending to it). */
  suppressed: boolean;
  batch: string;
  /** Rows now waiting for the confirmation click. */
  pending: number;
  /** Rows switched on straight away (a signed-in person using their own address). */
  activated: number;
  /** Rows that were already on. */
  alreadyActive: number;
  /** The code for the confirmation link, when something is waiting. */
  confirmToken: string | null;
};

export async function signUp(db: Db, req: SignupRequest): Promise<SignupResult> {
  const batch = req.batch && /^[A-Za-z0-9_-]{10,64}$/.test(req.batch) ? req.batch : randomToken(16);
  const result: SignupResult = { suppressed: false, batch, pending: 0, activated: 0, alreadyActive: 0, confirmToken: null };
  if (await isSuppressed(db, req.email)) return { ...result, suppressed: true };
  const verified = Boolean(req.verifiedEmail) && req.verifiedEmail === req.email;
  const targets: { cik: number | null; categories: string[] }[] = [];
  if (req.picks !== false) targets.push({ cik: null, categories: ["picks"] });
  if (req.cik) targets.push({ cik: req.cik, categories: COMPANY_CATEGORIES });
  const evidence = [req.consentText, req.ip, req.userAgent?.slice(0, 400) ?? null, req.source.slice(0, 80)];

  return inTransaction(db, async (c) => {
    for (const t of targets) {
      const { rows } = await c.query<{ id: string; status: Subscription["status"]; confirm_token: string | null; unsubscribed_at: string | null }>(
        `select id::text as id, status, confirm_token, unsubscribed_at::text as unsubscribed_at
           from public.alert_subscriptions
          where channel = 'email' and address = $1 and cik is not distinct from $2 for update`,
        [req.email, t.cik],
      );
      const row = rows[0];
      if (!row) {
        const token = verified ? null : randomToken();
        const ins = await c.query(
          `insert into public.alert_subscriptions
             (user_id, channel, address, cik, categories, status, confirm_token, unsubscribe_token, consent_text, consent_at,
              consent_ip, consent_user_agent, source, confirmed_at, confirm_batch)
           values ($1, 'email', $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12, $13)
           on conflict on constraint alert_subscriptions_one_per_address_and_company do nothing
           returning id`,
          [req.userId ?? null, req.email, t.cik, t.categories, verified ? "active" : "pending", token, randomToken(), ...evidence,
            verified ? new Date() : null, batch],
        );
        if (!ins.rowCount) continue; // made by another request at the same moment: that one's confirmation covers it
        if (verified) result.activated++;
        else {
          result.pending++;
          result.confirmToken ??= token;
        }
      } else if (row.status === "active") {
        result.alreadyActive++;
      } else if (verified) {
        // Their own address, proved by signing in: switch it (back) on with this consent on record.
        await c.query(
          `update public.alert_subscriptions
              set status = 'active', confirm_token = null, confirmed_at = now(), unsubscribed_at = null, user_id = coalesce($2, user_id),
                  consent_text = $3, consent_at = now(), consent_ip = $4, consent_user_agent = $5, source = $6,
                  legacy = case when $7::text is null then legacy
                                else coalesce(legacy, '{}'::jsonb) || jsonb_build_object('resubscribed_after_opt_out_at', $7::text) end
            where id = $1`,
          [row.id, req.userId ?? null, ...evidence, row.unsubscribed_at],
        );
        result.activated++;
      } else {
        // Waiting for confirmation, or opted out earlier: this request needs its own confirmation click.
        const token = row.status === "pending" && row.confirm_token ? row.confirm_token : randomToken();
        await c.query(
          `update public.alert_subscriptions
              set status = 'pending', confirm_token = $2, confirm_batch = $3, unsubscribed_at = null,
                  consent_text = $4, consent_at = now(), consent_ip = $5, consent_user_agent = $6, source = $7,
                  legacy = case when $8::text is null then legacy
                                else coalesce(legacy, '{}'::jsonb) || jsonb_build_object('signed_up_again_after_opt_out_at', $8::text) end
            where id = $1`,
          [row.id, token, batch, ...evidence, row.unsubscribed_at],
        );
        result.pending++;
        result.confirmToken ??= token;
      }
    }
    return result;
  });
}

/** Counts a confirmation email as sent, and says whether one may be sent now (at most 3 a day per sign-up). */
export async function noteConfirmationSent(db: Db, confirmToken: string): Promise<boolean> {
  const { rows } = await db.query(
    `update public.alert_subscriptions
        set confirm_sends = case when confirm_sent_at > now() - interval '1 day' then confirm_sends + 1 else 1 end,
            confirm_sent_at = now()
      where confirm_token = $1 and status = 'pending'
        and (confirm_sent_at is null or confirm_sent_at < now() - interval '1 day' or confirm_sends < 3)
      returning id`,
    [confirmToken],
  );
  return rows.length > 0;
}

/** What a confirmation link is for, without confirming anything (shown before the click). */
export async function peekConfirmation(db: Db, token: string): Promise<{ email: string; waiting: Subscription[]; alreadyConfirmed: boolean } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { rows } = await db.query<SubRow & { confirm_batch: string | null; via: string }>(
    `select ${SUB_COLS}, s.confirm_batch, case when s.confirm_token = $1 then 'confirm' else 'legacy' end as via
       from public.alert_subscriptions s left join public.companies c on c.cik = s.cik
      where s.channel = 'email' and (s.confirm_token = $1 or s.legacy_token = $1)
      order by (s.confirm_token = $1) desc, s.id`,
    [token],
  );
  if (!rows.length) return null;
  const email = rows[0].address;
  const waiting = await waitingRows(db, rows);
  return { email, waiting: waiting.map(toSub), alreadyConfirmed: waiting.length === 0 };
}

/** The pending rows one confirmation link covers: its own row, the rest of its batch, or (old app links) every row with that old token. */
async function waitingRows(db: Db, matched: (SubRow & { confirm_batch: string | null; via: string })[]): Promise<SubRow[]> {
  const direct = matched.filter((r) => r.via === "confirm");
  if (direct.length) {
    const row = direct[0];
    const { rows } = await db.query<SubRow>(
      `select ${SUB_COLS} from public.alert_subscriptions s left join public.companies c on c.cik = s.cik
        where s.channel = 'email' and s.address = $1 and s.status = 'pending'
          and (s.id = $2 or ($3::text is not null and s.confirm_batch = $3))
        order by s.cik nulls first`,
      [row.address, row.id, row.confirm_batch],
    );
    return rows;
  }
  // A link from the old app: one code per person, covering every row it was copied into.
  return matched.filter((r) => r.status === "pending");
}

export type Confirmed = { email: string; confirmed: Subscription[]; alreadyConfirmed: boolean };

/**
 * The confirmation click. Switches on the rows the link covers and records where the click came from.
 * Null = the link is not one of ours.
 */
export async function confirmSignup(db: Db, token: string, click: { ip: string | null; userAgent: string | null }): Promise<Confirmed | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return inTransaction(db, async (c) => {
    const { rows } = await c.query<SubRow & { confirm_batch: string | null; via: string }>(
      `select ${SUB_COLS}, s.confirm_batch, case when s.confirm_token = $1 then 'confirm' else 'legacy' end as via
         from public.alert_subscriptions s left join public.companies c on c.cik = s.cik
        where s.channel = 'email' and (s.confirm_token = $1 or s.legacy_token = $1)
        order by (s.confirm_token = $1) desc, s.id
          for update of s`,
      [token],
    );
    if (!rows.length) return null;
    const email = rows[0].address;
    if (await isSuppressed(c, email)) return { email, confirmed: [], alreadyConfirmed: false };
    const waiting = await waitingRows(c, rows);
    if (!waiting.length) return { email, confirmed: [], alreadyConfirmed: true };
    const ids = waiting.map((w) => w.id);
    await c.query(
      `update public.alert_subscriptions
          set status = 'active', confirmed_at = now(), confirm_token = null,
              legacy = coalesce(legacy, '{}'::jsonb) || jsonb_build_object('confirmed_from', jsonb_build_object('ip', $2::text, 'user_agent', $3::text))
        where id = any($1::bigint[]) and status = 'pending'`,
      [ids, click.ip, click.userAgent?.slice(0, 400) ?? null],
    );
    return { email, confirmed: waiting.map((w) => toSub({ ...w, status: "active" })), alreadyConfirmed: false };
  });
}

/* -------------------------------------------------------------- unsubscribe */

export type UnsubscribeScope = "this" | "stocks" | "picks" | "all";

export type UnsubscribeView = {
  email: string;
  /** The rows the link itself points at (one for a link from our emails; several for an old-app link). */
  matched: Subscription[];
  /** Every email subscription of this address that is still on or waiting. */
  all: Subscription[];
};

async function rowsForToken(db: Db, token: string, lock: boolean): Promise<{ email: string; matched: SubRow[] } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { rows } = await db.query<SubRow & { direct: boolean }>(
    `select ${SUB_COLS}, (s.unsubscribe_token = $1) as direct
       from public.alert_subscriptions s left join public.companies c on c.cik = s.cik
      where s.channel = 'email' and (s.unsubscribe_token = $1 or s.legacy_token = $1 or s.confirm_token = $1)
      order by (s.unsubscribe_token = $1) desc, s.id ${lock ? "for update of s" : ""}`,
    [token],
  );
  if (!rows.length) return null;
  // The row's own unsubscribe code names exactly that row; an old per-person code names all of that person's rows.
  const direct = rows.filter((r) => r.direct);
  return { email: rows[0].address, matched: direct.length ? direct : rows };
}

/** What an unsubscribe link points at, without changing anything (the page asks before stopping). */
export async function peekUnsubscribe(db: Db, token: string): Promise<UnsubscribeView | null> {
  const found = await rowsForToken(db, token, false);
  if (!found) return null;
  const { rows } = await db.query<SubRow>(
    `select ${SUB_COLS} from public.alert_subscriptions s left join public.companies c on c.cik = s.cik
      where s.channel = 'email' and s.address = $1 and s.status <> 'unsubscribed' order by s.cik nulls first`,
    [found.email],
  );
  return { email: found.email, matched: found.matched.map(toSub), all: rows.map(toSub) };
}

export type Unsubscribed = {
  email: string;
  /** How many rows were switched off by this call. */
  stopped: number;
  /** Hand this back within an hour to undo exactly this change. */
  undoToken: string | null;
};

/**
 * Stops alerts, at once.
 *   this    the subscription(s) the link points at (what a mail app's one-click button does)
 *   stocks  every company alert of this address
 *   picks   the free pick list
 *   all     every email from us
 */
export async function unsubscribe(db: Db, token: string, scope: UnsubscribeScope): Promise<Unsubscribed | null> {
  return inTransaction(db, async (c) => {
    const found = await rowsForToken(c, token, true);
    if (!found) return null;
    const where =
      scope === "this" ? `id = any($2::bigint[])`
      : scope === "stocks" ? `cik is not null`
      : scope === "picks" ? `cik is null`
      : `true`;
    const params: unknown[] = [found.email];
    if (scope === "this") params.push(found.matched.map((m) => m.id));
    const { rows } = await c.query<{ id: string; was: string }>(
      `update public.alert_subscriptions n
          set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null
         from (select id, status from public.alert_subscriptions
                where channel = 'email' and address = $1 and status <> 'unsubscribed' and ${where} for update) old
        where n.id = old.id
        returning n.id::text as id, old.status as was`,
      params,
    );
    // Anything still waiting to be sent to these rows is dropped.
    if (rows.length) {
      await c.query(
        `update public.alert_events set status = 'suppressed', error = 'unsubscribed'
          where subscription_id = any($1::bigint[]) and status in ('queued', 'digest')`,
        [rows.map((r) => r.id)],
      );
    }
    const undo = rows.filter((r) => r.was === "active").map((r) => r.id);
    return {
      email: found.email, stopped: rows.length,
      undoToken: undo.length ? sign(`${found.email}|${undo.join(",")}`, "undo-unsubscribe", 3600_000) : null,
    };
  });
}

/** "Undo, resubscribe" on the unsubscribe page: restores exactly what that one change switched off. */
export async function undoUnsubscribe(db: Db, undoToken: string): Promise<number> {
  const value = verify(undoToken, "undo-unsubscribe");
  if (!value) return 0;
  const [email, list] = value.split("|");
  const ids = (list ?? "").split(",").filter((x) => /^\d+$/.test(x));
  if (!email || !ids.length || (await isSuppressed(db, email))) return 0;
  const r = await db.query(
    `update public.alert_subscriptions set status = 'active', unsubscribed_at = null
      where id = any($1::bigint[]) and channel = 'email' and address = $2 and status = 'unsubscribed'
        and unsubscribed_at > now() - interval '65 minutes'`,
    [ids, email],
  );
  return r.rowCount ?? 0;
}

/* ------------------------------------------------- signed-in: my subscriptions */

/** Every email subscription of a signed-in person's address. */
export async function listSubscriptions(db: Db, email: string): Promise<Subscription[]> {
  const { rows } = await db.query<SubRow>(
    `select ${SUB_COLS} from public.alert_subscriptions s left join public.companies c on c.cik = s.cik
      where s.channel = 'email' and s.address = $1 order by s.cik nulls first, s.id`,
    [email],
  );
  return rows.map(toSub);
}

/** Turn one kind of news on or off for every company this person follows (the "What" list on the settings page). */
export async function setCategory(db: Db, email: string, category: Exclude<AlertCategory, "picks">, on: boolean): Promise<void> {
  await db.query(
    on
      ? `update public.alert_subscriptions set categories = array_append(categories, $2)
          where channel = 'email' and address = $1 and cik is not null and not ($2 = any(categories))`
      : `update public.alert_subscriptions set categories = array_remove(categories, $2)
          where channel = 'email' and address = $1 and cik is not null and $2 = any(categories)`,
    [email, category],
  );
}

/** "As it happens" or "One daily summary", for every company alert of this person. The free pick always comes when it is sent. */
export async function setCadence(db: Db, email: string, cadence: "instant" | "digest"): Promise<void> {
  await db.query(
    `update public.alert_subscriptions set cadence = $2 where channel = 'email' and address = $1 and cik is not null and cadence <> $2`,
    [email, cadence],
  );
}

/** Switch off one of a signed-in person's own subscriptions (company alerts or the pick list). */
export async function stopOwnSubscription(db: Db, email: string, cik: number | null): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `update public.alert_subscriptions set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null
      where channel = 'email' and address = $1 and cik is not distinct from $2 and status <> 'unsubscribed'
      returning id::text as id`,
    [email, cik],
  );
  if (rows.length) {
    await db.query(
      `update public.alert_events set status = 'suppressed', error = 'unsubscribed'
        where subscription_id = any($1::bigint[]) and status in ('queued', 'digest')`,
      [rows.map((r) => r.id)],
    );
  }
  return rows.length;
}

/** "Unsubscribe from all" on the settings page. */
export async function stopEverything(db: Db, email: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `update public.alert_subscriptions set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null
      where channel = 'email' and address = $1 and status <> 'unsubscribed' returning id::text as id`,
    [email],
  );
  if (rows.length) {
    await db.query(
      `update public.alert_events set status = 'suppressed', error = 'unsubscribed'
        where subscription_id = any($1::bigint[]) and status in ('queued', 'digest')`,
      [rows.map((r) => r.id)],
    );
  }
  return rows.length;
}

/* ------------------------------------------------------------- suppressions */

/**
 * The email service reports that an address bounced or that the person marked us as spam: never send
 * to it again, whatever its subscriptions say.
 */
export async function suppressAddress(db: Db, email: string, reason: "bounce" | "complaint" | "manual", detail?: unknown): Promise<void> {
  await inTransaction(db, async (c) => {
    await c.query(
      `insert into public.suppressions (channel, address, reason, detail) values ('email', $1, $2, $3)
       on conflict (channel, address) do update set reason = excluded.reason, detail = excluded.detail`,
      [email, reason, detail === undefined ? null : JSON.stringify(detail)],
    );
    const { rows } = await c.query<{ id: string }>(
      `update public.alert_subscriptions set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null
        where channel = 'email' and address = $1 and status <> 'unsubscribed' returning id::text as id`,
      [email],
    );
    if (rows.length) {
      await c.query(
        `update public.alert_events set status = 'suppressed', error = $2
          where subscription_id = any($1::bigint[]) and status in ('queued', 'digest')`,
        [rows.map((r) => r.id), reason],
      );
    }
  });
}
