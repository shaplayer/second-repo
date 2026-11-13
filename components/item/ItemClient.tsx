"use client";

import { useEffect, useState } from "react";
import type { FeedSummary } from "@/lib/data/feed";

type View = { status: "ready"; summary: FeedSummary } | { status: "pending" } | { status: "unavailable"; reason: string };

/** The body of the mint summary card. */
export function SummaryBody({ summary }: { summary: FeedSummary }) {
  return (
    <>
      <h2 className="eyebrow m-0 text-[13px]">In one sentence</h2>
      <p className="m-0 text-[21px] font-bold leading-[1.45]">{summary.oneSentence}</p>
      {summary.bullets.length > 0 && (
        <>
          <h2 className="eyebrow m-0 mt-1.5 text-[13px]">What it says</h2>
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-base leading-normal text-ink-2">
            {summary.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </>
      )}
      <span className="fine">
        {summary.kind === "ai" ? "AI-generated summary. Can contain mistakes." : "Built from the filing's own numbers, without AI."}
      </span>
    </>
  );
}

/** Asks for the summary of an item that has none yet, and shows it when the worker has written it. */
export function SummaryLoader({ id, originalUrl, sourceName }: { id: string; originalUrl: string; sourceName: string }) {
  const [view, setView] = useState<View>({ status: "pending" });
  useEffect(() => {
    let stop = false;
    let tries = 0;
    const ask = async () => {
      if (stop) return;
      try {
        const data = await (await fetch(`/api/summary?id=${encodeURIComponent(id)}`)).json();
        if (stop) return;
        if (data.status === "ready") return setView({ status: "ready", summary: data.summary });
        if (data.status === "unavailable") return setView({ status: "unavailable", reason: data.reason });
      } catch {
        /* try again */
      }
      if (++tries < 40) setTimeout(ask, 3000);
      else setView({ status: "unavailable", reason: "The summary is taking longer than usual. The original has the full details." });
    };
    ask();
    return () => {
      stop = true;
    };
  }, [id]);

  if (view.status === "ready") return <SummaryBody summary={view.summary} />;
  return (
    <div aria-live="polite" className="flex flex-col gap-1.5">
      <span className="text-lg font-bold">{view.status === "pending" ? "Summary not ready yet" : "No summary for this one"}</span>
      <p className="m-0 text-base leading-normal text-ink-2">
        {view.status === "pending" ? "Writing the plain-English summary. It usually takes under a minute." : view.reason}{" "}
        <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="font-bold">Read the original on {sourceName} ↗</a>
      </p>
    </div>
  );
}

export function CopyLink() {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-soft btn-lg min-h-12 text-[15px] font-bold"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* the address bar still works */
        }
      }}>
      {done ? "Copied ✓" : "Copy link"}
    </button>
  );
}
