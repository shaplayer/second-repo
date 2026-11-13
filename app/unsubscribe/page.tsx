import type { Metadata } from "next";
import Link from "next/link";
import { UnsubscribeForm } from "@/components/account/AccountForms";
import { Shell } from "@/components/site/Shell";
import { peekUnsubscribe } from "@/lib/alerts/subscriptions";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

type Option = { scope: "this" | "stocks" | "picks" | "all"; title: string; detail: string };

/** The link in every email lands here. Nothing changes until the person confirms what to stop. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const view = await peekUnsubscribe(db(), token).catch(() => null);
  const name = (s: { cik: number | null; ticker: string | null; company: string | null }) =>
    s.cik === null ? "the free daily pick" : s.ticker ? `$${s.ticker}` : s.company ?? "this company";

  const options: Option[] = [];
  if (view) {
    const matched = view.matched.filter((m) => view.all.some((a) => a.id === m.id));
    const stocks = view.all.filter((a) => a.cik !== null);
    const picks = view.all.some((a) => a.cik === null);
    if (matched.length === 1 && view.all.length > 1) {
      options.push({ scope: "this", title: `Stop ${name(matched[0])}`, detail: matched[0].cik === null ? "Keep your stock alerts." : "Keep everything else." });
    }
    if (stocks.length > 1 || (stocks.length === 1 && picks && matched[0]?.cik === null)) {
      options.push({ scope: "stocks", title: "Stop all stock alerts", detail: `${stocks.length} ${stocks.length === 1 ? "stock" : "stocks"}. Keep the free daily pick.` });
    }
    if (picks && stocks.length > 0 && matched[0]?.cik !== null) options.push({ scope: "picks", title: "Stop the free daily pick", detail: "Keep your stock alerts." });
    options.push({ scope: "all", title: "Unsubscribe from everything", detail: "No more email from BigStocks." });
  }

  return (
    <Shell>
      <section className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-12">
        {view && view.all.length > 0 ? (
          <>
            <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">Unsubscribe {view.email}?</h1>
            <p className="m-0 text-base text-ink-2">Choose what to stop. Nothing changes until you confirm.</p>
            <UnsubscribeForm token={token} options={options} />
          </>
        ) : view ? (
          <>
            <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">You&apos;re already unsubscribed</h1>
            <p className="m-0 text-base text-ink-2">{view.email} gets no email from BigStocks.</p>
            <Link href="/news" className="btn btn-dark btn-lg self-start">Go to live news</Link>
          </>
        ) : (
          <>
            <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">We couldn&apos;t read that link</h1>
            <p className="m-0 text-base text-ink-2">
              Use the “Unsubscribe” link at the bottom of any BigStocks email, or sign in and switch everything off under Alert settings.
            </p>
            <Link href="/sign-in?next=/settings" className="btn btn-dark btn-lg self-start">Sign in to manage alerts</Link>
          </>
        )}
      </section>
    </Shell>
  );
}
