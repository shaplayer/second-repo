"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveCompanyTicker } from "@/lib/search/companies";
import { companyDirectoryQuery } from "@/lib/search/queries";
import { CompanySearch } from "./CompanySearch";

/**
 * Company selections and explicit "$" tickers open the ticker page.
 * Free text searches headlines on the given page.
 * size="lg": news pages. size="sm": the small search bubble in the hero and top menu.
 */
export function FeedSearch({ base = "/news", defaultValue = "", autoFocus = false, size = "lg", placeholder, onDone }: {
  base?: string; defaultValue?: string; autoFocus?: boolean; size?: "lg" | "sm"; placeholder?: string; onDone?: () => void;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [v, setV] = useState(defaultValue);

  function go(s: string, keywordOnly = false) {
    onDone?.();
    if (!s) return router.push(base);
    const ticker = keywordOnly ? null : resolveCompanyTicker(s, client.getQueryData(companyDirectoryQuery.queryKey));
    if (ticker) {
      router.push(`/news/${encodeURIComponent(ticker)}`);
    } else {
      router.push(`${base}?q=${encodeURIComponent(s)}`);
    }
  }

  return (
    <CompanySearch value={v} onChange={setV} onSubmit={go} size={size} autoFocus={autoFocus}
      placeholder={placeholder} submitLabel={size === "sm" ? "Go" : "Search"}
      onSelect={(company) => { onDone?.(); router.push(`/news/${encodeURIComponent(company.ticker)}`); }} />
  );
}
