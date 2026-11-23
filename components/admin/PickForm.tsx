"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dateET } from "@/lib/time";
import type { StockPick } from "@/lib/data/picks";

function dateInputET(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Staff form for posting or editing a scheduled pick. */
export function PickForm({ listSize, pick }: { listSize: number; pick?: StockPick }) {
  const router = useRouter();
  const [sponsored, setSponsored] = useState(pick?.sponsored ?? false);
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
          ...(pick ? { id: pick.id } : {}),
          ticker: v("ticker"), title: v("title"), why: v("why"), sourceUrl: v("sourceUrl"), sponsored,
          ...(sponsored ? { payer: v("payer"), amount: v("amount"), form: v("form"), startDate: v("startDate") } : {}),
          ownsShares: f.get("ownsShares") === "on", ownershipNote: v("ownershipNote"), confirm: f.get("confirm") === "on",
        }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      setState("idle");
      if (res?.ok && data.ok) {
        setNote({ ok: true, text: Date.parse(data.startsAt) > Date.now()
          ? `${pick ? "Updated" : "Scheduled"} $${data.ticker} for ${dateET(data.startsAt)}. Publication and email start at midnight New York time.`
          : Date.now() - Date.parse(data.startsAt) >= 24 * 3600_000
            ? `Posted $${data.ticker}. The start date is too old to send an email.`
            : `Posted $${data.ticker}. The email goes out to the pick list within a minute.` });
        if (!pick) {
          form.reset();
          setSponsored(false);
        } else {
          const confirm = form.elements.namedItem("confirm");
          if (confirm instanceof HTMLInputElement) confirm.checked = false;
        }
        router.refresh();
      } else setNote({ ok: false, text: data.error ?? "That didn't go through." });
    }}>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-[0_1_140px] flex-col gap-1 text-sm font-bold">Ticker<input name="ticker" required maxLength={10} defaultValue={pick?.ticker} className="field uppercase" placeholder="AAPL" autoComplete="off" /></label>
        <label className="flex flex-[1_1_320px] flex-col gap-1 text-sm font-bold">The reason, in one sentence<input name="title" required minLength={10} maxLength={200} defaultValue={pick?.title} className="field" /></label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-bold">
        Why it&apos;s on our radar (optional, a short paragraph)
        <textarea name="why" maxLength={2000} defaultValue={pick?.why} className="field" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        Link to the filing or release it is about (optional)
        <input name="sourceUrl" type="url" defaultValue={pick?.sourceUrl ?? ""} className="field" placeholder="https://www.sec.gov/Archives/…" />
      </label>
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" name="ownsShares" defaultChecked={pick?.ownsShares ?? false} className="h-[18px] w-[18px] accent-brand" />
        BigStocks staff own shares in this company
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        If so, say how many or how much (optional)
        <input name="ownershipNote" maxLength={300} defaultValue={pick?.ownershipNote} className="field" />
      </label>

      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={sponsored} onChange={(e) => setSponsored(e.target.checked)} className="h-[18px] w-[18px] accent-brand" />
        This pick is sponsored (someone paid for it)
      </label>
      {sponsored && (
        <fieldset className="m-0 flex flex-wrap gap-3 rounded-2xl border-0 bg-amber-bg p-4">
          <legend className="sr-only">Sponsor details and start date</legend>
          <p className="m-0 w-full text-sm text-amber">Who paid, how much and in what form are required disclosures. The start date is also shown on the pick and in the email.</p>
          <label className="flex flex-[1_1_220px] flex-col gap-1 text-sm font-bold">Who paid<input name="payer" required defaultValue={pick?.sponsor?.payer} className="field" placeholder="Company or agency name" /></label>
          <label className="flex flex-[1_1_140px] flex-col gap-1 text-sm font-bold">How much<input name="amount" required defaultValue={pick?.sponsor?.amount} className="field" placeholder="$5,000" /></label>
          <label className="flex flex-[1_1_140px] flex-col gap-1 text-sm font-bold">In what form<input name="form" required defaultValue={pick?.sponsor?.form} className="field" placeholder="cash, shares…" /></label>
          <label className="flex min-w-0 flex-[1_1_180px] flex-col gap-1 text-sm font-bold">Start date<input name="startDate" type="date" required defaultValue={pick ? dateInputET(pick.startsAt) : undefined} className="field min-w-0" /></label>
          <p className="m-0 w-full text-sm text-amber">The pick becomes public and eligible for email at midnight New York time on this date. Dates more than 24 hours ago publish without an email.</p>
        </fieldset>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" required className="mt-0.5 h-[18px] w-[18px] accent-brand" />
        <span>{sponsored ? "Publish on the start date and email the pick list (unless the date is more than 24 hours ago). A date that has already started publishes immediately." : `Publish and send this now to the ${listSize.toLocaleString("en-US")} people on the pick list.`} Once public, the pick cannot be edited or deleted.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={state === "busy"} className="btn btn-dark btn-lg">{state === "busy" ? "Saving…" : pick ? "Save changes" : sponsored ? "Save and schedule" : "Post and send"}</button>
        {note && <span role={note.ok ? "status" : "alert"} className={`text-sm font-bold ${note.ok ? "text-good" : "text-bad"}`}>{note.text}</span>}
      </div>
    </form>
  );
}
