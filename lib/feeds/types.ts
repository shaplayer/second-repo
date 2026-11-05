export type FeedKind = "press" | "filing";

export type FeedItem = {
  id: string;            // stable: url hash or accession number
  kind: FeedKind;
  ticker: string | null;
  company: string | null;
  title: string;
  url: string;
  source: string;        // "SEC EDGAR", "GlobeNewswire", ...
  formType: string | null; // "8-K", "10-Q" ... (filings only)
  publishedAt: string;   // ISO
};

export type FeedResponse = {
  items: FeedItem[];
  mode: "db" | "live" | "sample";
  stale?: boolean;
  /** Pass back as `before` to load the next page; null when there are no more. */
  nextBefore: string | null;
};
