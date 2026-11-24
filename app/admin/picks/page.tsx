"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminSection } from "@/components/admin/AdminSection";
import { PickForm } from "@/components/admin/PickForm";
import { adminOptions } from "@/lib/admin-query";
import { sponsorLine } from "@/lib/pick-disclosure";
import { dateET } from "@/lib/time";

export default function AdminPicksPage() {
  const listSize = useQuery({ ...adminOptions("list-size"), enabled: false });
  return (
    <>
      <AdminSection title="Post a pick" section="list-size">{(data, query) => query.isError ? null : <PickForm listSize={data} />}</AdminSection>
      <AdminSection title="Scheduled picks" section="scheduled-picks">{(data) => data.length === 0
        ? <p className="m-0 text-sm text-muted">None scheduled.</p>
        : data.map((p) => (
          <details key={p.id} className="border-t border-line-soft pt-2 text-sm">
            <summary className="cursor-pointer font-bold">
              {dateET(p.startsAt)} · ${p.ticker} · {p.title} · Edit
              {sponsorLine(p) && <span className="block text-amber">{sponsorLine(p)}</span>}
            </summary>
            <div className="pt-4">
              {listSize.data === undefined || listSize.isError ? <p role="alert" className="m-0 text-sm text-bad">The pick list size is unavailable. Wait for it to load before editing.</p> : <PickForm listSize={listSize.data} pick={p} />}
            </div>
          </details>
        ))}</AdminSection>
      <AdminSection title="Recent picks" section="picks">{(data) => data.length === 0
        ? <p className="m-0 text-sm text-muted">None yet.</p>
        : data.map((p) => (
          <div key={p.id} className="flex flex-wrap items-baseline gap-x-3 border-t border-line-soft pt-2 text-sm">
            <span className="num w-[92px] text-muted">{dateET(p.startsAt)}</span><strong className="w-16">${p.ticker}</strong>
            <span className="min-w-0 flex-1">{p.title}{sponsorLine(p) && <span className="block font-bold text-amber">{sponsorLine(p)}</span>}</span>
          </div>
        ))}</AdminSection>
    </>
  );
}
