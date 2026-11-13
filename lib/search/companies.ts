import MiniSearch from "minisearch";
import { normalizeTicker, parseTickerFile } from "../sec/companies";

export type Company = { cik: number; ticker: string; name: string; exchange: string | null };
export type CompanyDirectory = { companies: Company[]; stale: boolean };

function isCompany(value: unknown): value is Company {
  return typeof value === "object" && value !== null
    && "cik" in value && typeof value.cik === "number" && Number.isSafeInteger(value.cik) && value.cik > 0
    && "ticker" in value && typeof value.ticker === "string" && normalizeTicker(value.ticker) === value.ticker
    && "name" in value && typeof value.name === "string" && Boolean(value.name.trim())
    && "exchange" in value && (value.exchange === null || typeof value.exchange === "string");
}

export function parseCompanyResponse(json: unknown): CompanyDirectory {
  if (typeof json !== "object" || json === null
    || !("companies" in json) || !Array.isArray(json.companies) || !json.companies.length
    || !json.companies.every(isCompany) || !("stale" in json) || typeof json.stale !== "boolean") {
    throw new Error("Invalid company directory response.");
  }
  return { companies: json.companies, stale: json.stale };
}

export function parseCompanyDirectory(json: unknown): Company[] {
  const parsed = parseTickerFile(json);
  if (parsed.skipped.length) {
    console.warn(`[search] Skipped ${parsed.skipped.length} invalid or duplicate SEC directory rows.`);
  }
  if (!parsed.tickers.length) throw new Error("The company directory contains no valid tickers.");
  return parsed.tickers.map(({ cik, ticker, name, exchange }) => ({ cik, ticker, name, exchange }));
}

export function createCompanySearch(companies: Company[]) {
  const byTicker = new Map(companies.map((company) => [company.ticker, company]));
  const index = new MiniSearch<Company>({
    idField: "ticker",
    fields: ["ticker", "name"],
    searchOptions: {
      boost: { ticker: 4 },
      prefix: true,
      fuzzy: (term) => term.length >= 4 ? 0.2 : false,
      combineWith: "AND",
    },
  });
  index.addAll(companies);

  const exact = (query: string) => {
    const ticker = normalizeTicker(query);
    return ticker ? byTicker.get(ticker) : undefined;
  };

  return {
    exact,
    search(query: string): Company[] {
      const term = query.trim().replace(/^\$/, "");
      if (!term) return [];
      const first = exact(term);
      const hits = index.search(term.replace(/-/g, "."));
      const matches: Company[] = first ? [first] : [];
      for (const hit of hits) {
        const company = byTicker.get(String(hit.id));
        if (company && company.ticker !== first?.ticker) matches.push(company);
        if (matches.length >= 8) break;
      }
      return matches;
    },
  };
}

export function resolveCompanyTicker(query: string, directory?: ReturnType<typeof createCompanySearch>): string | null {
  const known = directory?.exact(query);
  if (known) return known.ticker;
  return query.trim().startsWith("$") ? normalizeTicker(query) : null;
}
