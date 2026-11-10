import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminConfigured, adminCookieOptions, adminCookieValue, passwordOk } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Slow down password guessing (per server process).
const tries = new Map<string, number[]>();

export async function POST(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: "Set ADMIN_PASSWORD (12+ characters) on the server first." }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const recent = (tries.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
  if (recent.length >= 8) return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!passwordOk(password ?? "")) {
    recent.push(now);
    tries.set(ip, recent);
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }
  tries.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminCookieValue(), adminCookieOptions);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions, maxAge: 0 });
  return res;
}
