import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/accounts";
import { db } from "@/lib/db";
import { clearSessionCookie, sameOrigin } from "@/lib/web/request";

export async function POST(req: Request) {
  if (sameOrigin(req)) {
    await destroySession(db(), (await cookies()).get(SESSION_COOKIE)?.value).catch(() => {});
    await clearSessionCookie();
  }
  return NextResponse.redirect(new URL("/", req.url), 303);
}
