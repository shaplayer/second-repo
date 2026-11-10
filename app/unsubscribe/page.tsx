import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/sections/Footer";
import { db, hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe | BigStocks", robots: { index: false } };

/** Unsubscribe from BigStocks alert emails (the link at the bottom of every alert email). */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string; done?: string }> }) {
  const { t = "", done } = await searchParams;
  let sub: { email: string; general_alerts: boolean } | null = null;
  if (hasDb() && /^[a-f0-9]{32}$/.test(t)) {
    sub = (await db().query(`SELECT email, general_alerts FROM subscribers WHERE unsub_token = $1 AND email IS NOT NULL`, [t])).rows[0] ?? null;
  }
  return (
    <>
      <Nav />
      <main className="container-wide flex min-h-[60vh] max-w-xl flex-col items-center justify-center py-20 text-center">
        {!sub ? (
          <>
            <h1 className="text-[30px] font-semibold tracking-tight">This link isn&apos;t valid</h1>
            <p className="mt-3 text-muted">Reply to any BigStocks email and we&apos;ll unsubscribe you.</p>
          </>
        ) : done || !sub.general_alerts ? (
          <>
            <p className="eyebrow justify-center">Unsubscribed</p>
            <h1 className="mt-3 text-[30px] font-semibold tracking-tight">You won&apos;t get BigStocks alert emails anymore.</h1>
            <p className="mt-3 text-muted">{sub.email} is off the list. Companies you follow with the bell have their own unsubscribe links.</p>
            <Link href="/" className="btn-ghost mt-8">Back to BigStocks</Link>
          </>
        ) : (
          <>
            <h1 className="text-[30px] font-semibold tracking-tight">Stop BigStocks alert emails?</h1>
            <p className="mt-3 text-muted">{sub.email} will no longer get stock alert emails.</p>
            <form method="post" action={`/api/unsubscribe?t=${encodeURIComponent(t)}`} className="mt-8">
              <button type="submit" className="btn-primary">Unsubscribe</button>
            </form>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
