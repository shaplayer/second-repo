"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

type Suggestion = {
  cik: number;
  ticker: string;
  name: string;
  exchange: string | null;
};

type TickerSearchProps = {
  id: string;
  label: string;
  placeholder: string;
  formClassName: string;
  inputClassName: string;
  action: string;
  required?: boolean;
  leading?: ReactNode;
  button?: { className: string; content: ReactNode };
};

export function TickerSearch({
  id, label, placeholder, formClassName, inputClassName, action, required, leading, button,
}: TickerSearchProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = input.trim().slice(0, 60);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const matches = useQuery({
    queryKey: ["company-search", query],
    queryFn: async ({ signal }): Promise<Suggestion[]> => {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
      if (!response.ok) throw new Error("Company search failed");
      const data: { companies: Suggestion[] } = await response.json();
      return data.companies;
    },
    enabled: open && query.length > 0 && query === debounced,
    staleTime: 60_000,
    retry: false,
  });

  const waiting = open && !!query && (query !== debounced || matches.isFetching);
  const companies = open && query === debounced && !matches.isError ? matches.data ?? [] : [];
  const listId = `${id}-suggestions`;
  const expanded = companies.length > 0;

  function choose(company: Suggestion) {
    setOpen(false);
    setActive(-1);
    router.push(`/stock/${encodeURIComponent(company.ticker)}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!query) return;
      event.preventDefault();
      setOpen(true);
      if (companies.length) {
        setActive((previous) => event.key === "ArrowDown"
          ? (previous + 1) % companies.length
          : (previous <= 0 ? companies.length - 1 : previous - 1));
      }
    } else if (event.key === "Enter" && open && companies[active]) {
      event.preventDefault();
      choose(companies[active]);
    }
  }

  return (
    <form role="search" aria-label={label} action={action} method="get" className={`relative ${formClassName}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActive(-1);
        }
      }}>
      <label htmlFor={id} className="sr-only">{label}</label>
      {leading}
      <input id={id} name="q" type="search" placeholder={placeholder} autoComplete="off" required={required}
        role="combobox" aria-autocomplete="list" aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 && active < companies.length ? `${listId}-${active}` : undefined}
        value={input} onChange={(event) => { setInput(event.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
        className={`min-w-0 flex-1 border-0 bg-transparent outline-none ${inputClassName}`} />
      {button && <button type="submit" className={button.className}>{button.content}</button>}
      {open && query && (
        <div className="card absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-2xl text-left shadow-[0_16px_40px_rgba(12,60,35,0.12),0_0_0_1px_#dfe9e3]">
          {expanded && (
            <ul id={listId} role="listbox" aria-label="Company suggestions" className="m-0 list-none p-1">
              {companies.map((company, index) => (
                <li key={company.cik} id={`${listId}-${index}`} role="option" aria-selected={index === active}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink ${index === active ? "bg-chip" : "hover:bg-inset"}`}
                  onPointerDown={(event) => event.preventDefault()} onClick={() => choose(company)}>
                  <strong className="shrink-0">{company.ticker}</strong>
                  <span className="min-w-0 flex-1 truncate">{company.name}</span>
                  {company.exchange && <span className="shrink-0 text-muted">{company.exchange}</span>}
                </li>
              ))}
            </ul>
          )}
          <div role="status" aria-live="polite" className={expanded ? "sr-only" : "px-4 py-3 text-sm text-ink-2"}>
            {waiting ? "Searching companies..." : matches.isError && query === debounced
              ? "Could not load companies. You can still submit your search."
              : expanded ? `${companies.length} company suggestions available.`
              : "No companies found. You can still submit your search."}
          </div>
        </div>
      )}
    </form>
  );
}
