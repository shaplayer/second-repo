import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** The signed-in user's watchlist. Row-level security limits every query to their own rows. */
export async function GET() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ signedIn: false, tickers: [] });
  const { data } = await supabase.from("watchlist").select("ticker").order("added_at");
  return NextResponse.json({ signedIn: true, tickers: (data ?? []).map((r) => r.ticker as string) });
}

/** Add tickers (also used once after sign-in to bring over the list saved in this browser). */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { tickers } = (await req.json().catch(() => ({}))) as { tickers?: string[] };
  const rows = (tickers ?? [])
    .map((t) => String(t).toUpperCase())
    .filter((t) => /^[A-Z.]{1,8}$/.test(t))
    .slice(0, 100)
    .map((ticker) => ({ user_id: auth.user!.id, ticker }));
  if (rows.length) await supabase.from("watchlist").upsert(rows, { onConflict: "user_id,ticker", ignoreDuplicates: true });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const ticker = new URL(req.url).searchParams.get("ticker")?.toUpperCase() ?? "";
  await supabase.from("watchlist").delete().eq("ticker", ticker);
  return NextResponse.json({ ok: true });
}
