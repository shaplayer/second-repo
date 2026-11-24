import { postalAddress, smsEnabled } from "@/lib/config";
import { db } from "@/lib/db";
import { emailProvider } from "@/lib/email";
import { dateET } from "@/lib/time";
import { adminQuery, requireAdmin } from "./shared";

type Counts = { picks: string; people: string; pending: string; queued: string; sent: string; failed: string; summaries: string };
type Inquiry = { id: string; name: string; company: string; ticker: string | null; email: string; phone: string | null; package: string | null; message: string | null; created_at: Date };

export default async function AdminPage() {
  await requireAdmin("/admin");
  const pool = db();
  const [countsRows, jobs, inquiries] = await Promise.all([
    adminQuery<Counts>(pool, "counts", `select (select count(*) from public.alert_subscriptions where channel = 'email' and status = 'active' and cik is null and 'picks' = any(categories)) as picks,
            (select count(distinct address) from public.alert_subscriptions where channel = 'email' and status = 'active') as people,
            (select count(*) from public.alert_subscriptions where channel = 'email' and status = 'pending') as pending,
            (select count(*) from public.alert_events where status = 'queued') as queued,
            (select count(*) from public.alert_events where status = 'sent' and sent_at > now() - interval '24 hours') as sent,
            (select count(*) from public.alert_events where status = 'failed' and created_at > now() - interval '24 hours') as failed,
            (select count(*) from public.summaries where kind = 'ai' and created_at > now() - interval '24 hours') as summaries`),
    adminQuery<{ job: string }>(pool, "worker status", "select job from public.job_state where job not like '%:last' limit 1"),
    adminQuery<Inquiry>(pool, "inquiries", `select id::text as id, name, company, ticker, email, phone, package, message, created_at from public.inquiries where imported_from is null order by created_at desc limit 20`),
  ]);
  const counts = countsRows?.[0];
  const problems = [
    !postalAddress() && "COMPANY_POSTAL_ADDRESS is not set: alert emails are held back until it is.",
    emailProvider().name === "console" && "EMAIL_PROVIDER is “console”: emails are printed to the log, not sent.",
    !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY is not set: no AI summaries are written.",
    jobs?.length === 0 && "The worker has not reported yet. Is it running? (pm2 status)",
  ].filter((problem): problem is string => Boolean(problem));
  const n = (value: string) => Number(value).toLocaleString("en-US");

  return (
    <>
      {problems.length > 0 && (
        <ul role="alert" className="m-0 flex list-disc flex-col gap-1 rounded-2xl bg-amber-bg py-4 pl-9 pr-5 text-sm text-amber">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {!jobs && <p role="alert" className="m-0 text-sm text-bad">Could not load worker status. Try again.</p>}
      <section className="card flex flex-col gap-3 p-5 md:p-6">
        <h2 className="m-0 text-xl font-extrabold">At a glance</h2>
        {!counts ? <p role="alert" className="m-0 text-sm text-bad">Could not load counts. Try again.</p> : (
          <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[["On the pick list", n(counts.picks)], ["People with alerts on", n(counts.people)], ["Waiting to confirm", n(counts.pending)], ["Emails waiting", n(counts.queued)],
              ["Emails sent, 24 h", n(counts.sent)], ["Emails failed, 24 h", n(counts.failed)], ["AI summaries, 24 h", n(counts.summaries)], ["Text alerts", smsEnabled() ? "On" : "Off"]].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-inset p-3"><dt className="text-xs text-muted">{k}</dt><dd className="num m-0 text-xl font-extrabold">{v}</dd></div>
            ))}
          </dl>
        )}
      </section>
      <section className="card flex flex-col gap-3 p-5 md:p-6">
        <h2 className="m-0 text-xl font-extrabold">Sponsor inquiries</h2>
        {!inquiries ? <p role="alert" className="m-0 text-sm text-bad">Could not load inquiries. Try again.</p> : inquiries.length === 0 && <p className="m-0 text-sm text-muted">None yet.</p>}
        {inquiries?.map((i) => (
          <div key={i.id} className="flex flex-col gap-0.5 border-t border-line-soft pt-2 text-sm">
            <span><strong>{i.name}</strong>, {i.company}{i.ticker ? ` ($${i.ticker})` : ""} · {i.package ?? "no package chosen"} · {dateET(new Date(i.created_at).toISOString())}</span>
            <span className="text-ink-2"><a href={`mailto:${i.email}`}>{i.email}</a>{i.phone ? ` · ${i.phone}` : ""}</span>
            {i.message && <span className="whitespace-pre-line text-ink-2">{i.message}</span>}
          </div>
        ))}
      </section>
    </>
  );
}
