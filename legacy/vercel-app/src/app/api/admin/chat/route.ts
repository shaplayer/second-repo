import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Reported or hidden messages, for moderators. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data, error } = await supabaseAdmin()
    .from("chat_messages")
    .select("id, user_id, display_name, body, hidden, report_count, created_at")
    .or("report_count.gt.0,hidden.eq.true")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** Hide/restore a message, or turn a person's chat access off/on. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: number; hidden?: boolean; userId?: string; banned?: boolean };
  const admin = supabaseAdmin();
  if (typeof b.id === "number" && typeof b.hidden === "boolean") {
    await admin.from("chat_messages").update({ hidden: b.hidden }).eq("id", b.id);
  }
  if (b.userId && typeof b.banned === "boolean") {
    await admin.from("profiles").update({ chat_banned: b.banned }).eq("id", b.userId);
    if (b.banned) await admin.from("chat_messages").update({ hidden: true }).eq("user_id", b.userId);
  }
  return NextResponse.json({ ok: true });
}
