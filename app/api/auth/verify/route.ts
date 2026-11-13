import { NextResponse } from "next/server";
import { consumeLoginToken } from "@/lib/auth/accounts";
import { db } from "@/lib/db";
import { clientIp, sameOrigin, setSessionCookie, userAgent } from "@/lib/web/request";

/**
 * The "Sign in" button on the page a sign-in link opens. A POST, so mail scanners that open every
 * link cannot use the link up before the person does. The code works once.
 */
export async function POST(req: Request) {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  if (!sameOrigin(req)) return to("/sign-in?problem=expired");
  const form = await req.formData().catch(() => null);
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  const done = await consumeLoginToken(db(), String(form?.get("token") ?? ""), { ip, userAgent: ua });
  if (!done) return to("/sign-in?problem=expired");
  await setSessionCookie(done.sessionToken);
  return to(done.nextPath ?? "/my-stocks");
}
