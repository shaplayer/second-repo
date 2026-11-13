/** Small helpers shared by pages and API routes: who is signed in, where a request came from. */
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getSessionUser, SESSION_COOKIE, SESSION_DAYS, type User } from "../auth/accounts";
import { siteUrl } from "../config";
import { db, hasDb } from "../db";

/** The signed-in person for this request, or null. Looked up once per request. */
export const currentUser = cache(async (): Promise<User | null> => {
  if (!hasDb()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await getSessionUser(db(), token);
  } catch {
    return null; // the database is unreachable: treat as signed out rather than break the page
  }
});

/** The visitor's address as the proxy in front of us reports it (Nginx sets X-Forwarded-For). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || null;
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

/** Sets the session cookie: not readable by scripts, sent only to this site, HTTPS-only in production. */
export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * A request that changes something must come from our own pages. Browsers send Origin on POSTs;
 * anything from another site is refused. (Mail apps' one-click unsubscribe POSTs carry no Origin and
 * are handled by their own route, which does not use this.)
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const o = new URL(origin);
    const allowed = [new URL(siteUrl()).host, req.headers.get("host"), req.headers.get("x-forwarded-host")];
    return allowed.includes(o.host);
  } catch {
    return false;
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** The body of a JSON POST as an object, or {} when it is not one. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
