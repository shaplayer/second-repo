"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem, FeedSummary } from "@/lib/data/feed";
import { CATEGORY_LABEL, type Category } from "@/lib/plain";
import { TypeBadge } from "@/components/ui/Badges";
import { PauseIcon, PlayIcon } from "@/components/ui/Icons";
import { TimeAgo } from "@/components/ui/TimeAgo";
import { clockET } from "@/lib/time";
import { SignupForm } from "@/components/signup/SignupForm";

type Counts = Partial<Record<Category | "all", number>>;

export type FeedListProps = {
  initial: FeedItem[];
  /** Cursor for older posts, or null when there are none. */
  next: string | null;
  /** Fixed parts of the query: one company (the stock page). */
  cik?: number;
  /** Show the filter buttons, with these counts (posts in the last 24 hours). */
  counts?: Counts;
  /** Which filters to offer. */
  filters?: Category[];
  /** Check for new posts every few seconds. */
  live?: boolean;
  /** Signed in: "Alert me" works in one click and "My stocks only" is offered. */
  signedIn?: boolean;
  /** Companies this person already gets alerts for. */
  following?: number[];
  /** Hide the ticker column (the stock page: every row is the same company). */
  hideTicker?: boolean;
  title?: string;
  /** A link under the list, e.g. "See all live news". */
  moreHref?: string;
  moreLabel?: string;
  emptyText?: string;
  /** Offer "Load earlier posts" instead of a link away. */
  paged?: boolean;
  textFilter?: boolean;
};

type SummaryView =
  | { status: "ready"; summary: FeedSummary; headline: string }
  | { status: "pending" }
  | { status: "unavailable"; reason: string };

const tickerOf = (it: FeedItem) => (it.ticker ? `$${it.ticker}` : it.company);
const stockHref = (it: FeedItem) => (it.ticker ? `/stock/${encodeURIComponent(it.ticker)}` : it.cik ? `/stock/CIK${it.cik}` : null);

/** The AI summary (or the wait for it) that opens under a headline, in place. */
function SummaryPanel({ item, view }: { item: FeedItem; view: SummaryView | undefined }) {
  const stock = stockHref(item);
  const links = (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 pt-1">
      <a href={item.originalUrl} target="_blank" rel="noopener noreferrer" className="btn btn-dark min-h-[42px]">
        Read the original on {item.sourceName} ↗
      </a>
      {stock && <Link href={stock} className="text-sm font-bold no-underline">{tickerOf(item)} stock page</Link>}
      <Link href={item.path} className="text-sm font-bold no-underline">Open full page</Link>
      {view?.status === "ready" && view.summary.kind === "ai" && <span className="fine">AI-generated. Can contain mistakes.</span>}
    </div>
  );
  return (
    <div className="card-mint mt-3 flex flex-col gap-2.5 rounded-[20px] px-5 py-[18px] md:ml-[110px]" role="region" aria-label="Summary">
      {view?.status === "ready" ? (
        <>
          <span className="eyebrow">{view.summary.kind === "ai" ? "AI summary · In one sentence" : "In one sentence"}</span>
          <span className="text-lg font-bold leading-[1.45]">{view.summary.oneSentence}</span>
          {view.summary.bullets.length > 0 && (
            <>
              <span className="eyebrow pt-1">What it says</span>
              <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-normal text-ink-2">
                {view.summary.bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </>
          )}
        </>
      ) : view?.status === "unavailable" ? (
        <p className="m-0 text-[15px] leading-normal text-ink-2">{view.reason}</p>
      ) : (
        <div aria-live="polite">
          <span className="text-base font-bold">Summary not ready yet</span>
          <p className="m-0 mt-1 text-[15px] leading-normal text-ink-2">Writing the plain-English summary. It usually takes under a minute.</p>
        </div>
      )}
      {links}
    </div>
  );
}

export function FeedList(props: FeedListProps) {
  const { cik, live = true, signedIn = false, hideTicker = false, paged = false } = props;
  const [items, setItems] = useState(props.initial);
  const [next, setNext] = useState(props.next);
  const [category, setCategory] = useState<Category | "all">("all");
  const [mine, setMine] = useState(false);
  const [text, setText] = useState("");
  const [paused, setPaused] = useState(false);
  const [fresh, setFresh] = useState<FeedItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, SummaryView>>({});
  const [following, setFollowing] = useState<Set<number>>(new Set(props.following ?? []));
  const [asking, setAsking] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const first = useRef(true);

  const query = useCallback(
    (extra: Record<string, string>) => {
      const q = new URLSearchParams(extra);
      if (cik !== undefined) q.set("cik", String(cik));
      if (category !== "all") q.set("category", category);
      if (mine) q.set("mine", "1");
      if (text.trim()) q.set("q", text.trim());
      return `/api/feed?${q}`;
    },
    [cik, category, mine, text],
  );

  // A change of filter loads that list from the top.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let stop = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(query({}));
        const data = await res.json();
        if (stop) return;
        setItems(data.items ?? []);
        setNext(data.next ?? null);
        setFresh([]);
        setProblem(!res.ok);
      } catch {
        if (!stop) setProblem(true);
      } finally {
        if (!stop) setLoading(false);
      }
    }, text ? 250 : 0);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [query, text]);

  // Every few seconds, ask whether anything newer than the top post has arrived. New posts wait behind
  // a "show them" bar so the list never jumps while someone is reading.
  useEffect(() => {
    if (!live || paused) return;
    const tick = async () => {
      if (document.hidden) return;
      const top = fresh[0] ?? items[0];
      try {
        const res = await fetch(query(top ? { after: top.cursor } : {}));
        if (!res.ok) throw new Error();
        const data = await res.json();
        setProblem(false);
        setCheckedAt(new Date().toISOString());
        if (data.items?.length) setFresh((f) => [...(data.items as FeedItem[]), ...f].slice(0, 200));
      } catch {
        setProblem(true);
      }
    };
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [live, paused, items, fresh, query]);

  // An open item without a summary: ask for one, and keep asking while it is being written.
  useEffect(() => {
    if (!open) return;
    const item = items.find((i) => i.id === open);
    if (!item) return;
    if (item.summary) {
      setViews((v) => ({ ...v, [open]: { status: "ready", summary: item.summary!, headline: item.headline } }));
      return;
    }
    if (views[open]?.status === "ready" || views[open]?.status === "unavailable") return;
    let stop = false;
    let tries = 0;
    const ask = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/summary?id=${encodeURIComponent(open)}`);
        const data = await res.json();
        if (stop) return;
        if (data.status === "ready") {
          setViews((v) => ({ ...v, [open]: { status: "ready", summary: data.summary, headline: data.headline } }));
          setItems((list) => list.map((i) => (i.id === open ? { ...i, summary: data.summary, headline: data.headline } : i)));
          return;
        }
        if (data.status === "unavailable") {
          setViews((v) => ({ ...v, [open]: { status: "unavailable", reason: data.reason } }));
          return;
        }
        setViews((v) => ({ ...v, [open]: { status: "pending" } }));
      } catch {
        /* try again below */
      }
      if (++tries < 40) setTimeout(ask, 3000);
      else setViews((v) => ({ ...v, [open]: { status: "unavailable", reason: "The summary is taking longer than usual. The original has the full details." } }));
    };
    ask();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadMore() {
    if (!next || loading) return;
    setLoading(true);
    try {
      const res = await fetch(query({ before: next }));
      const data = await res.json();
      setItems((list) => [...list, ...(data.items ?? [])]);
      setNext(data.next ?? null);
    } catch {
      setProblem(true);
    } finally {
      setLoading(false);
    }
  }

  async function follow(item: FeedItem) {
    if (!item.cik) return;
    if (!signedIn) {
      setAsking(asking === item.id ? null : item.id);
      return;
    }
    setFollowing((f) => new Set(f).add(item.cik!));
    const res = await fetch("/api/follow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cik: item.cik, alerts: true, source: "feed" }) });
    if (!res.ok) setFollowing((f) => { const n = new Set(f); n.delete(item.cik!); return n; });
  }

  const filters = props.filters ?? [];
  const filterBtn = (key: Category | "all", label: string) => {
    const on = category === key;
    const count = props.counts?.[key];
    return (
      <button key={key} type="button" aria-pressed={on} onClick={() => setCategory(key)}
        className={`h-10 rounded-full border-0 px-3.5 text-[13px] font-bold ${on ? "bg-ink text-white" : "bg-chip text-ink-2 hover:bg-[#e3ece7]"}`}>
        {label}{count !== undefined && <span className="ml-1 font-medium opacity-70">{count}</span>}
      </button>
    );
  };

  return (
    <div className="card-raised overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-5 md:px-6">
        <div className="flex flex-wrap items-center gap-2.5">
          {live && <span className="live-dot" />}
          <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em]">{props.title ?? "Live now"}</h2>
          {live && (
            <span className="text-[13px] text-muted">
              {paused ? "paused" : problem ? "updates delayed" : "auto-updating"}
              {checkedAt && !paused && !problem && <> · <TimeAgo iso={checkedAt} suffix /></>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {signedIn && cik === undefined && (
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-[18px] w-[18px] accent-brand" />
              My stocks only
            </label>
          )}
          {live && (
            <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume live updates" : "Pause live updates"} aria-pressed={paused}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-[#d7dfda] bg-white text-ink">
              {paused ? <PlayIcon className="h-4 w-4" /> : <PauseIcon className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {props.textFilter && (
        <div className="px-4 pb-3 md:px-6">
          <label htmlFor="feed-filter" className="sr-only">Filter by ticker, company or headline</label>
          <input id="feed-filter" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by ticker, company, or headline" className="field" autoComplete="off" />
        </div>
      )}

      {filters.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-3.5 md:flex-wrap md:px-6">
          {filterBtn("all", "All")}
          {filters.map((c) => filterBtn(c, CATEGORY_LABEL[c]))}
        </div>
      )}

      {problem && (
        <p role="status" className="m-0 border-t border-line-soft bg-amber-bg px-4 py-3 text-sm text-amber md:px-6">
          New posts are taking longer than usual. Showing what we had{checkedAt ? ` at ${clockET(checkedAt)}` : ""}. We&apos;ll add new ones automatically.
        </p>
      )}

      {fresh.length > 0 && (
        <button type="button" onClick={() => { setItems((list) => [...fresh, ...list]); setFresh([]); }}
          className="h-11 w-full border-0 border-t border-line-soft bg-[#eef8f2] text-sm font-bold text-good">
          ↑ {fresh.length} new {fresh.length === 1 ? "post" : "posts"}, show {fresh.length === 1 ? "it" : "them"}
        </button>
      )}

      <div aria-busy={loading}>
        {items.map((it) => {
          const isOpen = open === it.id;
          const stock = stockHref(it);
          const view = views[it.id] ?? (it.summary ? { status: "ready" as const, summary: it.summary, headline: it.headline } : undefined);
          const followed = it.cik !== null && following.has(it.cik);
          return (
            <article key={it.id} className={`border-t border-line-soft px-4 py-4 md:px-6 ${isOpen ? "bg-[#fbfdfc]" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2">
                {!hideTicker && (
                  <div className="flex flex-none items-baseline gap-2 md:w-[92px] md:flex-col md:items-start md:gap-0.5">
                    {stock ? (
                      <Link href={stock} className="max-w-[160px] truncate text-lg font-extrabold text-ink no-underline hover:text-link md:max-w-[92px]">{tickerOf(it)}</Link>
                    ) : (
                      <span className="max-w-[160px] truncate text-base font-extrabold md:max-w-[92px]">{tickerOf(it)}</span>
                    )}
                    <span className="num text-xs text-muted">{clockET(it.publishedAt)}</span>
                  </div>
                )}
                <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1">
                  <span className="text-[13px] text-muted">
                    <TypeBadge category={it.category} label={it.typeLabel} className="mr-1.5" />
                    {it.sourceName} · <TimeAgo iso={it.publishedAt} suffix />
                  </span>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.id)}
                    className="flex w-full items-start justify-between gap-3 border-0 bg-transparent p-0 text-left text-ink">
                    <span className="text-[17px] font-extrabold leading-[1.4]">{view?.status === "ready" ? view.headline : it.headline}</span>
                    <span aria-hidden="true" className={`flex-none text-xl leading-none text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}>⌄</span>
                  </button>
                  {!isOpen && it.summary && it.summary.oneSentence !== it.headline && (
                    <span className="text-[15px] leading-normal text-ink-2">
                      {it.summary.kind === "ai" && <span className="mr-1.5 rounded border border-[#cfd8d3] px-[5px] py-px text-[11px] font-bold text-muted">AI</span>}
                      {it.summary.oneSentence}
                    </span>
                  )}
                </div>
                {it.cik !== null && (
                  followed ? (
                    <span className="btn btn-soft cursor-default">Alerts on ✓</span>
                  ) : (
                    <button type="button" onClick={() => follow(it)} aria-expanded={signedIn ? undefined : asking === it.id} className="btn btn-dark">
                      Alert me on {tickerOf(it)}
                    </button>
                  )
                )}
              </div>
              {asking === it.id && !signedIn && it.cik !== null && (
                <div className="card mt-3 p-4 md:ml-[110px]">
                  <p className="m-0 mb-2 text-[15px] font-bold">Get {tickerOf(it)} news the moment it posts</p>
                  <SignupForm cik={it.cik} ticker={it.ticker} source={`feed:${it.ticker ?? it.cik}`} button={`Alert me on ${tickerOf(it)}`} tone="light" />
                </div>
              )}
              {isOpen && <SummaryPanel item={it} view={view} />}
            </article>
          );
        })}
      </div>

      {items.length === 0 && !loading && (
        <p className="m-0 border-t border-line-soft px-6 py-7 text-center text-[15px] text-muted">{props.emptyText ?? "Nothing in this category yet."}</p>
      )}

      {(paged ? next : props.moreHref) && (
        <div className="flex flex-wrap justify-between gap-2 border-t border-line-soft px-4 py-4 md:px-6">
          {paged ? (
            <button type="button" onClick={loadMore} disabled={loading} className="btn btn-soft">{loading ? "Loading…" : "Load earlier posts"}</button>
          ) : (
            <Link href={props.moreHref!} className="font-extrabold no-underline">{props.moreLabel ?? "See all live news"} →</Link>
          )}
        </div>
      )}
    </div>
  );
}
