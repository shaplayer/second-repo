import { PickForm } from "@/components/admin/PickForm";
import { listPicks, listScheduledPicks, sponsorLine } from "@/lib/data/picks";
import { db } from "@/lib/db";
import { dateET } from "@/lib/time";
import { adminQuery, requireAdmin } from "../shared";

const card = "card flex flex-col gap-3 p-5 md:p-6";

export default async function AdminPicksPage() {
  await requireAdmin("/admin/picks");
  const pool = db();
  const [counts, picks, scheduledPicks] = await Promise.all([
    adminQuery<{ picks: string }>(pool, "pick list size", "select count(*) as picks from public.alert_subscriptions where channel = 'email' and status = 'active' and cik is null and 'picks' = any(categories)"),
    listPicks(pool, { limit: 8 }).catch((error) => {
      console.error("[admin] could not load recent picks:", error);
      return null;
    }),
    listScheduledPicks(pool).catch((error) => {
      console.error("[admin] could not load scheduled picks:", error);
      return null;
    }),
  ]);
  const listSize = counts?.[0] ? Number(counts[0].picks) : null;

  return (
    <>
      <section className={card}>
        <h2 className="m-0 text-xl font-extrabold">Post a pick</h2>
        {listSize === null ? <p role="alert" className="m-0 text-sm text-bad">Could not load the pick list size. Try again before posting.</p> : <PickForm listSize={listSize} />}
      </section>
      <section className={card}>
        <h2 className="m-0 text-xl font-extrabold">Scheduled picks</h2>
        {!scheduledPicks ? <p role="alert" className="m-0 text-sm text-bad">Could not load scheduled picks. Try again.</p> : scheduledPicks.length === 0 && <p className="m-0 text-sm text-muted">None scheduled.</p>}
        {scheduledPicks?.map((p) => (
          <details key={p.id} className="border-t border-line-soft pt-2 text-sm">
            <summary className="cursor-pointer font-bold">
              {dateET(p.startsAt)} · ${p.ticker} · {p.title} · Edit
              {sponsorLine(p) && <span className="block text-amber">{sponsorLine(p)}</span>}
            </summary>
            <div className="pt-4">
              {listSize === null ? <p role="alert" className="m-0 text-sm text-bad">Could not load the pick list size. Try again before editing.</p> : <PickForm listSize={listSize} pick={p} />}
            </div>
          </details>
        ))}
      </section>
      <section className={card}>
        <h2 className="m-0 text-xl font-extrabold">Recent picks</h2>
        {!picks ? <p role="alert" className="m-0 text-sm text-bad">Could not load recent picks. Try again.</p> : picks.length === 0 && <p className="m-0 text-sm text-muted">None yet.</p>}
        {picks?.map((p) => (
          <div key={p.id} className="flex flex-wrap items-baseline gap-x-3 border-t border-line-soft pt-2 text-sm">
            <span className="num w-[92px] text-muted">{dateET(p.startsAt)}</span><strong className="w-16">${p.ticker}</strong>
            <span className="min-w-0 flex-1">{p.title}{sponsorLine(p) && <span className="block font-bold text-amber">{sponsorLine(p)}</span>}</span>
          </div>
        ))}
      </section>
    </>
  );
}
