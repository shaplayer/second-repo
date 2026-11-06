"use client";
import { useEffect, useState } from "react";
import { nav, links } from "@/lib/site";
import { SmartLink } from "./SmartLink";
import { Wordmark } from "./Wordmark";
import { Close, Menu } from "./Icons";

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        scrolled || open ? "border-b border-line bg-bg/80 backdrop-blur-xl" : "border-b border-transparent"
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
          <a href={links.signup} className="btn-primary hidden !h-10 !px-5 !text-[14px] sm:inline-flex">Get free alerts</a>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line-strong lg:hidden"
            aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <Close /> : <Menu />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-menu" aria-label="Mobile" className="container-wide grid gap-1 pb-5 lg:hidden">
          {nav.map((n) => (
            <SmartLink key={n.label} href={n.href} onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-[15px] text-ink hover:bg-white/[0.04]">
              {n.label}
            </SmartLink>
          ))}
          <a href={links.signup} onClick={() => setOpen(false)} className="btn-primary mt-2">Get free alerts</a>
        </nav>
      )}
    </header>
  );
}
