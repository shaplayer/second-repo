import { NextResponse, after } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { hasDb } from "@/lib/db";
import { audienceCounts, createAlert, processBroadcasts, recentBroadcasts, type Channel, type Tier } from "@/lib/broadcast";
import { dispatchFollowNotifications } from "@/lib/follow/notify";

export const dynamic = "force-dynamic";

/** Recent sends (with progress) and how many people each list reaches. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const [audience, broadcasts] = await Promise.all([audienceCounts(), recentBroadcasts()]);
  return NextResponse.json({ audience, broadcasts });
}

/** Log an alert on the track record (timestamped now) and send it. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as {
    ticker?: string; price?: number | string; tier?: Tier; message?: string;
    sponsored?: boolean; sponsorComp?: string; channels?: Channel[];
  } | null;
  if (!b) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const r = await createAlert({
      ticker: String(b.ticker ?? ""), price: Number(b.price), tier: b.tier === "premium" ? "premium" : "free",
      message: b.message, sponsored: b.sponsored === true, sponsorComp: b.sponsorComp, channels: b.channels ?? [],
    });
    // Start sending right after responding. The ingest worker resumes anything interrupted.
    after(() => processBroadcasts().catch((e) => console.error("[broadcast]", e?.message)));
    // People following this ticker with the bell hear about free alerts too.
    after(() => dispatchFollowNotifications().catch((e) => console.error("[follow]", e?.message)));
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
