import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/site/Shell";

export const metadata: Metadata = { title: "Page not found", description: "We couldn't find that page. Try searching for a stock instead." };

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/news", label: "Live news" },
  { href: "/picks", label: "Free picks" },
];

export default function NotFound() {
  return (
    <Shell>
      <section aria-labelledby="ns-h" className="wrap-narrow flex max-w-[760px] flex-col items-center gap-3.5 pb-14 pt-10 text-center md:pt-12">
        <span aria-hidden="true" className="text-[56px] font-extrabold leading-none tracking-[-0.05em] text-[#cfe9da] md:text-[72px]">404</span>
        <h1 id="ns-h" className="m-0 text-[28px] font-extrabold tracking-[-0.03em] md:text-[34px]">We couldn&apos;t find that page</h1>
        <p className="m-0 text-base text-ink-2">It may have moved. Try a stock instead:</p>
        <form role="search" action="/search" className="flex w-full max-w-[520px] gap-2 rounded-[20px] bg-white p-2 shadow-[0_16px_40px_rgba(12,60,35,0.12),0_0_0_1px_#dfe9e3]">
          <label htmlFor="ns-q" className="sr-only">Search a stock</label>
          <input id="ns-q" name="q" type="search" required placeholder="Ticker or company" autoComplete="off"
            className="h-[50px] min-w-0 flex-1 border-0 bg-transparent px-3 text-[17px] outline-none" />
          <button type="submit" className="btn btn-brand h-[50px] rounded-[14px] px-5 text-base font-extrabold">Search</button>
        </form>
        <div className="flex flex-wrap justify-center gap-2">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="btn btn-soft px-4 text-base">{l.label}</Link>
          ))}
        </div>
      </section>
    </Shell>
  );
}
