// One-time Stripe setup: creates the membership product, the $49/month and $490/year prices,
// and the self-service billing page, then writes the price IDs into .env. Safe to run again.
// Run with: node scripts/stripe-setup.mjs
import { readFileSync, writeFileSync } from "fs";
import Stripe from "stripe";

const envPath = new URL("../.env", import.meta.url);
let env = readFileSync(envPath, "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const set = (k, v) => {
  env = new RegExp(`^${k}=`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : env + `\n${k}=${v}\n`;
};

const key = get("STRIPE_SECRET_KEY");
if (!key) throw new Error("Paste your Stripe secret key into .env first (STRIPE_SECRET_KEY=).");
const stripe = new Stripe(key);
console.log(key.includes("_test_") ? "Using Stripe TEST mode." : "WARNING: using a LIVE Stripe key. Real money.");

const PLANS = [
  { lookup: "bigstocks_member_monthly", amount: 4900, interval: "month", env: "STRIPE_PRICE_MONTHLY" },
  { lookup: "bigstocks_member_yearly", amount: 49000, interval: "year", env: "STRIPE_PRICE_YEARLY" },
];

const existing = await stripe.prices.list({ lookup_keys: PLANS.map((p) => p.lookup), expand: ["data.product"], limit: 10 });
let productId = existing.data[0] ? (typeof existing.data[0].product === "string" ? existing.data[0].product : existing.data[0].product.id) : null;
if (!productId) {
  const product = await stripe.products.create({
    name: "BigStocks Membership",
    description: "Members-only stock picks, plus real-time Level 2 when it launches.",
  });
  productId = product.id;
  console.log("Created product", product.id);
}

for (const plan of PLANS) {
  let price = existing.data.find((p) => p.lookup_key === plan.lookup);
  if (!price) {
    price = await stripe.prices.create({
      product: productId,
      currency: "usd",
      unit_amount: plan.amount,
      recurring: { interval: plan.interval },
      lookup_key: plan.lookup,
    });
    console.log(`Created $${plan.amount / 100}/${plan.interval} price`, price.id);
  } else {
    console.log(`Found $${plan.amount / 100}/${plan.interval} price`, price.id);
  }
  set(plan.env, price.id);
}

// The page where members change card, switch monthly/yearly, see receipts, or cancel.
const prices = PLANS.map((p) => get(p.env));
const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
const portal = {
  business_profile: { headline: "Manage your BigStocks membership" },
  features: {
    customer_update: { enabled: true, allowed_updates: ["email"] },
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "unused", "other"] } },
    subscription_update: { enabled: true, default_allowed_updates: ["price"], products: [{ product: productId, prices }], proration_behavior: "create_prorations" },
  },
};
if (configs.data[0]) await stripe.billingPortal.configurations.update(configs.data[0].id, portal);
else await stripe.billingPortal.configurations.create(portal);
console.log("Billing page set up.");

writeFileSync(envPath, env);
console.log("Saved price IDs to .env. Done.");
