import { NextResponse } from "next/server";
import { validName } from "@/lib/chat";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

/** Choose the public chat name. */
export async function POST(req: Request) {
  const { data: auth } = await (await supabaseServer()).auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  const n = (name ?? "").trim();
  if (!validName(n)) return NextResponse.json({ error: "Use 3–20 letters, numbers or underscores." }, { status: 400 });
  const { error } = await supabaseAdmin().from("profiles").update({ display_name: n }).eq("id", auth.user.id);
  if (error) {
    const taken = error.code === "23505";
    return NextResponse.json({ error: taken ? `“${n}” is taken. Try another.` : error.message }, { status: taken ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, name: n });
}
