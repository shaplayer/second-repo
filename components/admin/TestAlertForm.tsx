"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { TestAlertJob } from "@/lib/alerts/test-alerts";

type Recipient = { id: string; address: string };
const inputTime = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function TestAlertForm({ jobs }: { jobs: TestAlertJob[] }) {
  const router = useRouter();
  const [zone, setZone] = useState("");
  const [when, setWhen] = useState("");
  const [subject, setSubject] = useState("BigStocks alert delivery test");
  const [body, setBody] = useState("This is a test of the BigStocks email alert system. No action is needed.");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipient[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Recipient[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const date = new Date(when);
  const timePreview = when && Number.isFinite(date.getTime()) && inputTime(date) === when
    ? date.toLocaleString("en-US", { timeZoneName: "longOffset", dateStyle: undefined, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setWhen(inputTime(new Date(Date.now() + 10 * 60_000)));
  }, []);
  const pending = jobs.some((job) => job.queued > 0 || job.sending > 0);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [pending, router]);

  const search = async () => {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`/api/admin/test-alerts?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load recipients.");
      setResults(data.recipients);
      setSearched(true);
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : "Could not load recipients." });
    } finally { setBusy(false); }
  };

  const schedule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const date = new Date(when);
    if (!when || !Number.isFinite(date.getTime()) || inputTime(date) !== when) {
      setNote({ ok: false, text: "Choose a valid local time. That time may not exist when the clocks change." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/admin/test-alerts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "schedule", subject, body, scheduledAt: date.toISOString(), recipients: selected.map((r) => r.id), confirm }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not schedule the test.");
      setSelected([]);
      setConfirm(false);
      setNote({ ok: true, text: "Test scheduled. Real emails will be sent when the worker is enabled." });
      router.refresh();
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : "Could not schedule the test." });
    } finally { setBusy(false); }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/admin/test-alerts", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not cancel the test.");
      setNote({ ok: true, text: "Cancelled remaining emails. An email already being sent cannot be recalled." });
      router.refresh();
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : "Could not cancel the test." });
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-sm text-muted">Send a labelled test to selected active pick-list subscribers. This does not publish a pick.</p>
      <form className="flex flex-col gap-3" onSubmit={schedule}>
        <label className="flex flex-col gap-1 text-sm font-bold">Subject<input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={150} /></label>
        <label className="flex flex-col gap-1 text-sm font-bold">Message<textarea className="field" value={body} onChange={(e) => setBody(e.target.value)} required maxLength={2000} /></label>
        <div className="rounded-2xl bg-inset p-4 text-sm">
          <strong>Preview: [TEST] {subject}</strong>
          <p className="mb-1">Test email only. This is not a stock pick.</p>
          <p className="m-0 whitespace-pre-line">{body}</p>
          <p className="mb-0 text-muted">Each email includes its own unsubscribe link, the business address, and “Not investment advice.”</p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-bold">Find recipients by email
          <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Enter at least 2 characters" />
        </label>
        <button type="button" className="btn btn-soft self-start" disabled={busy || query.trim().length < 2} onClick={search}>Search</button>
        {searched && results.length === 0 && <p className="m-0 text-sm text-muted">No eligible subscribers found.</p>}
        {results.length > 0 && <div className="flex flex-col gap-2 text-sm">
          <span className="text-muted">Up to 30 matches; refine the search to find others.</span>
          {results.map((r) => <label key={r.id} className="flex items-center gap-2 break-all">
            <input type="checkbox" checked={selected.some((s) => s.id === r.id)} onChange={(e) =>
              setSelected((s) => e.target.checked ? [...s, r] : s.filter((x) => x.id !== r.id))} />{r.address}
          </label>)}
        </div>}
        <div className="text-sm"><strong>Selected: {selected.length}</strong>
          {selected.map((r) => <div key={r.id} className="flex flex-wrap gap-2 break-all">{r.address}
            <button type="button" className="underline" onClick={() => setSelected((s) => s.filter((x) => x.id !== r.id))}>Remove</button>
          </div>)}
        </div>
        <label className="flex flex-col gap-1 text-sm font-bold">Send at ({zone || "loading your time zone"})
          <input className="field" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </label>
        {timePreview && <p className="m-0 text-sm text-muted">Selected time: {timePreview}</p>}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} required />
          <span>I understand this will send real test emails to the selected subscribers.</span>
        </label>
        <button type="submit" className="btn btn-dark self-start" disabled={busy || !zone || !selected.length}>Schedule test</button>
      </form>
      {note && <p role={note.ok ? "status" : "alert"} className={`m-0 text-sm font-bold ${note.ok ? "text-good" : "text-bad"}`}>{note.text}</p>}
      <div className="flex flex-col gap-3">
        <h3 className="m-0 font-bold">Recent test alerts</h3>
        {!jobs.length && <p className="m-0 text-sm text-muted">No tests scheduled yet.</p>}
        {jobs.map((job) => <div key={job.id} className="border-t border-line-soft pt-3 text-sm">
          <strong>[TEST] {job.subject}</strong>
          <p className="my-1">Scheduled {new Date(job.scheduledAt).toLocaleString("en-US", {
            timeZone: "America/New_York", timeZoneName: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          })} · {job.cancelled ? "Cancelled" : job.queued || job.sending ? "Scheduled" : "Complete"}</p>
          <p className="my-1">Waiting {job.queued} · Sending {job.sending} · Sent {job.sent} · Suppressed {job.suppressed} · Failed {job.failed} · Cancelled {job.cancelledCount}</p>
          {(job.queued > 0 || job.sending > 0) && !job.cancelled && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => cancel(job.id)}>Cancel remaining</button>}
          <details className="mt-2"><summary>Recipient results</summary>
            {job.recipients.map((r) => <p key={r.address} className="my-1 break-all">{r.address}: {r.status}{r.error ? ` — ${r.error}` : ""}</p>)}
          </details>
        </div>)}
      </div>
    </div>
  );
}
