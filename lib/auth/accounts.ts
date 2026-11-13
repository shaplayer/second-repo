/**
 * Sign-in by emailed link only (plan decision 14). No passwords.
 *
 * - A sign-in link holds a random code that works once and for 15 minutes. Only its hash is stored.
 * - Opening the link does not sign anyone in by itself: mail scanners open every link in a message, so
 *   the page asks for one click, and only that click (a POST) uses the code.
 * - A signed-in browser holds a random session code in a cookie that scripts cannot read. Only its
 *   hash is stored, so reading the database does not let anyone sign in.
 * - Signing in with an address that has no account creates one ("Signing in creates your free account").
 */
import type { Client, Pool, PoolClient } from "pg";
import { randomToken, sha256Hex } from "./secret";

type Db = Pool | PoolClient | Client;

export const LOGIN_LINK_MINUTES = 15;
export const SESSION_DAYS = 60;
export const SESSION_COOKIE = "bs_session";

export type User = { id: string; email: string; displayName: string | null; isAdmin: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trimmed and lower-cased, or null when it is not an email address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

/** Only paths on this site may be used as "where to go next": never another site. */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\r\n]/.test(raw)) return null;
  return raw;
}

/** "j•••@gmail.com": enough for the owner to recognise, not enough for anyone else to learn it. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}•••@${domain ?? ""}`;
}

/** Makes a sign-in code for this address and returns it (to be emailed). The address is not checked for an account. */
export async function createLoginToken(db: Db, email: string, opts: { nextPath?: string | null; ip?: string | null } = {}): Promise<string> {
  const token = randomToken();
  await db.query(
    `insert into public.login_tokens (token_hash, email, next_path, expires_at, ip)
     values ($1, $2, $3, now() + make_interval(mins => $4), $5)`,
    [sha256Hex(token), email, safeNextPath(opts.nextPath), LOGIN_LINK_MINUTES, opts.ip ?? null],
  );
  return token;
}

/** Who a sign-in code is for, without using it up (shown on the "Sign in as j•••@…?" page). Null = unknown, used or expired. */
export async function peekLoginToken(db: Db, token: string): Promise<{ email: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const { rows } = await db.query<{ email: string }>(
    `select email from public.login_tokens where token_hash = $1 and used_at is null and expires_at > now()`,
    [sha256Hex(token)],
  );
  return rows[0] ?? null;
}

async function findOrCreateUser(db: Db, email: string): Promise<User> {
  const cols = `id::text as id, email, display_name, is_admin`;
  const map = (r: { id: string; email: string; display_name: string | null; is_admin: boolean }): User => ({
    id: r.id, email: r.email, displayName: r.display_name, isAdmin: r.is_admin,
  });
  const found = await db.query(`select ${cols} from public.users where lower(email) = $1 and email <> '' order by created_at limit 1`, [email]);
  if (found.rows[0]) return map(found.rows[0]);
  const made = await db.query(`insert into public.users (email) values ($1) on conflict do nothing returning ${cols}`, [email]);
  if (made.rows[0]) return map(made.rows[0]);
  // Two sign-ins for the same new address at the same moment: the other one made the account.
  const again = await db.query(`select ${cols} from public.users where lower(email) = $1 and email <> '' order by created_at limit 1`, [email]);
  return map(again.rows[0]);
}

/** A session for this account. Returns the code that goes in the cookie. */
export async function createSession(db: Db, userId: string, opts: { userAgent?: string | null; ip?: string | null } = {}): Promise<string> {
  const token = randomToken();
  await db.query(
    `insert into public.sessions (id_hash, user_id, expires_at, user_agent, ip)
     values ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [sha256Hex(token), userId, SESSION_DAYS, opts.userAgent?.slice(0, 400) ?? null, opts.ip ?? null],
  );
  return token;
}

/**
 * Proves an email address belongs to the person in front of us: finds or makes their account, ties
 * their existing alert subscriptions to it, and starts a session. Used by sign-in and by sign-up
 * confirmation (both are a click on a link only that inbox received).
 */
export async function signInVerifiedEmail(
  db: Db, email: string, opts: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ user: User; sessionToken: string }> {
  const user = await findOrCreateUser(db, email);
  await db.query(`update public.users set last_sign_in_at = now() where id = $1`, [user.id]);
  // Subscriptions made before the account existed (or copied from the old sites) now belong to it.
  await db.query(
    `update public.alert_subscriptions set user_id = $1 where channel = 'email' and address = $2 and user_id is distinct from $1`,
    [user.id, email],
  );
  return { user, sessionToken: await createSession(db, user.id, opts) };
}

/**
 * Uses a sign-in code. It works once: the first use wins even if two arrive together.
 * Null = unknown, already used, or expired.
 */
export async function consumeLoginToken(
  db: Db, token: string, opts: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ user: User; sessionToken: string; nextPath: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const { rows } = await db.query<{ email: string; next_path: string | null }>(
    `update public.login_tokens set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning email, next_path`,
    [sha256Hex(token)],
  );
  if (!rows[0]) return null;
  const signedIn = await signInVerifiedEmail(db, rows[0].email, opts);
  return { ...signedIn, nextPath: safeNextPath(rows[0].next_path) };
}

/** The signed-in account for a session cookie value, or null. Keeps the session alive while it is used. */
export async function getSessionUser(db: Db, sessionToken: string | null | undefined): Promise<User | null> {
  if (!sessionToken || !/^[A-Za-z0-9_-]{20,100}$/.test(sessionToken)) return null;
  const hash = sha256Hex(sessionToken);
  const { rows } = await db.query(
    `select u.id::text as id, u.email, u.display_name, u.is_admin, s.last_seen_at < now() - interval '1 hour' as stale
       from public.sessions s join public.users u on u.id = s.user_id
      where s.id_hash = $1 and s.expires_at > now()`,
    [hash],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.stale) {
    await db.query(
      `update public.sessions set last_seen_at = now(), expires_at = now() + make_interval(days => $2) where id_hash = $1`,
      [hash, SESSION_DAYS],
    );
  }
  return { id: r.id, email: r.email, displayName: r.display_name, isAdmin: r.is_admin };
}

/** Signs this browser out. */
export async function destroySession(db: Db, sessionToken: string | null | undefined): Promise<void> {
  if (!sessionToken) return;
  await db.query(`delete from public.sessions where id_hash = $1`, [sha256Hex(sessionToken)]);
}

/** Signs every browser of this account out. */
export async function destroyAllSessions(db: Db, userId: string): Promise<void> {
  await db.query(`delete from public.sessions where user_id = $1`, [userId]);
}

/** Removes used and expired sign-in codes and expired sessions. Run by the worker. */
export async function clearExpiredAuth(db: Db): Promise<void> {
  await db.query(`delete from public.login_tokens where expires_at < now() - interval '1 day'`);
  await db.query(`delete from public.sessions where expires_at < now()`);
}
