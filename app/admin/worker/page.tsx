"use client";

import { AdminSection } from "@/components/admin/AdminSection";
import { TestAlertForm } from "@/components/admin/TestAlertForm";
import { exactET } from "@/lib/time";

export default function AdminWorkerPage() {
  return (
    <>
      <AdminSection title="Worker" section="jobs">{(data) => data.length === 0
        ? <p className="m-0 text-sm text-muted">The worker has not reported yet.</p>
        : data.map((j) => {
          const failing = j.last_error_at && (!j.last_success_at || j.last_error_at > j.last_success_at);
          return (
            <div key={j.job} className="flex flex-wrap items-baseline gap-x-3 border-t border-line-soft pt-2 text-sm">
              <strong className="w-28">{j.job}</strong>
              <span className={failing ? "font-bold text-bad" : "text-good"}>{failing ? "Failing" : "Working"}</span>
              <span className="text-muted">last worked {j.last_success_at ? exactET(new Date(j.last_success_at).toISOString()) : "never"}</span>
              {failing && <span className="w-full text-bad">{j.last_error}</span>}
            </div>
          );
        })}</AdminSection>
      <AdminSection title="Schedule a test email" section="test-alerts">{(data) => <TestAlertForm jobs={data} />}</AdminSection>
    </>
  );
}
