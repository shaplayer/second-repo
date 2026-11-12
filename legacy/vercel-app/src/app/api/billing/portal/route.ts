import { NextResponse } from "next/server";
import { getAccount } from "@/lib/account";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/** Stripe's own page for changing card, switching plans, viewing receipts or canceling. */
export async function POST() {
  const me = await getAccount();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: p } = await supabaseAdmin().from("profiles").select("stripe_customer_id").eq("id", me.id).single();
  if (!p?.stripe_customer_id) return NextResponse.json({ error: "No billing yet." }, { status: 400 });
  const session = await stripe().billingPortal.sessions.create({ customer: p.stripe_customer_id, return_url: `${APP_URL}/account?checkout=done` });
  return NextResponse.json({ url: session.url });
}
