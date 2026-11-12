import { NextResponse } from "next/server";
import { hasLink, mentionedTickers } from "@/lib/chat";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

const FIELDS = "id, display_name, body, tickers, created_at";

/** Latest messages (all, or one stock's), plus who's reading so the box knows whether they can post. */
export async function GET(req: Request) {
  const ticker = new URL(req.url).searchParams.get("ticker")?.toUpperCase();
  const supabase = await supabaseServer();
  let q = supabase.from("chat_messages").select(FIELDS).order("created_at", { ascending: false }).limit(60);
  if (ticker) q = q.contains("tickers", [ticker]);
  const [{ data: messages, error }, { data: auth }] = await Promise.all([q, supabase.auth.getUser()]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let me = null;
  if (auth.user) {
    const { data: p } = await supabase.from("profiles").select("display_name, chat_banned").eq("id", auth.user.id).maybeSingle();
    me = { name: (p?.display_name as string | null) ?? null, banned: Boolean(p?.chat_banned) };
  }
  return NextResponse.json({ messages: (messages ?? []).reverse(), me });
}

/** Post a message. The server checks limits and finds the $TICKERS so nobody can fake them. */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in to chat." }, { status: 401 });
  const { body: raw } = (await req.json().catch(() => ({}))) as { body?: string };
  const body = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!body) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (body.length > 500) return NextResponse.json({ error: "Keep messages under 500 characters." }, { status: 400 });
  if (hasLink(body)) return NextResponse.json({ error: "Links aren’t allowed in chat. Mention a stock like $AAPL instead." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: p } = await admin.from("profiles").select("display_name, chat_banned").eq("id", auth.user.id).single();
  if (p?.chat_banned) return NextResponse.json({ error: "Your chat access has been turned off by a moderator." }, { status: 403 });
  if (!p?.display_name) return NextResponse.json({ error: "Pick a chat name first." }, { status: 400 });

  // Speed limit: 1 message every 5 seconds, 20 per 10 minutes.
  const { data: recent } = await admin
    .from("chat_messages")
    .select("created_at")
    .eq("user_id", auth.user.id)
    .gte("created_at", new Date(Date.now() - 600_000).toISOString())
    .order("created_at", { ascending: false });
  if (recent?.[0] && Date.now() - Date.parse(recent[0].created_at) < 5000) return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  if ((recent?.length ?? 0) >= 20) return NextResponse.json({ error: "You’ve hit the limit of 20 messages in 10 minutes." }, { status: 429 });

  const tickers = await mentionedTickers(body);
  const { error } = await admin.from("chat_messages").insert({ user_id: auth.user.id, display_name: p.display_name, body, tickers });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tickers });
}
