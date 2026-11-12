import ManageAlerts from "@/components/ManageAlerts";
import { subscriberByToken } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Manage({ searchParams }: { searchParams: Promise<{ token?: string; unsubscribe?: string }> }) {
  const { token = "", unsubscribe } = await searchParams;
  const sub = await subscriberByToken(token);
  return (
    <div style={{ maxWidth: 560, margin: "32px auto 56px" }}>
      {sub ? (
        <ManageAlerts token={token} email={sub.email} tickers={sub.tickers} prefs={sub.prefs} askUnsubscribe={unsubscribe === "1"} />
      ) : (
        <section className="panel">
          <div className="coming">
            <span className="label">No alerts</span>
            <h2>You’re not signed up for alerts</h2>
            <p className="muted" style={{ margin: 0 }}>
              If you just unsubscribed, you won’t get any more emails from us.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
