"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminSection } from "@/components/admin/AdminSection";
import { SkeletonBlock } from "@/components/admin/AdminSkeleton";
import { adminOptions } from "@/lib/admin-query";
import { dateET } from "@/lib/time";

export default function AdminPage() {
  const config = useQuery({ ...adminOptions("config"), enabled: false });
  const n = (value: string) => Number(value).toLocaleString("en-US");
  return (
    <>
      <AdminSection title="Configuration" section="config">{(data) => data.problems.length
        ? <ul role="alert" className="m-0 flex list-disc flex-col gap-1 rounded-2xl bg-amber-bg py-4 pl-9 pr-5 text-sm text-amber">
          {data.problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul> : <p className="m-0 text-sm text-muted">No configuration warnings.</p>}
      </AdminSection>
      <AdminSection title="Worker status" section="jobs">{(data) => <p className="m-0 text-sm text-muted">
        {data.length ? "The worker has reported." : "The worker has not reported yet. Is it running? (pm2 status)"}
      </p>}</AdminSection>
      <AdminSection title="At a glance" section="counts">{(data) => (
          <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-4">
            {([["On the pick list", n(data.picks)], ["People with alerts on", n(data.people)], ["Waiting to confirm", n(data.pending)], ["Emails waiting", n(data.queued)],
              ["Emails sent, 24 h", n(data.sent)], ["Emails failed, 24 h", n(data.failed)], ["AI summaries, 24 h", n(data.summaries)],
              ["Text alerts", config.isError ? "Unavailable" : config.data ? config.data.smsEnabled ? "On" : "Off" : <SkeletonBlock className="h-7 w-16" />]] satisfies [string, React.ReactNode][]).map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-inset p-3"><dt className="text-xs text-muted">{k}</dt><dd className="num m-0 text-xl font-extrabold">{v}</dd></div>
            ))}
          </dl>
      )}</AdminSection>
      <AdminSection title="Sponsor inquiries" section="inquiries">{(data) => data.length === 0
        ? <p className="m-0 text-sm text-muted">None yet.</p>
        : data.map((i) => (
          <div key={i.id} className="flex flex-col gap-0.5 border-t border-line-soft pt-2 text-sm">
            <span><strong>{i.name}</strong>, {i.company}{i.ticker ? ` ($${i.ticker})` : ""} · {i.package ?? "no package chosen"} · {dateET(i.created_at)}</span>
            <span className="text-ink-2"><a href={`mailto:${i.email}`}>{i.email}</a>{i.phone ? ` · ${i.phone}` : ""}</span>
            {i.message && <span className="whitespace-pre-line text-ink-2">{i.message}</span>}
          </div>
        ))}</AdminSection>
    </>
  );
}
