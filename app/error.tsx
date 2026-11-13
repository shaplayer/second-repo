"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Shown when a page fails to render. A client component, so it cannot use the server-only <Shell>:
 * it carries its own small frame. The error's details go to the browser console, never onto the page.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page flex flex-col">
      <header className="mx-auto flex w-full max-w-[1200px] items-center px-4 py-4 md:px-8">
        <Link href="/" className="text-[22px] font-extrabold tracking-[-0.02em] text-ink no-underline hover:text-ink">BigStocks</Link>
      </header>
      <main id="main" className="flex-1">
        <section aria-labelledby="err-h" className="wrap-narrow flex flex-col items-center gap-3.5 pb-14 pt-10 text-center md:pt-12">
          <h1 id="err-h" className="m-0 text-[28px] font-extrabold tracking-[-0.03em] md:text-[34px]">Something went wrong on our side</h1>
          <p className="m-0 text-base text-ink-2">The page didn&apos;t load. Your alerts are not affected.</p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button type="button" onClick={() => reset()} className="btn btn-dark btn-lg">Try again</button>
            <Link href="/news" className="btn btn-soft btn-lg">Live news</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
