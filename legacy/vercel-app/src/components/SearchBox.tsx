"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Hit = { ticker: string; name: string; exchange: string };

export default function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) return setHits([]);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((h: Hit[]) => {
          setHits(h);
          setSel(0);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (ticker: string) => {
    setOpen(false);
    setQ("");
    router.push(`/stock/${encodeURIComponent(ticker)}`);
  };

  return (
    <form
      ref={box}
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const pick = hits[sel]?.ticker ?? q.trim().toUpperCase().replace(/^\$/, "");
        if (pick) go(pick);
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        id="stock-search"
        value={q}
        autoComplete="off"
        placeholder="Search a stock: AAPL, Tesla, JPMorgan…"
        aria-label="Search for a stock by ticker or company name"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="search-suggest"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && hits.length > 0 && (
        <ul className="suggest" id="search-suggest" role="listbox">
          {hits.map((h, i) => (
            <li key={h.ticker}>
              <button type="button" role="option" aria-selected={i === sel} onClick={() => go(h.ticker)} onMouseEnter={() => setSel(i)}>
                <span className="tick">{h.ticker}</span>
                <span className="name">{h.name}</span>
                <span className="small muted">{h.exchange}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
