"use client";

import { useState } from "react";
import type { Summary } from "@/lib/store";

const TONE: Record<Summary["tone"], string> = { "Good news": "good", "Bad news": "bad", Mixed: "mixed", Routine: "routine" };

/** Shows a saved plain-English summary, or a button that asks Claude to write one. */
export default function FilingSummary({ ticker, accession, initial }: { ticker: string; accession: string; initial: Summary | null }) {
  const [summary, setSummary] = useState(initial);
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});

  if (summary)
    return (
      <div className="sum">
        <strong>{summary.headline}</strong>
        <span className={`tone ${TONE[summary.tone]}`}>{summary.tone}</span>
        <ul>
          {summary.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
        <span className="small">
          <strong>Why it matters:</strong> {summary.whyItMatters}
        </span>
        <span className="disc">Plain-English summary of the official filing. Can contain mistakes. Not investment advice.</span>
      </div>
    );

  return (
    <>
      <button
        className="linkish"
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          const res = await fetch("/api/explain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker, accession }),
          }).catch(() => null);
          const data = res ? await res.json() : { error: "Couldn't reach BigStocks." };
          if (res?.ok) setSummary(data);
          else setState({ error: data.error ?? "Couldn't summarize this filing." });
        }}
      >
        {state.busy ? "Reading the filing… (about 20 seconds)" : "✦ Explain this in plain English"}
      </button>
      {state.error && <span className="form-error small">{state.error}</span>}
    </>
  );
}
