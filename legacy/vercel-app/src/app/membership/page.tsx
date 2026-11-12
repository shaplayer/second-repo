import Link from "next/link";
import MembershipButtons from "@/components/MembershipButtons";
import { getAccount } from "@/lib/account";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Membership · BigStocks" };

export default async function Membership() {
  const me = await getAccount().catch(() => null);
  let trial = true;
  if (me) {
    const { data } = await supabaseAdmin().from("profiles").select("trial_used").eq("id", me.id).single();
    trial = !data?.trial_used;
  }
  return (
    <div style={{ maxWidth: 560, margin: "40px auto 56px", display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">BigStocks membership</span>
        <h1 style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 900 }}>Every pick. Level 2 when it launches.</h1>
      </div>
      <section className="panel">
        <div className="modal-body">
          <ul className="perks">
            <li>
              <strong>Members-only picks</strong> from our in-house investors, with their full track record
            </li>
            <li>
              <strong>Real-time Level 2</strong> and historical time &amp; sales, in plain English <span className="soon">SOON</span>
            </li>
            <li>Everything free stays free: news, filings, scores, alerts and chat</li>
          </ul>
          {me?.isMember ? (
            <div style={{ display: "grid", gap: 8 }}>
              <strong className="up">You’re a member.</strong>
              <Link href="/account" className="btn">
                Your account
              </Link>
            </div>
          ) : (
            <MembershipButtons signedIn={!!me} trial={trial} />
          )}
        </div>
      </section>
      <p className="disc" style={{ margin: 0 }}>
        Payments are handled by Stripe; BigStocks never sees your card number. Picks are not personal investment advice.
      </p>
    </div>
  );
}
