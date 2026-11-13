/**
 * Remembers, in this browser only, the sign-up that is waiting for its confirmation click, so the
 * "check your inbox" page can re-send the email and add more stocks to the same confirmation.
 * The value is signed by the server and scripts cannot read it.
 */
import { cookies } from "next/headers";
import { sign, verify } from "../auth/secret";

const NAME = "bs_signup";
const TWO_DAYS = 2 * 86_400_000;

export type PendingSignup = { email: string; batch: string; confirmToken: string };

export async function rememberSignup(p: PendingSignup): Promise<void> {
  (await cookies()).set(NAME, sign(JSON.stringify(p), "pending-signup", TWO_DAYS), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TWO_DAYS / 1000,
  });
}

export async function pendingSignup(): Promise<PendingSignup | null> {
  const raw = verify((await cookies()).get(NAME)?.value, "pending-signup");
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PendingSignup;
    return p.email && p.batch && p.confirmToken ? p : null;
  } catch {
    return null;
  }
}

export async function forgetSignup(): Promise<void> {
  (await cookies()).delete(NAME);
}
