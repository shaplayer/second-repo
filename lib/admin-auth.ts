import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Admin sign-in for /admin (sending alerts). One shared password: ADMIN_PASSWORD (12+ characters).
 * The cookie holds an HMAC of the password, so changing ADMIN_PASSWORD signs everyone out.
 */
export const ADMIN_COOKIE = "bs_admin";
const MAX_AGE = 12 * 3600; // seconds

const password = () => process.env.ADMIN_PASSWORD ?? "";
export const adminConfigured = () => password().length >= 12;

function sign(issued: number) {
  return createHmac("sha256", password()).update(`bigstocks-admin:${issued}`).digest("hex");
}

export function adminCookieValue(): string {
  const issued = Math.floor(Date.now() / 1000);
  return `${issued}.${sign(issued)}`;
}

export function passwordOk(input: string): boolean {
  if (!adminConfigured()) return false;
  const a = Buffer.from(String(input));
  const b = Buffer.from(password());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const v = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  const [issuedRaw, mac] = v.split(".");
  const issued = Number(issuedRaw);
  if (!issued || !mac || Date.now() / 1000 - issued > MAX_AGE) return false;
  const want = Buffer.from(sign(issued));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const adminCookieOptions = {
  httpOnly: true, sameSite: "strict" as const, path: "/",
  secure: process.env.NODE_ENV === "production", maxAge: MAX_AGE,
};
