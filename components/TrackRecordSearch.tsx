"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { normalizeTicker } from "@/lib/sec/companies";
import { companyDirectoryQuery } from "@/lib/search/queries";
import { CompanySearch } from "./CompanySearch";

export function TrackRecordSearch({ ticker, baseHref }: { ticker: string; baseHref: string }) {
  const [value, setValue] = useState(ticker);
  const [error, setError] = useState("");
  const router = useRouter();
  const client = useQueryClient();

  function apply(ticker: string | null) {
    const [path, query] = baseHref.split("?");
    const params = new URLSearchParams(query);
    if (ticker) params.set("ticker", ticker);
    const suffix = params.toString();
    router.push(suffix ? `${path}?${suffix}` : path);
    setError("");
  }

  return (
    <div className="w-full sm:w-80">
      <CompanySearch value={value} onChange={(next) => { setValue(next); setError(""); }}
        onSelect={(company) => { setValue(company.ticker); apply(company.ticker); }}
        onSubmit={(text) => {
          if (!text) return apply(null);
          const known = client.getQueryData(companyDirectoryQuery.queryKey)?.exact(text);
          const ticker = known?.ticker ?? normalizeTicker(text);
          if (!ticker) { setError("Choose a company suggestion or enter a ticker."); return; }
          apply(ticker);
        }} onClear={() => { setValue(""); apply(null); }} size="sm" keywordAction={false}
        placeholder="Ticker or company" label="Filter alerts by ticker or company" submitLabel="Go" />
      {error && <p role="alert" className="mt-2 text-[13px] text-down">{error}</p>}
    </div>
  );
}
