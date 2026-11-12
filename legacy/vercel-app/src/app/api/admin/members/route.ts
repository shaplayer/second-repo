import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Members, newest first. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select("email, plan, member_until, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** Make someone a member (until a date, or with no end), or switch them back to free. Until payments arrive, this is done by hand. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { email, plan, until } = (await req.json().catch(() => ({}))) as { email?: string; plan?: "free" | "member"; until?: string };
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return NextResponse.json({ error: "Enter the person's email." }, { status: 400 });
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .update({ plan: plan === "member" ? "member" : "free", member_until: plan === "member" && until ? new Date(until).toISOString() : null })
    .eq("email", addr)
    .select("email");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: `${addr} doesn't have an account yet. Ask them to sign in once first.` }, { status: 404 });
  return NextResponse.json({ ok: true });
}
