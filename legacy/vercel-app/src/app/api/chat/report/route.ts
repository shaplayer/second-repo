import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

const HIDE_AFTER = 3;

/** Report a message. After 3 different people report it, it's hidden until a moderator reviews it. */
export async function POST(req: Request) {
  const { data: auth } = await (await supabaseServer()).auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in to report messages." }, { status: 401 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: number };
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Unknown message." }, { status: 400 });
  const admin = supabaseAdmin();
  const { error } = await admin.from("chat_reports").insert({ message_id: id, reporter_id: auth.user.id });
  if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
  const { count } = await admin.from("chat_reports").select("*", { count: "exact", head: true }).eq("message_id", id);
  await admin.from("chat_messages").update({ report_count: count ?? 0, ...((count ?? 0) >= HIDE_AFTER ? { hidden: true } : {}) }).eq("id", id);
  return NextResponse.json({ ok: true });
}
