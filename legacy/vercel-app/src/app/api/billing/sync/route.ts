import { NextResponse } from "next/server";
import { getAccount } from "@/lib/account";
import { syncCustomer } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Refresh the signed-in person's membership from Stripe (after checkout or managing billing). */
export async function POST() {
  const me = await getAccount();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: p } = await supabaseAdmin().from("profiles").select("stripe_customer_id").eq("id", me.id).single();
  if (!p?.stripe_customer_id) return NextResponse.json({ member: false });
  return NextResponse.json(await syncCustomer(p.stripe_customer_id));
}
