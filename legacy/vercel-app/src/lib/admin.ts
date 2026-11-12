import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// One shared password for the team's admin page (ADMIN_PASSWORD in .env).
// Replaced by real staff accounts when sign-in arrives in phase 3.
export const ADMIN_COOKIE = "bs_admin";

const digest = (s: string) => createHash("sha256").update("bigstocks-admin:" + s).digest("hex");

export function passwordMatches(input: string) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  const a = Buffer.from(digest(input));
  const b = Buffer.from(digest(pw));
  return timingSafeEqual(a, b);
}

export const sessionValue = () => digest(process.env.ADMIN_PASSWORD ?? "");

export async function isAdmin() {
  if (!process.env.ADMIN_PASSWORD) return false;
  return (await cookies()).get(ADMIN_COOKIE)?.value === sessionValue();
}
