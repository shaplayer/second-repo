import Stripe from "stripe";
import { supabaseAdmin } from "./supabase/server";

let client: Stripe | null = null;
export function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is missing from .env");
  return (client ??= new Stripe(key));
}

export const TRIAL_DAYS = 7;
export const PRICES = {
  monthly: { env: "STRIPE_PRICE_MONTHLY", label: "$49 / month" },
  yearly: { env: "STRIPE_PRICE_YEARLY", label: "$490 / year" },
} as const;

// Statuses that keep membership on. past_due gets Stripe's retry window before it lapses.
const ACTIVE = new Set(["trialing", "active", "past_due"]);

/**
 * Copy a customer's subscription from Stripe onto their profile. Stripe is the source of truth;
 * this runs from the webhook, after checkout, and when people return from managing billing.
 */
export async function syncCustomer(customerId: string) {
  const subs = await stripe().subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  const best =
    subs.data.find((s) => ACTIVE.has(s.status)) ??
    subs.data.sort((a, b) => b.created - a.created)[0] ??
    null;
  const item = best?.items.data[0];
  const isActive = !!best && ACTIVE.has(best.status);
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null;
  const { error } = await supabaseAdmin()
    .from("profiles")
    .update({
      plan: isActive ? "member" : "free",
      member_until: isActive ? periodEnd : null,
      subscription_status: best?.status ?? null,
      subscription_interval: item?.price.recurring?.interval ?? null,
      cancel_at_period_end: Boolean(best?.cancel_at_period_end),
      ...(subs.data.some((s) => s.trial_start) ? { trial_used: true } : {}),
    })
    .eq("stripe_customer_id", customerId);
  if (error) throw new Error(`Couldn't save membership: ${error.message}`);
  return { status: best?.status ?? null, member: isActive };
}

/** The Stripe customer for a BigStocks account, created on first checkout. */
export async function customerFor(userId: string, email: string) {
  const admin = supabaseAdmin();
  const { data: p } = await admin.from("profiles").select("stripe_customer_id").eq("id", userId).single();
  if (p?.stripe_customer_id) return p.stripe_customer_id as string;
  const customer = await stripe().customers.create({ email, metadata: { user_id: userId } });
  await admin.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", userId);
  return customer.id;
}
