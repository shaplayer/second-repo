import { NextResponse } from "next/server";
import { getAccount } from "@/lib/account";
import { PRICES, TRIAL_DAYS, customerFor, stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/** Send a signed-in person to Stripe's checkout page. First-timers get the free trial. */
export async function POST(req: Request) {
  const me = await getAccount();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (me.isMember) return NextResponse.json({ error: "You're already a member." }, { status: 400 });
  const { interval } = (await req.json().catch(() => ({}))) as { interval?: "monthly" | "yearly" };
  const price = process.env[PRICES[interval === "yearly" ? "yearly" : "monthly"].env];
  if (!price) return NextResponse.json({ error: "Memberships aren't set up yet." }, { status: 503 });
  try {
    const customer = await customerFor(me.id, me.email);
    const { data: p } = await supabaseAdmin().from("profiles").select("trial_used").eq("id", me.id).single();
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      subscription_data: p?.trial_used ? undefined : { trial_period_days: TRIAL_DAYS },
      allow_promotion_codes: true,
      success_url: `${APP_URL}/account?checkout=done`,
      cancel_url: `${APP_URL}/membership`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
