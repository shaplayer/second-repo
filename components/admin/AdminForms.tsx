"use client";

import { useId, useRef, useState } from "react";
import { PickForm } from "@/components/admin/PickForm";
import { PickApiKeyForm } from "@/components/admin/PickApiKeyForm";
import { TestAlertForm } from "@/components/admin/TestAlertForm";
import type { TestAlertJob } from "@/lib/alerts/test-alerts";

const tabs = [
  { label: "Post a pick", description: "Publish and email the pick list" },
  { label: "Test email", description: "Schedule a delivery test" },
  { label: "API key", description: "Connect an application" },
];

export function AdminForms({ listSize, testAlerts }: { listSize: number; testAlerts: TestAlertJob[] | null }) {
  const [active, setActive] = useState(0);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  };

  return (
    <section className="card flex flex-col gap-5 p-5 md:p-6">
      <div>
        <h2 className="m-0 text-xl font-extrabold">Staff actions</h2>
        <p className="mb-0 mt-1 text-sm text-muted">Choose an action to get started.</p>
      </div>
      <div className="rounded-2xl border border-line bg-white">
        <div role="tablist" aria-label="Staff actions" className="grid grid-cols-3 gap-1 rounded-t-2xl border-b border-line bg-inset px-2 pt-2">
          {tabs.map((tab, index) => (
            <button
              key={tab.label}
              ref={(element) => { buttons.current[index] = element; }}
              type="button"
              role="tab"
              id={`${id}-tab-${index}`}
              aria-controls={`${id}-panel-${index}`}
              aria-selected={active === index}
              tabIndex={active === index ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => moveTab(event, index)}
              className={`relative -mb-px min-h-[72px] min-w-0 rounded-t-xl border border-transparent border-t-[3px] px-3 py-2 text-left ${active === index ? "border-x-line border-t-brand border-b-white bg-white text-brand-dark" : "text-ink-2 hover:bg-white/60"}`}
            >
              <span className="block text-sm font-extrabold">{tab.label}</span>
              <span className="mt-0.5 block text-xs font-normal text-muted">{tab.description}</span>
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={active !== 0} className="p-4 md:p-6">
          <p className="eyebrow mb-1 mt-0">Pick alert</p>
          <h3 className="mb-4 mt-0 text-lg font-extrabold">Post a pick</h3>
          <PickForm listSize={listSize} />
        </div>
        <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={active !== 1} className="p-4 md:p-6">
          <p className="eyebrow mb-1 mt-0">Email test</p>
          <h3 className="mb-4 mt-0 text-lg font-extrabold">Schedule a test email</h3>
          {testAlerts ? <TestAlertForm jobs={testAlerts} /> : <p role="alert" className="m-0 text-sm text-bad">Could not load test alerts. Check the database and try again.</p>}
        </div>
        <div role="tabpanel" id={`${id}-panel-2`} aria-labelledby={`${id}-tab-2`} hidden={active !== 2} className="p-4 md:p-6">
          <p className="eyebrow mb-1 mt-0">Application access</p>
          <h3 className="mb-4 mt-0 text-lg font-extrabold">Create an API key</h3>
          <PickApiKeyForm />
        </div>
      </div>
    </section>
  );
}
