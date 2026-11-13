import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmWait } from "@/components/account/AccountForms";
import { Shell } from "@/components/site/Shell";
import { peekConfirmation } from "@/lib/alerts/subscriptions";
import { maskEmail } from "@/lib/auth/accounts";
import { trendingCompanies } from "@/lib/data/companies";
import { db } from "@/lib/db";
import { pendingSignup } from "@/lib/web/signup-cookie";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your alerts", robots: { index: false } };

type Q = { token?: string; done?: string; problem?: string };

/**
 * Three moments of the same sign-up:
 *   after the form        "Click the link we sent you" (resend, add stocks while you wait)
 *   from the email link   "Yes, send me alerts" (the button confirms; opening the page does not)
 *   after confirming      "You're in."
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const pool = db();
  const box = "mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 py-12";

  if (q.done) {
    return (
      <Shell>
        <section className={`${box} items-center text-center`}>
          <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-good-bg text-3xl font-extrabold text-good">✓</span>
          <h1 className="m-0 text-[34px] font-extrabold tracking-[-0.03em]">You&apos;re in.</h1>
          <p className="m-0 text-lg text-ink-2">
            Your alerts are on, and you&apos;re signed in. The free pick arrives on trading mornings between 8:00 and 9:30 AM ET.
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Link href="/my-stocks" className="btn btn-dark btn-lg">See my stocks</Link>
            <Link href="/news" className="btn btn-outline btn-lg">Back to live news</Link>
          </div>
        </section>
      </Shell>
    );
  }

  if (q.token) {
    const view = await peekConfirmation(pool, q.token).catch(() => null);
    const names = view?.waiting.map((w) => (w.cik === null ? "the free daily pick" : w.ticker ? `$${w.ticker}` : w.company ?? "a company")) ?? [];
    return (
      <Shell>
        <section className={`${box} items-center text-center`}>
          {view && view.waiting.length > 0 ? (
            <>
              <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">Send alerts to {maskEmail(view.email)}?</h1>
              <p className="m-0 text-lg text-ink-2">You asked for {names.slice(0, 6).join(", ")}{names.length > 6 ? ` and ${names.length - 6} more` : ""}.</p>
              <form method="post" action="/api/confirm">
                <input type="hidden" name="token" value={q.token} />
                <button type="submit" autoFocus className="btn btn-brand btn-lg h-14 px-8 text-[17px]">Yes, send me alerts</button>
              </form>
              <p className="fine m-0">Free. Unsubscribe any time with one click. Not investment advice.</p>
            </>
          ) : view?.alreadyConfirmed ? (
            <>
              <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">You&apos;re already confirmed</h1>
              <p className="m-0 text-lg text-ink-2">Your alerts are on. Nothing more to do.</p>
              <Link href="/news" className="btn btn-dark btn-lg">Go to live news</Link>
            </>
          ) : (
            <>
              <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">That link didn&apos;t work</h1>
              <p className="m-0 text-lg text-ink-2">It may have been used already, or copied incompletely. Sign up again and we&apos;ll send a fresh one.</p>
              <Link href="/#pick" className="btn btn-dark btn-lg">Sign up again</Link>
            </>
          )}
        </section>
      </Shell>
    );
  }

  const waiting = await pendingSignup();
  const popular = waiting ? await trendingCompanies(pool, 6).catch(() => []) : [];
  const popularCiks = popular.length
    ? (await pool.query<{ ticker: string; cik: string }>(`select ticker, cik::text as cik from public.companies where ticker = any($1::text[])`, [popular.map((p) => p.ticker)]).catch(() => ({ rows: [] }))).rows
    : [];
  return (
    <Shell>
      <section className={box}>
        {q.problem && (
          <p role="alert" className="m-0 rounded-xl bg-amber-bg px-4 py-3 text-sm text-amber">
            That confirmation link didn&apos;t work. It may have been used already. If your alerts aren&apos;t arriving, sign up again.
          </p>
        )}
        {waiting ? (
          <>
            <h1 className="m-0 text-[34px] font-extrabold leading-[1.1] tracking-[-0.03em]">Almost done. Confirm and you&apos;re in.</h1>
            <p className="m-0 text-lg text-ink-2">We only send alerts after you confirm, so nobody can sign you up by mistake.</p>
            <div className="card-mint flex flex-col gap-2 p-5 md:p-6">
              <span className="eyebrow">One step · Email</span>
              <h2 className="m-0 text-[22px] font-extrabold">Click the link we sent to {maskEmail(waiting.email)}</h2>
              <p className="m-0 text-[15px] text-ink-2">The email is from BigStocks, with the subject “Confirm your free BigStocks alerts”.</p>
            </div>
            <ConfirmWait batch={waiting.batch} email={waiting.email}
              popular={popularCiks.map((p) => ({ cik: Number(p.cik), ticker: p.ticker }))} />
            <p className="m-0 text-[15px] text-ink-2">
              Wrong address? <Link href="/#pick" className="font-bold">Sign up again</Link>. <Link href="/news" className="font-bold">Back to live news →</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="m-0 text-[34px] font-extrabold tracking-[-0.03em]">Check your inbox</h1>
            <p className="m-0 text-lg text-ink-2">If you just signed up, click the link in the email from BigStocks to switch your alerts on.</p>
            <Link href="/#pick" className="btn btn-dark btn-lg self-start">Sign up for free alerts</Link>
          </>
        )}
      </section>
    </Shell>
  );
}
