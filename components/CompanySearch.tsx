"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Company } from "@/lib/search/companies";
import { companyDirectoryQuery } from "@/lib/search/queries";
import { Search } from "./Icons";

export function CompanySearch({
  value, onChange, onSelect, onSubmit, onClear, autoFocus = false, size = "lg",
  placeholder = "Ticker, company or keyword", label = "Search ticker, company or keyword",
  submitLabel = "Search", keywordAction = true, className = "",
}: {
  value: string; onChange: (value: string) => void; onSelect: (company: Company) => void;
  onSubmit: (query: string, keywordOnly?: boolean) => void; onClear?: () => void; autoFocus?: boolean;
  size?: "sm" | "lg"; placeholder?: string; label?: string; submitLabel?: string;
  keywordAction?: boolean; className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const directory = useQuery({ ...companyDirectoryQuery, enabled: open });
  const hits = directory.data?.search(value) ?? [];
  const visible = open && Boolean(value.trim());
  const sm = size === "sm";
  const activeId = selected >= 0
    ? hits[selected] ? `${id}-${hits[selected].ticker}` : keywordAction && selected === hits.length ? `${id}-keyword` : undefined
    : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  useLayoutEffect(() => {
    if (!visible) return;
    function place() {
      if (!form.current) return;
      const rect = form.current.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const upwards = below < 240 && above > below;
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        maxHeight: Math.min(360, Math.max(80, upwards ? above : below)),
      });
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !form.current?.contains(event.target) && !popup.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [visible]);

  function choose(company: Company) {
    setOpen(false);
    setSelected(-1);
    onSelect(company);
  }

  function submit(keywordOnly = false) {
    setOpen(false);
    setSelected(-1);
    onSubmit(value.trim(), keywordOnly);
  }

  return (
    <form ref={form} role="search" onSubmit={(event) => {
      event.preventDefault();
      if (visible && selected >= 0 && hits[selected]) choose(hits[selected]);
      else if (visible && keywordAction && selected === hits.length) submit(true);
      else submit();
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget)) setOpen(false);
    }} className={`flex w-full items-center rounded-full border border-line-strong bg-surface focus-within:border-brand/60 ${sm ? "h-11 gap-2.5 pl-4 pr-1.5" : "h-14 gap-3 pl-5 pr-1.5"} ${className}`}>
      <Search className={`shrink-0 text-faint ${sm ? "h-4 w-4" : "h-5 w-5"}`} />
      <label htmlFor={id} className="sr-only">{label}</label>
      <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={visible}
        aria-controls={visible ? `${id}-list` : undefined}
        aria-activedescendant={visible ? activeId : undefined}
        aria-describedby={visible ? `${id}-status` : undefined}
        value={value} onChange={(event) => { onChange(event.target.value.slice(0, 80)); setSelected(-1); setOpen(true); }}
        onFocus={() => setOpen(true)} autoFocus={autoFocus} placeholder={placeholder}
        autoComplete="off" spellCheck={false} maxLength={80}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); setSelected(-1); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setSelected((current) => event.key === "ArrowDown" ? Math.min(current + 1, hits.length - (keywordAction ? 0 : 1)) : Math.max(current - 1, -1));
          }
        }}
        className={`min-w-0 flex-1 bg-transparent text-ink placeholder:text-faint focus:outline-none ${sm ? "text-[14px]" : "text-[16px]"}`} />
      {onClear && value && <button type="button" onClick={() => { setOpen(false); setSelected(-1); onClear(); input.current?.focus(); }}
        className="text-[12px] text-faint hover:text-ink">Clear</button>}
      <button type="submit" className={`btn-primary ${sm ? "!h-8 !px-3.5 !text-[13px]" : "!h-11 !px-5 !text-[14.5px]"}`}>{submitLabel}</button>
      {visible && position && createPortal(
        <div ref={popup} style={position} className="fixed z-[100] overflow-y-auto rounded-2xl border border-line-strong bg-surface p-1.5 shadow-2xl"
          onMouseDown={(event) => event.preventDefault()}>
          <div id={`${id}-status`} role="status" className="px-3 py-2 text-[12px] text-muted">
            {directory.isPending ? <span className="skeleton block h-4 w-40">Loading companies...</span>
              : directory.isError ? <>Company suggestions unavailable. <button type="button" onClick={() => void directory.refetch()} className="text-brand underline">Retry</button></>
              : directory.data?.stale ? <>Using the last available company directory. <button type="button" onClick={() => void directory.refetch()} className="text-brand underline">Retry</button></>
              : `${hits.length ? "Company suggestions" : "No matching companies"}${directory.isFetching ? " (updating...)" : ""}`}
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label="Companies">
            {hits.map((company, index) => (
              <li key={company.ticker} id={`${id}-${company.ticker}`} role="option" aria-selected={selected === index}>
                <button type="button" tabIndex={-1} onClick={() => choose(company)} onMouseEnter={() => setSelected(index)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${selected === index ? "bg-brand/10" : "hover:bg-white/[0.04]"}`}>
                  <span className="w-16 shrink-0 font-mono text-[13px] text-brand">{company.ticker}</span>
                  <span className="min-w-0 flex-1 text-[13px] text-ink">{company.name}</span>
                  <span className="shrink-0 text-[11px] text-faint">{company.exchange ?? "-"}</span>
                </button>
              </li>
            ))}
            {keywordAction && <li id={`${id}-keyword`} role="option" aria-selected={selected === hits.length}>
              <button type="button" tabIndex={-1} onClick={() => submit(true)} onMouseEnter={() => setSelected(hits.length)}
                className={`mt-1 w-full rounded-xl border-t border-line px-3 py-3 text-left text-[13px] text-brand ${selected === hits.length ? "bg-brand/10" : ""}`}>
                Search headlines for &quot;{value.trim()}&quot;
              </button>
            </li>}
          </ul>
        </div>, document.body,
      )}
    </form>
  );
}
