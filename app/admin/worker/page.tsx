import { TestAlertForm } from "@/components/admin/TestAlertForm";
import { listTestAlerts } from "@/lib/alerts/test-alerts";
import { db } from "@/lib/db";
import { exactET } from "@/lib/time";
import { adminQuery, requireAdmin } from "../shared";

type Job = { job: string; last_success_at: Date | null; last_error: string | null; last_error_at: Date | null };
const card = "card flex flex-col gap-3 p-5 md:p-6";

export default async function AdminWorkerPage() {
  await requireAdmin("/admin/worker");
  const pool = db();
  const [jobs, testAlerts] = await Promise.all([
    adminQuery<Job>(pool, "worker status", "select job, last_success_at, last_error, last_error_at from public.job_state where job not like '%:last' order by job"),
    listTestAlerts(pool).catch((error) => {
      console.error("[admin] could not load test alerts:", error);
      return null;
    }),
  ]);
  return (
    <>
      <section className={card}>
        <h2 className="m-0 text-xl font-extrabold">Worker</h2>
        {!jobs ? <p role="alert" className="m-0 text-sm text-bad">Could not load worker status. Try again.</p> : jobs.length === 0 && <p className="m-0 text-sm text-muted">The worker has not reported yet.</p>}
        {jobs?.map((j) => {
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
      <section className={card}>
        <h2 className="m-0 text-xl font-extrabold">Schedule a test email</h2>
        {testAlerts ? <TestAlertForm jobs={testAlerts} /> : <p role="alert" className="m-0 text-sm text-bad">Could not load test alerts. Check the database and try again.</p>}
      </section>
    </>
  );
}
