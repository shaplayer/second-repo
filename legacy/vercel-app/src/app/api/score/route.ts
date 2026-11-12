import { NextResponse } from "next/server";
import { fundamentals } from "@/lib/fundamentals";
import { lookup } from "@/lib/sec";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "";
  const co = await lookup(symbol);
  if (!co) return NextResponse.json({ verdict: null });
  const f = await fundamentals(co.cik);
  return NextResponse.json({ verdict: f.score?.verdict ?? null });
}
