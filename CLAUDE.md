# BigStocks: notes for AI coding assistants

Read `docs/MIGRATION_PLAN.md` first: the approved plan, the owner's priorities (§2) and decisions (§6). The approved
design is the canvas named in decision 8. `docs/RUNBOOK.md` has the steps the owner runs on the servers.

## Product rules
- Never show "Buy" or "Sell". The health check says Strong / Mixed / Weak, from SEC financial data only, always with a
  "not investment advice" note.
- Plain English for non-experts everywhere: "Quarterly report", not "10-Q". A form code may appear only in brackets
  after the plain name.
- Prices and charts are TradingView widgets in the visitor's browser. Our server never fetches, stores or shows a
  price. Do not add a price provider.
- Sponsored picks always say who paid, how much and in what form (enforced in the database). Picks are never deleted.
- Every AI-written summary is labelled as AI-generated and links to the original.
- Alerts are email only for now. Double opt-in for every list. Never send to a subscription whose status is not
  `active`. SMS is a later add-on: keep it switchable, and off.

## Engineering rules
- One database (Supabase Postgres). Schema changes: add a new file in `supabase/migrations/`; never edit an old one.
- App data tables are server-only. Read and write them on the server with `pg` (`lib/db.ts`). No client-side table
  access.
- Never connect to a production database from a development or agent session, and never use the Supabase MCP tools on
  the live project. Test against a local throwaway Postgres: `npm run test:db` creates and drops its own databases and
  refuses any host that is not local.
- SEC requests always send `SEC_USER_AGENT` (the real company name and a monitored email; there is no default) and stay
  under 8 requests a second in total.
- `legacy/vercel-app/` is a frozen reference copy of the old app. Do not import from it or edit it.
- Never commit `.env` or paste keys into code, docs or chat.

- Sign-in is by emailed one-time link (`lib/auth`). Only hashes of link codes and session codes are stored. Anything that
  changes data must be a POST checked with `sameOrigin()` (`lib/web/request.ts`); confirming, signing in and unsubscribing
  never happen on a GET, because mail scanners open every link.
- Pages and API routes read the database only. They never call the SEC, Claude or any other outside service: the worker
  (`scripts/worker.ts`) does that.
- The health check rules live in `lib/health`. The growth-company rule set stays off (`HEALTH_GROWTH_RULES`) until the
  owner approves it (plan decision 9).

## Where things are
- `app/`, `components/`: the site, in the approved design (tokens and component classes in `app/globals.css`).
- `lib/plain.ts`: the one place for plain-English names of filings. `lib/data/`: every query the pages use.
- `lib/alerts/`: sign-up, confirmation, unsubscribe, matching and sending. `lib/summaries/`: the Claude call and its queue.
- `lib/sec/`, `lib/ingest/`: the SEC client, parsers and the jobs the worker runs.
- `lib/backfill/`, `scripts/backfill.ts`: the one-time copy from the two old databases.
- `npm run dev:seed` builds a local sample database to look at the pages with.

Checks before finishing a change: `npm run lint`, `npm test` and `npm run build`.
