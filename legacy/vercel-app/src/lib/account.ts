import { supabaseServer } from "./supabase/server";

export type Account = {
  id: string;
  email: string;
  displayName: string | null;
  plan: "free" | "member";
  isMember: boolean;
  memberUntil: string | null;
  l2TrialEndsAt: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  hasBilling: boolean;
};

/** The signed-in visitor, or null. Membership counts while member_until is in the future (or unset for a member). */
export async function getAccount(): Promise<Account | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const plan = (p?.plan ?? "free") as Account["plan"];
  const memberUntil = (p?.member_until as string | null) ?? null;
  return {
    id: user.id,
    email: user.email ?? p?.email ?? "",
    displayName: p?.display_name ?? null,
    plan,
    isMember: plan === "member" && (!memberUntil || memberUntil > new Date().toISOString()),
    memberUntil,
    l2TrialEndsAt: p?.l2_trial_ends_at ?? null,
    subscriptionStatus: p?.subscription_status ?? null,
    cancelAtPeriodEnd: Boolean(p?.cancel_at_period_end),
    hasBilling: Boolean(p?.stripe_customer_id),
  };
}
