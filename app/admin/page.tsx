import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PickForm } from "@/components/admin/PickForm";
import { Shell } from "@/components/site/Shell";
import { postalAddress, smsEnabled } from "@/lib/config";
import { listPicks, sponsorLine } from "@/lib/data/picks";
import { db } from "@/lib/db";
import { emailProvider } from "@/lib/email";
import { dateET, exactET } from "@/lib/time";
import { currentUser } from "@/lib/web/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff", robots: { index: false } };

const card = "card flex flex-col gap-3 p-5 md:p-6";

/** Staff only (users.is_admin): post a pick, see inquiries, see that the worker is healthy. */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?next=/admin");
  if (!user.isAdmin) notFound();
  const pool = db();
  const q = async <T,>(sql: string): Promise<T[]> => (await pool.query(sql).catch(() => ({ rows: [] }))).rows as T[];
  const [counts] = await q<Record<string, string>>(
    `select (select count(*) from public.alert_subscriptions where channel = 'email' and status = 'active' and cik is null and 'picks' = any(categories)) as picks,
            (select count(distinct address) from public.alert_subscriptions where channel = 'email' and status = 'active') as people,
            (select count(*) from public.alert_subscriptions where channel = 'email' and status = 'pending') as pending,
            (select count(*) from public.alert_events where status = 'queued') as queued,
            (select count(*) from public.alert_events where status = 'sent' and sent_at > now() - interval '24 hours') as sent,
            (select count(*) from public.alert_events where status = 'failed' and created_at > now() - interval '24 hours') as failed,
            (select count(*) from public.summaries where kind = 'ai' and created_at > now() - interval '24 hours') as summaries`,
  );
  const jobs = await q<{ job: string; last_success_at: Date | null; last_error: string | null; last_error_at: Date | null }>(
    `select job, last_success_at, last_error, last_error_at from public.job_state where job not like '%:last' order by job`,
  );
  const inquiries = await q<{ id: string; name: string; company: string; ticker: string | null; email: string; phone: string | null; package: string | null; message: string | null; created_at: Date }>(
    `select id::text as id, name, company, ticker, email, phone, package, message, created_at from public.inquiries where imported_from is null order by created_at desc limit 20`,
  );
  const picks = await listPicks(pool, { limit: 8 }).catch(() => []);
  const problems = [
    !postalAddress() && "COMPANY_POSTAL_ADDRESS is not set: alert emails are held back until it is.",
    emailProvider().name === "console" && "EMAIL_PROVIDER is “console”: emails are printed to the log, not sent.",
    !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY is not set: no AI summaries are written.",
    jobs.length === 0 && "The worker has not reported yet. Is it running? (pm2 status)",
  ].filter(Boolean) as string[];
  const n = (k: string) => Number(counts?.[k] ?? 0).toLocaleString("en-US");

  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-4 pb-14 pt-8 md:px-8">
        <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">Staff</h1>
        {problems.length > 0 && (
          <ul role="alert" className="m-0 flex list-disc flex-col gap-1 rounded-2xl bg-amber-bg py-4 pl-9 pr-5 text-sm text-amber">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <section className={card}>
          <h2 className="m-0 text-xl font-extrabold">At a glance</h2>
          <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[["On the pick list", n("picks")], ["People with alerts on", n("people")], ["Waiting to confirm", n("pending")], ["Emails waiting", n("queued")],
              ["Emails sent, 24 h", n("sent")], ["Emails failed, 24 h", n("failed")], ["AI summaries, 24 h", n("summaries")], ["Text alerts", smsEnabled() ? "On" : "Off"]].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-inset p-3"><dt className="text-xs text-muted">{k}</dt><dd className="num m-0 text-xl font-extrabold">{v}</dd></div>
            ))}
          </dl>
        </section>

        <section className={card}>
          <h2 className="m-0 text-xl font-extrabold">Post a pick</h2>
          <PickForm listSize={Number(counts?.picks ?? 0)} />
        </section>

        <section className={card}>
          <h2 className="m-0 text-xl font-extrabold">Recent picks</h2>
          {picks.length === 0 && <p className="m-0 text-sm text-muted">None yet.</p>}
          {picks.map((p) => (
            <div key={p.id} className="flex flex-wrap items-baseline gap-x-3 border-t border-line-soft pt-2 text-sm">
              <span className="num w-[92px] text-muted">{dateET(p.postedAt)}</span><strong className="w-16">${p.ticker}</strong>
              <span className="min-w-0 flex-1">{p.title}{sponsorLine(p) && <span className="block font-bold text-amber">{sponsorLine(p)}</span>}</span>
            </div>
          ))}
        </section>

        <section className={card}>
          <h2 className="m-0 text-xl font-extrabold">Sponsor inquiries</h2>
          {inquiries.length === 0 && <p className="m-0 text-sm text-muted">None yet.</p>}
          {inquiries.map((i) => (
            <div key={i.id} className="flex flex-col gap-0.5 border-t border-line-soft pt-2 text-sm">
              <span><strong>{i.name}</strong>, {i.company}{i.ticker ? ` ($${i.ticker})` : ""} · {i.package ?? "no package chosen"} · {dateET(new Date(i.created_at).toISOString())}</span>
              <span className="text-ink-2"><a href={`mailto:${i.email}`}>{i.email}</a>{i.phone ? ` · ${i.phone}` : ""}</span>
              {i.message && <span className="whitespace-pre-line text-ink-2">{i.message}</span>}
            </div>
          ))}
        </section>

        <section className={card}>
          <h2 className="m-0 text-xl font-extrabold">Worker</h2>
          {jobs.map((j) => {
            const failing = j.last_error_at && (!j.last_success_at || j.last_error_at > j.last_success_at);
            return (
              <div key={j.job} className="flex flex-wrap items-baseline gap-x-3 border-t border-line-soft pt-2 text-sm">
                <strong className="w-28">{j.job}</strong>
                <span className={failing ? "font-bold text-bad" : "text-good"}>{failing ? "Failing" : "Working"}</span>
                <span className="text-muted">last worked {j.last_success_at ? exactET(new Date(j.last_success_at).toISOString()) : "never"}</span>
                {failing && <span className="w-full text-bad">{j.last_error}</span>}
              </div>
            );
          })}
        </section>
      </div>
    </Shell>
  );
}
