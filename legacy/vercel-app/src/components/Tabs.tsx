"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type Tab = { id: string; label: string; badge?: string; body: React.ReactNode };

export default function Tabs({ tabs }: { tabs: Tab[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const initial = tabs.find((t) => t.id === params.get("tab"))?.id ?? tabs[0].id;
  const [active, setActive] = useState(initial);
  return (
    <>
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => {
              setActive(t.id);
              router.replace(t.id === tabs[0].id ? "?" : `?tab=${t.id}`, { scroll: false });
            }}
          >
            {t.label}
            {t.badge && <span className="soon">{t.badge}</span>}
          </button>
        ))}
      </nav>
      {tabs.map((t) => (
        <div key={t.id} className="tab-body" role="tabpanel" hidden={active !== t.id}>
          {t.body}
        </div>
      ))}
    </>
  );
}
