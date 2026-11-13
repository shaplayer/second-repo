import { parseCompanyDirectory, type Company, type CompanyDirectory } from "../search/companies";
import { SEC_TICKERS_EXCHANGE_URL } from "../sec/companies";

let cache: { companies: Company[]; expiresAt: number } | undefined;
let pending: Promise<CompanyDirectory> | undefined;
let failure: { error: unknown; retryAt: number } | undefined;

async function download(): Promise<Company[]> {
  const response = await fetch(SEC_TICKERS_EXCHANGE_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`SEC company directory request failed (${response.status}).`);
  return parseCompanyDirectory(await response.json());
}

/** Server-only: one upstream request per refresh, shared by concurrent API callers. */
export async function getCompanyDirectory(): Promise<CompanyDirectory> {
  if (cache && cache.expiresAt > Date.now()) return { companies: cache.companies, stale: false };
  if (failure && failure.retryAt > Date.now()) {
    if (cache) return { companies: cache.companies, stale: true };
    throw failure.error;
  }
  if (!pending) {
    pending = download()
      .then((companies) => {
        cache = { companies, expiresAt: Date.now() + 5 * 60 * 1000 };
        failure = undefined;
        return { companies, stale: false };
      })
      .catch((error: unknown) => {
        failure = { error, retryAt: Date.now() + 60_000 };
        if (!cache) throw error;
        console.warn("[search] SEC directory refresh failed; serving stale companies:", error instanceof Error ? error.message : error);
        return { companies: cache.companies, stale: true };
      })
      .finally(() => { pending = undefined; });
  }
  return pending;
}
