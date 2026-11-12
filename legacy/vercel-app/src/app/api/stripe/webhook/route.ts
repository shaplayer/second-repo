import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, syncCustomer } from "@/lib/stripe";

/** Stripe tells us here when a subscription starts, renews, fails or is canceled. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }
  const obj = event.data.object as { customer?: string | { id: string } | null };
  const customer = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
  if (customer && (event.type.startsWith("customer.subscription.") || event.type === "checkout.session.completed" || event.type.startsWith("invoice."))) {
    await syncCustomer(customer);
  }
  return NextResponse.json({ received: true });
}
