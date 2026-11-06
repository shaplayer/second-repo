import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/sections/Footer";
import { db, hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe | BigStocks", robots: { index: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string; done?: string }> }) {
  const { t = "", done } = await searchParams;
  let follow: { ticker: string; unsubscribed_at: Date | null } | null = null;
  if (hasDb() && /^[A-Za-z0-9_-]{20,64}$/.test(t)) {
    follow = (await db().query(`SELECT ticker, unsubscribed_at FROM ticker_follows WHERE token = $1 AND channel = 'email'`, [t])).rows[0] ?? null;
  }
  return (
    <>
      <Nav />
      <main className="container-wide flex min-h-[60vh] max-w-xl flex-col items-center justify-center py-20 text-center">
        {!follow ? (
          <>
            <h1 className="text-[30px] font-semibold tracking-tight">This link isn&apos;t valid</h1>
            <p className="mt-3 text-muted">It may have expired. Reply to any BigStocks email and we&apos;ll unsubscribe you.</p>
          </>
        ) : done || follow.unsubscribed_at ? (
          <>
            <p className="eyebrow justify-center">Unsubscribed</p>
            <h1 className="mt-3 text-[30px] font-semibold tracking-tight">You won&apos;t get <span className="font-mono">${follow.ticker}</span> emails anymore.</h1>
            <p className="mt-3 text-muted">Changed your mind? Follow it again any time from its page.</p>
            <Link href={`/news/${follow.ticker}`} className="btn-ghost mt-8">Go to ${follow.ticker}</Link>
          </>
        ) : (
          <>
            <h1 className="text-[30px] font-semibold tracking-tight">Stop <span className="font-mono">${follow.ticker}</span> emails?</h1>
            <p className="mt-3 text-muted">You&apos;ll no longer get emails about ${follow.ticker} news, filings or alerts.</p>
            <form method="post" action={`/api/follow/unsubscribe?t=${encodeURIComponent(t)}`} className="mt-8">
              <button type="submit" className="btn-primary">Unsubscribe</button>
            </form>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
