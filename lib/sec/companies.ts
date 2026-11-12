/**
 * The SEC's list of every company with a ticker (company_tickers_exchange.json), turned into rows for
 * the companies and company_tickers tables. Pure functions: no network, no database.
 */

export const SEC_TICKERS_EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json";

export type SecTickerFile = { fields: string[]; data: unknown[][] };

export type TickerRow = { ticker: string; cik: number; name: string; exchange: string | null; isPrimary: boolean; tvSymbol: string | null };
export type ParsedCompanies = {
  /** One entry per ticker. The first ticker listed for a company is its main one. */
  tickers: TickerRow[];
  companies: number;
  skipped: { reason: string; row: unknown }[];
};

const TICKER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;

/** "brk-b" -> "BRK.B". Returns null for anything that is not a plain ticker. */
export function normalizeTicker(raw: unknown): string | null {
  const t = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/^\$/, "")
    .replace(/-/g, ".");
  return TICKER_RE.test(t) ? t : null;
}

/**
 * The symbol handed to TradingView widgets.
 * The SEC file says "NYSE" for NYSE, NYSE American and NYSE Arca alike, and TradingView uses a
 * different prefix for each, so NYSE tickers are passed without a prefix and TradingView picks the
 * listing. Nasdaq and OTC are unambiguous.
 */
export function tvSymbol(ticker: string, exchange: string | null): string | null {
  switch ((exchange ?? "").toLowerCase()) {
    case "nasdaq":
      return `NASDAQ:${ticker}`;
    case "otc":
      return `OTC:${ticker}`;
    case "nyse":
    case "cboe":
      return ticker;
    default:
      return null;
  }
}

export function parseTickerFile(json: unknown): ParsedCompanies {
  const file = json as Partial<SecTickerFile>;
  if (!file || !Array.isArray(file.fields) || !Array.isArray(file.data)) {
    throw new Error("Not the SEC ticker file: expected an object with fields and data");
  }
  const col = (name: string) => {
    const i = file.fields!.indexOf(name);
    if (i < 0) throw new Error(`The SEC ticker file has no "${name}" column`);
    return i;
  };
  const [iCik, iName, iTicker, iExchange] = [col("cik"), col("name"), col("ticker"), col("exchange")];

  const tickers: TickerRow[] = [];
  const skipped: ParsedCompanies["skipped"] = [];
  const seenTicker = new Set<string>();
  const seenCik = new Set<number>();
  for (const row of file.data) {
    if (!Array.isArray(row)) {
      skipped.push({ reason: "not a row", row });
      continue;
    }
    const cik = Number(row[iCik]);
    const name = String(row[iName] ?? "").trim();
    const ticker = normalizeTicker(row[iTicker]);
    const exchange = row[iExchange] == null || String(row[iExchange]).trim() === "" ? null : String(row[iExchange]).trim();
    if (!Number.isSafeInteger(cik) || cik <= 0) {
      skipped.push({ reason: "bad CIK", row });
      continue;
    }
    if (!name) {
      skipped.push({ reason: "no name", row });
      continue;
    }
    if (!ticker) {
      skipped.push({ reason: "bad ticker", row });
      continue;
    }
    if (seenTicker.has(ticker)) {
      skipped.push({ reason: "ticker listed twice", row });
      continue;
    }
    seenTicker.add(ticker);
    const isPrimary = !seenCik.has(cik);
    seenCik.add(cik);
    tickers.push({ ticker, cik, name, exchange, isPrimary, tvSymbol: tvSymbol(ticker, exchange) });
  }
  return { tickers, companies: seenCik.size, skipped };
}
