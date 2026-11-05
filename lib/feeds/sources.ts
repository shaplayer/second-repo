/**
 * Free data sources. Verify each URL on first `npm run ingest:once` run:
 * the script prints an item count per source; fix or remove any that return 0.
 */
export const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT || "BigStocks.com contact@bigstocks.com";

/** EDGAR "latest filings" Atom feed, one request per form type. */
export const EDGAR_FORMS = ["8-K", "10-Q", "10-K", "S-1", "S-3", "6-K", "424B4", "SCHEDULE 13D"];
export const edgarCurrentUrl = (form: string, count = 40) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(form)}&company=&dateb=&owner=include&start=0&count=${count}&output=atom`;

export const EDGAR_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
export const edgarSubmissionsUrl = (cik: number) =>
  `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`;

/** Newswire RSS feeds (public). Only items that name a ticker are kept. */
export const PRESS_FEEDS: { source: string; url: string }[] = [
  {
    source: "GlobeNewswire",
    url: "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies",
  },
  { source: "PR Newswire", url: "https://www.prnewswire.com/rss/news-releases-list.rss" },
  { source: "PR Newswire", url: "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss" },
  { source: "Business Wire", url: "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeGVtRWA==" },
  { source: "ACCESS Newswire", url: "https://www.accessnewswire.com/newsroom/api/rss" },
];

/** Human-readable label per form type (shown in the feed). */
export const FORM_LABELS: Record<string, string> = {
  "8-K": "Current report",
  "8-K/A": "Amended current report",
  "10-Q": "Quarterly report",
  "10-K": "Annual report",
  "S-1": "IPO / registration statement",
  "S-1/A": "Amended registration",
  "S-3": "Shelf registration",
  "6-K": "Foreign issuer report",
  "424B4": "Final prospectus",
  "SCHEDULE 13D": "Activist stake (5%+)",
  "SC 13D": "Activist stake (5%+)",
  "SCHEDULE 13G": "Passive stake (5%+)",
  "DEF 14A": "Proxy statement",
  "4": "Insider transaction",
};
