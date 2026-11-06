import { NextResponse } from "next/server";
import { getFeed } from "@/lib/feeds";
import type { FeedKind } from "@/lib/feeds/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const k = sp.get("kind");
  const kind: FeedKind | "all" = k === "press" || k === "filing" ? k : "all";
  const res = await getFeed({
    kind,
    ticker: sp.get("ticker"),
    limit: Number(sp.get("limit") ?? 8),
    before: sp.get("before"),
    forms: sp.get("forms")?.split(",") ?? null,
    q: sp.get("q"),
  });
  return NextResponse.json(res, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
