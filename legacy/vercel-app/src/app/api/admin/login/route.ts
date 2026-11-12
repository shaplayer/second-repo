import { NextResponse } from "next/server";
import { ADMIN_COOKIE, passwordMatches, sessionValue } from "@/lib/admin";

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !passwordMatches(password)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, sessionValue(), { httpOnly: true, sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 14 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
