"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Staff form for posting a pick. Sending cannot be undone, so it asks for a tick first. */
export function PickForm({ listSize }: { listSize: number }) {
  const router = useRouter();
  const [sponsored, setSponsored] = useState(false);
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      const v = (k: string) => String(f.get(k) ?? "");
      setState("busy");
      setNote(null);
      const res = await fetch("/api/admin/pick", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticker: v("ticker"), title: v("title"), why: v("why"), sourceUrl: v("sourceUrl"), sponsored, payer: v("payer"), amount: v("amount"), form: v("form"),
          ownsShares: f.get("ownsShares") === "on", ownershipNote: v("ownershipNote"), confirm: f.get("confirm") === "on",
        }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      setState("idle");
      if (res?.ok && data.ok) {
        setNote({ ok: true, text: `Posted $${data.ticker}. The email goes out to the pick list within a minute.` });
        form.reset();
        setSponsored(false);
        router.refresh();
      } else setNote({ ok: false, text: data.error ?? "That didn't go through." });
    }}>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-[0_1_140px] flex-col gap-1 text-sm font-bold">Ticker<input name="ticker" required maxLength={10} className="field uppercase" placeholder="AAPL" autoComplete="off" /></label>
        <label className="flex flex-[1_1_320px] flex-col gap-1 text-sm font-bold">The reason, in one sentence<input name="title" required minLength={10} maxLength={200} className="field" /></label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-bold">Why it&apos;s on our radar (optional, a short paragraph)<textarea name="why" maxLength={2000} className="field" /></label>
      <label className="flex flex-col gap-1 text-sm font-bold">Link to the filing or release it is about (optional)<input name="sourceUrl" type="url" className="field" placeholder="https://www.sec.gov/Archives/…" /></label>
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" name="ownsShares" className="h-[18px] w-[18px] accent-brand" />BigStocks staff own shares in this company</label>
      <label className="flex flex-col gap-1 text-sm font-bold">If so, say how many or how much (optional)<input name="ownershipNote" maxLength={300} className="field" /></label>

      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={sponsored} onChange={(e) => setSponsored(e.target.checked)} className="h-[18px] w-[18px] accent-brand" />
        This pick is sponsored (someone paid for it)
      </label>
      {sponsored && (
        <fieldset className="m-0 flex flex-wrap gap-3 rounded-2xl border-0 bg-amber-bg p-4">
          <legend className="sr-only">Who paid, how much, in what form</legend>
          <p className="m-0 w-full text-sm text-amber">The law requires all three. They are shown on the pick and at the top of the email.</p>
          <label className="flex flex-[1_1_220px] flex-col gap-1 text-sm font-bold">Who paid<input name="payer" required className="field" placeholder="Company or agency name" /></label>
          <label className="flex flex-[1_1_140px] flex-col gap-1 text-sm font-bold">How much<input name="amount" required className="field" placeholder="$5,000" /></label>
          <label className="flex flex-[1_1_140px] flex-col gap-1 text-sm font-bold">In what form<input name="form" required className="field" placeholder="cash, shares…" /></label>
        </fieldset>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" required className="mt-0.5 h-[18px] w-[18px] accent-brand" />
        <span>Send this to the {listSize.toLocaleString("en-US")} people on the pick list now. This cannot be undone, and a pick can never be deleted.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={state === "busy"} className="btn btn-dark btn-lg">{state === "busy" ? "Posting…" : "Post and send"}</button>
        {note && <span role={note.ok ? "status" : "alert"} className={`text-sm font-bold ${note.ok ? "text-good" : "text-bad"}`}>{note.text}</span>}
      </div>
    </form>
  );
}
