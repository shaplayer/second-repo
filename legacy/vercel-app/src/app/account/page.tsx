import Link from "next/link";
import { redirect } from "next/navigation";
import BillingActions from "@/components/BillingActions";
import SignOutButton from "@/components/SignOutButton";
import { getAccount } from "@/lib/account";
import { subscriberByEmail } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account · BigStocks" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const me = await getAccount();
  if (!me) redirect("/signin?next=/account");
  const sub = await subscriberByEmail(me.email).catch(() => null);
  return (
    <div style={{ maxWidth: 620, margin: "32px auto 56px", display: "grid", gap: 20 }}>
      <h1 style={{ fontSize: 32, fontWeight: 900 }}>Your account</h1>
      <section className="panel">
        <div className="rows">
          <div className="kv">
            <span className="label">Email</span>
            <span>{me.email}</span>
          </div>
          <div className="kv">
            <span className="label">Plan</span>
            <span>
              {me.isMember ? (
                <>
                  <strong>Member</strong>
                  {me.subscriptionStatus === "trialing" && " · free trial"}
                  {me.memberUntil &&
                    ` · ${me.subscriptionStatus === "trialing" ? "first charge" : me.cancelAtPeriodEnd ? "ends" : me.hasBilling ? "renews" : "until"} ${new Date(me.memberUntil).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
                  {me.subscriptionStatus === "past_due" && <span className="dn"> · payment failed, update your card</span>}
                </>
              ) : (
                <>
                  <strong>Free</strong> · News, filings, scores, alerts and free picks
                </>
              )}
            </span>
            {!me.isMember && (
              <Link href="/membership" className="small">
                Become a member: every pick, plus Level 2 when it launches. 7-day free trial.
              </Link>
            )}
            <span style={{ marginTop: 6 }}>
              <BillingActions syncNow={checkout === "done"} hasBilling={me.hasBilling} />
            </span>
          </div>
          <div className="kv">
            <span className="label">Email alerts</span>
            {sub ? (
              <span>
                {sub.tickers.length ? sub.tickers.join(", ") : "No stocks yet"} ·{" "}
                <Link href={`/alerts/manage?token=${sub.token}`}>Alert settings</Link>
              </span>
            ) : (
              <span className="muted">None yet. Open any stock and press “Get alerts.”</span>
            )}
          </div>
        </div>
      </section>
      <div>
        <SignOutButton />
      </div>
    </div>
  );
}
