---
name: market-data
description: Where BigStocks data comes from and how it reaches a page (SEC filings, press releases, company facts, summaries, prices). Use whenever adding or changing an API route, a worker job, a data source, or anything that touches prices.
---

# Data on BigStocks

## The rule about prices
Our server never fetches, stores or shows a price. Prices and charts are TradingView embed widgets
loaded by the visitor's browser (`components/tv/TradingViewWidget.tsx`). Do not add a price provider,
a quotes route, a price column, or a "price move" to any feed. If a task seems to need a price on our
side, stop and ask the owner.

## Where data comes from
- **SEC EDGAR** (free, public domain): filings, press releases attached to filings, company records,
  company financial facts. One client for all of it: `lib/sec/client.ts`. Every request carries
  `SEC_USER_AGENT` (no default) and all requests together stay under 8 a second. A refusal from the
  SEC pauses every request for 10 minutes. Never work around either.
- **Newswires and other sources**: one row per source in `news_sources`, with `enabled`,
  `can_store_body` and `can_summarize`. A source is switched on only once its terms or licence allow
  our use. Feed addresses are in `lib/ingest/press.ts`.
- **Claude** writes summaries (`lib/summaries/claude.ts`), only for items someone opens or for
  companies with subscribers.

## How it reaches a page
The worker (`scripts/worker.ts`) is the only thing that calls outside services. It writes to
Postgres. Pages and API routes read Postgres only, through `lib/data/*` (`feed.ts`, `companies.ts`,
`picks.ts`, `account.ts`). A page view never triggers a request to the SEC or to Claude: it can only
put a job on a list (`markViewed`, `requestSummary`) for the worker to do.

## Adding a kind of filing or a source
- A new kind of filing: add it to `FORMS` in `lib/plain.ts` with a plain-English name, a one-line
  meaning and a category. Never show a form code on its own.
- A new source: a row in `news_sources` (a new migration file), its feed in `lib/ingest/press.ts`,
  and a note in `terms_note` of what was agreed.
- Schema changes are new files in `supabase/migrations/`. Test on a local throwaway Postgres only.
