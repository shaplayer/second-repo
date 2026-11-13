import Link from "next/link";
import { currentUser } from "@/lib/web/request";
import { SearchIcon } from "@/components/ui/Icons";

const linkCls = "text-ink-2 no-underline hover:text-ink";

/**
 * The top of every page. Inner pages carry a small search box; the homepage has its own big one, so
 * it passes `search={false}`.
 */
export async function Header({ search = true }: { search?: boolean }) {
  const user = await currentUser();
  const links = [
    { href: "/news", label: "Live news" },
    { href: "/picks", label: "Free picks" },
    { href: "/health-check", label: "Health check" },
    user ? { href: "/my-stocks", label: "My stocks" } : { href: "/sign-in", label: "Sign in" },
  ];
  return (
    <header className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 md:px-8">
      <Link href="/" className="text-[22px] font-extrabold tracking-[-0.02em] text-ink no-underline hover:text-ink">
        BigStocks
      </Link>
      {search && (
        <form role="search" action="/search" className="order-3 flex h-[46px] w-full items-center gap-2 rounded-[14px] bg-white pl-3.5 pr-1.5 shadow-[0_0_0_1px_#dfe9e3] md:order-none md:w-auto md:max-w-[440px] md:flex-1">
          <label htmlFor="hd-q" className="sr-only">Search a stock</label>
          <SearchIcon className="h-[18px] w-[18px] flex-none text-ink-2" />
          <input id="hd-q" name="q" type="search" placeholder="Search a stock" autoComplete="off"
            className="h-10 min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none" />
        </form>
      )}
      <nav aria-label="Main" className="ml-auto hidden items-center gap-x-5 text-[15px] font-semibold md:flex">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={linkCls}>{l.label}</Link>
        ))}
        <Link href={user ? "/settings" : "/#pick"} className="btn btn-dark text-[15px]">{user ? "Alert settings" : "Get free alerts"}</Link>
      </nav>
      {/* Phones: one clear button and a menu that needs no script. */}
      <div className="ml-auto flex items-center gap-1.5 md:hidden">
        <Link href={user ? "/my-stocks" : "/#pick"} className="btn btn-dark">{user ? "My stocks" : "Free alerts"}</Link>
        <details className="relative">
          <summary aria-label="Menu" className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-[#d7dfda] bg-white [&::-webkit-details-marker]:hidden">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </summary>
          <nav aria-label="Menu" className="card absolute right-0 top-12 z-20 flex w-56 flex-col p-2 text-[15px] font-semibold shadow-[0_14px_36px_rgba(12,60,35,0.14),0_0_0_1px_#dfe9e3]">
            {[...links, ...(user ? [{ href: "/settings", label: "Alert settings" }] : [])].map((l) => (
              <Link key={l.href} href={l.href} className="rounded-xl px-3 py-3 text-ink no-underline hover:bg-chip">{l.label}</Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
