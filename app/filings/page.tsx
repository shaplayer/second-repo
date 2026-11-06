import type { Metadata } from "next";
import Link from "next/link";
import { getFeed } from "@/lib/feeds";
import { FORM_LABELS } from "@/lib/feeds/sources";
import { FeedList } from "@/components/FeedList";
import { NewsShell, SectionTabs } from "@/components/NewsShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Latest SEC Filings: 8-K, 10-Q, 10-K, S-1 | BigStocks",
  description: "The latest SEC filings from listed companies, straight from EDGAR. Filter by form type or search by ticker.",
};

const FORMS: { id: string; label: string; forms: string[] }[] = [
  { id: "8-K", label: "8-K", forms: ["8-K"] },
  { id: "10-Q", label: "10-Q", forms: ["10-Q"] },
  { id: "10-K", label: "10-K", forms: ["10-K"] },
  { id: "S-1", label: "S-1 / IPO", forms: ["S-1"] },
  { id: "S-3", label: "S-3", forms: ["S-3"] },
  { id: "6-K", label: "6-K", forms: ["6-K"] },
  { id: "424B4", label: "Prospectus", forms: ["424B4"] },
  { id: "13D", label: "13D", forms: ["SCHEDULE 13D", "SC 13D"] },
];

export default async function FilingsPage({ searchParams }: { searchParams: Promise<{ form?: string; q?: string }> }) {
  const sp = await searchParams;
  const active = FORMS.find((f) => f.id === sp.form);
  const query = (sp.q ?? "").trim().slice(0, 80);
  const initial = await getFeed({ kind: "filing", forms: active?.forms, q: query, limit: 25 });

  const chip = (on: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${on ? "border-brand/50 bg-brand/10 text-brand" : "border-line-strong text-muted hover:border-[#3a434a] hover:text-ink"}`;
  const href = (form?: string) => {
    const p = new URLSearchParams();
    if (form) p.set("form", form);
    if (query) p.set("q", query);
    const s = p.toString();
    return s ? `/filings?${s}` : "/filings";
  };

  return (
    <NewsShell
      searchBase="/filings"
      searchValue={query}
      header={
        <>
          <SectionTabs active="filings" />
          <h1 className="mt-6 text-[34px] font-semibold leading-[1.08] tracking-tight md:text-[46px]">
            {query ? <>SEC filings matching &ldquo;{query}&rdquo;</> : <>Every SEC filing. <span className="text-muted">Straight from EDGAR.</span></>}
          </h1>
          <p className="mt-3 max-w-xl text-[16px] text-muted">
            {active ? `${active.label}: ${FORM_LABELS[active.forms[0]] ?? ""}.` : "Current reports, quarterly and annual results, IPOs, offerings and activist stakes from listed companies."}
          </p>
        </>
      }
      toolbar={
        <nav aria-label="Form type" className="flex flex-wrap gap-2">
          <Link href={href()} className={chip(!active)} aria-current={!active ? "page" : undefined}>All forms</Link>
          {FORMS.map((f) => (
            <Link key={f.id} href={href(f.id)} className={chip(active?.id === f.id)} aria-current={active?.id === f.id ? "page" : undefined}
              title={FORM_LABELS[f.forms[0]]}>
              {f.label}
            </Link>
          ))}
        </nav>
      }
    >
      <FeedList
        initial={initial}
        filter={{ kind: "filing", forms: active?.forms, q: query || undefined }}
        empty={
          <>
            <p className="font-medium">No filings found{active ? ` for ${active.label}` : ""}{query ? ` matching "${query}"` : ""}.</p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">New filings appear here within minutes of hitting EDGAR.</p>
          </>
        }
      />
    </NewsShell>
  );
}
