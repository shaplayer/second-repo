/** Random codes, hashes and signatures used by sign-in, sign-up confirmation and unsubscribe links. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A random code for a link or a cookie: 32 bytes, URL-safe (43 characters). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** What is stored instead of a sign-in code or session cookie, so the database alone cannot be used to sign in. */
export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * The site's own secret, used to sign small values we hand to the browser (never to store anything).
 * Set APP_SECRET on the server to 32 or more random characters. There is no built-in production default.
 */
export function appSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.APP_SECRET?.trim();
  if (secret && secret.length >= 32) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error("APP_SECRET is not set (or is shorter than 32 characters). Generate one with: openssl rand -base64 48");
  }
  return "dev-only-secret-not-for-production-0123456789";
}

const mac = (payload: string, purpose: string) => createHmac("sha256", appSecret()).update(`${purpose}\n${payload}`).digest("base64url");

/**
 * Signs a small value for one purpose, good until `expires` (ms since 1970). The result is
 * "<payload>.<expiry>.<signature>" in URL-safe characters.
 */
export function sign(value: string, purpose: string, ttlMs: number, now = Date.now()): string {
  const payload = `${Buffer.from(value, "utf8").toString("base64url")}.${now + ttlMs}`;
  return `${payload}.${mac(payload, purpose)}`;
}

/** The signed value, or null when the signature is wrong, made for another purpose, or expired. */
export function verify(signed: string | null | undefined, purpose: string, now = Date.now()): string | null {
  if (!signed) return null;
  const parts = signed.split(".");
  if (parts.length !== 3) return null;
  const [body, expiry, signature] = parts;
  const expected = mac(`${body}.${expiry}`, purpose);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^\d+$/.test(expiry) || Number(expiry) < now) return null;
  try {
    return Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
