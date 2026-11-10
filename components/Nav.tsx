"use client";
import { useEffect, useState } from "react";
import { nav } from "@/lib/site";
import { SmartLink } from "./SmartLink";
import { Wordmark } from "./Wordmark";
import { Close, Menu, Search } from "./Icons";
import { FeedSearch } from "./FeedSearch";
import { BellButton } from "./BellButton";
import { openAlerts } from "./AlertsDialog";

export function Nav() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!search) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSearch(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [search]);

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        scrolled || open || search ? "border-b border-line bg-bg/80 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <div className="container-wide flex h-[68px] items-center justify-between gap-6">
        <a href="/" aria-label="BigStocks home"><Wordmark /></a>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {nav.map((n) => (
            <SmartLink key={n.label} href={n.href}
              className="rounded-full px-3.5 py-2 text-[14px] text-muted transition-colors hover:bg-white/[0.04] hover:text-ink">
              {n.label}
            </SmartLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setSearch((v) => !v); setOpen(false); }}
            aria-expanded={search} aria-controls="nav-search" aria-label={search ? "Close search" : "Search news by ticker"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line-strong text-muted transition-colors hover:text-ink">
            {search ? <Close className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </button>
          <BellButton variant="icon" source="nav-bell" />
          <button type="button" onClick={() => openAlerts({ source: "nav" })} className="btn-primary hidden !h-10 !px-5 !text-[14px] sm:inline-flex">Get free alerts</button>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line-strong lg:hidden"
            aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => { setOpen((o) => !o); setSearch(false); }}
          >
            {open ? <Close /> : <Menu />}
          </button>
        </div>
      </div>

      {search && (
        <div id="nav-search" className="container-wide pb-4">
          <div className="ml-auto max-w-[520px]">
            <FeedSearch size="sm" autoFocus placeholder="Ticker (AAPL) or keyword" onDone={() => setSearch(false)} />
          </div>
        </div>
      )}

      {open && (
        <nav id="mobile-menu" aria-label="Mobile" className="container-wide grid gap-1 pb-5 lg:hidden">
          {nav.map((n) => (
            <SmartLink key={n.label} href={n.href} onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-[15px] text-ink hover:bg-white/[0.04]">
              {n.label}
            </SmartLink>
          ))}
          <button type="button" onClick={() => { setOpen(false); openAlerts({ source: "nav-mobile" }); }} className="btn-primary mt-2">Get free alerts</button>
        </nav>
      )}
    </header>
  );
}
