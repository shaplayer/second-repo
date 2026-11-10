# BigStocks: audit and migration plan (one system, free and license-free data)

Status: **plan only, no code changed yet.** Written Nov 10, 2026.

Repos audited:

| Name in this plan | Repo | What it is today |
|---|---|---|
| **App** | `shaplayer/VideoCLAUDE-APP-MODEL-FOR-STOCKS` (live at bigstocks.vercel.app) | Next.js 15 on Vercel + Supabase. Stock pages, Strong/Mixed/Weak score, filings with Claude summaries, email alerts, accounts, watchlist, chat, picks, Stripe memberships. |
| **Data site** | `shaplayer/second-repo` (this repo; assumed to be data.bigstocks.com, see Open decisions) | Next.js 15 + plain Postgres on a DigitalOcean Droplet (PM2). Marketing homepage, live feed of SEC filings and newswire press releases, per-company email and SMS alerts, public track record, Advertise page. |

The goal: one system, one database, one ingestion worker, and only free, license-free data: SEC EDGAR (public domain), TradingView embed widgets for prices (shown, never stored), and our own Claude-written summaries.

---

## 1. Audit findings

### 1.1 Paid or licensed data in use today

| Where | What | Action |
|---|---|---|
| App `src/lib/databento.ts` | Databento historical API (EQUS.SUMMARY daily, EQUS.MINI intraday). Used by the homepage, stock page, `/api/quotes`, `/api/chart`, `src/lib/picks.ts`, `/api/admin/picks` | **Remove** (requirement 1) |
| App stock page, `profiles.l2_trial_ends_at`, membership copy | Level 2 "coming soon" tab, planned paid Level 2 (Databento live feed) | **Remove** (requirement 1) |
| Data site `lib/site.ts`, `Nav`, `Footer`, `app/level-2`, `components/sections/Level2AndTrack.tsx` | Level 2 links and page | **Remove** |
| Data site `lib/feeds/rss.ts`, `lib/feeds/sources.ts` (`PRESS_FEEDS`) | PR Newswire and Business Wire RSS. The headlines and text are the newswires' copyrighted content, not public-domain data | **Remove.** Replace with 8-K Exhibit 99.1 press releases from EDGAR (requirement 3) |
| Data site `.claude/skills/market-data`, `.claude/skills/stock-charts` | Tell future work to add Finnhub / Polygon / etc. and draw our own price charts | **Rewrite** to say "TradingView widgets only; no price provider" |
| Frontend repo `BIGSTOCKS-FRONTEND` | Massive API proxy | Out of scope (not one of the two codebases), noted only |

**The live site's error right now** ("Market data couldn't load: Databento ... 422"): `datasetEnd()` asks for the dataset's end date, but the `ohlcv-1d` schema ends earlier (Nov 7), so every daily request runs past the available data. This becomes moot once Databento is removed. Until then, the fix would be to use the schema-level end.

### 1.2 What breaks when prices become "widget only"

TradingView widgets draw prices inside an iframe in the visitor's browser. **Our server never sees a price**, so anything that computes from prices stops working:

| Feature | Repo | Depends on prices because |
|---|---|---|
| Market summary (SPY/QQQ/DIA/IWM), Market trends (gainers/losers/most active) | App homepage | Built from Databento bars → replace with TradingView *Market Overview* / *Hotlists* widgets |
| Price, change, 52-week range, chart | App stock page | → TradingView *Symbol Info* + *Advanced Chart* widgets |
| Market value, P/E, dividend yield | App stock page | `price × shares`. **Can't be computed.** Show TradingView *Fundamental Data* widget instead, or drop these three stats |
| Watchlist prices | App `Watchlist.tsx` | → one TradingView *Mini Chart* or *Symbol Overview* per row |
| Picks track record (return vs S&P 500) | App `src/lib/picks.ts` | Needs entry and current prices. **Breaks** (see Open decision 2) |
| Public alert track record (`alert_price`, `high_after`, `close_after`) | Data site `alerts` table | Same. **Breaks** for new alerts (see Open decision 2) |
| Ticker tape | Data site `TickerTape.tsx` | → TradingView *Ticker Tape* widget |

The Strong/Mixed/Weak score is **not** affected: it uses only SEC financial data.

### 1.3 Data model: two databases that overlap

| Concept | App (Supabase) | Data site (Postgres) |
|---|---|---|
| Companies | none (SEC JSON fetched per request) | none |
| Filings | `seen_filings` (accession only) | `news_items` (kind = filing) |
| Press releases | none | `news_items` (kind = press, from newswires) |
| Summaries | `filing_summaries` | none |
| Fundamentals | none (6-hour in-memory cache; first visit ~20 s) | none |
| Users | `profiles` (+ Supabase `auth.users`) | none |
| Watchlists | `watchlist` | none |
| Alert sign-ups | `alert_subscribers` (email only, tickers array, prefs JSON) | `subscribers` (email/phone, TCPA consent) + `ticker_follows` (per ticker, per channel) |
| Alert delivery log, dedupe | `seen_filings` (doubles as a lock), `digest_queue` | `news_items.notified_at`, `alerts.notified_at`, `ticker_follows.last_notified_at` |

There is no single delivery log, so nobody can answer "did subscriber X get alert Y, and when?". Dedupe works per item, not per (subscriber, item), so a crash mid-send can either skip or repeat people.

### 1.4 Ingestion

- **App:** Vercel Cron calls `/api/cron/filings` every minute (needs Vercel Pro), reading the all-forms EDGAR current-filings feed, 100 at a time. Fundamentals are fetched live from `companyfacts` (several MB per company) on page view.
- **Data site:** PM2 worker `scripts/ingest.ts` on the Droplet polls the EDGAR Atom feed per form (`8-K, 10-Q, 10-K, S-1, S-3, 6-K, 424B4, SCHEDULE 13D`) plus the newswire RSS feeds. It's the better base: always on, has back-off, and has the `feeds:check` diagnostic.
- **Missing from both:** Form 4 and DEF 14A in the poller (the App reads Form 4 per company only), Exhibit 99.1 extraction, nightly XBRL snapshots, and a shared SEC rate limiter (each process throttles on its own).
- **User-Agent:** both default to a placeholder (`admin@bigstocks.com` / `contact@bigstocks.com`). The SEC requires a real company name and a monitored contact email.

### 1.5 AI summaries (App `src/lib/summarize.ts`)

The approach is sound, and it's the one to keep:
- `claude-opus-5-5`, `output_config: { effort: "low", format: json_schema }`, `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`. This is the current, correct form. Refusal and `max_tokens` stop reasons are checked.
- One summary per accession number, saved and reused for everyone (the database row is the cache). An in-process `inFlight` map stops duplicate work within one server.
- Form 4 is summarized from the XML with no AI: free and exact.

Gaps:
- The UI doesn't label summaries as AI-generated, and the model name and prompt version aren't stored, so old summaries can't be found and regenerated after a prompt change.
- Summaries are made on demand (the "Explain" button) or for followed tickers. There's no backfill, and the Batch API (50% cheaper) isn't used.
- The `inFlight` lock is per instance. Two Vercel instances can summarize the same filing twice; the database `insert` must be the lock.
- Prompt caching: the system prompt and schema are short (probably below the minimum cacheable prefix), and the filing text changes per call, so caching saves little here. Keep the system prompt byte-stable anyway.

### 1.6 Alerts compliance

| Requirement | App | Data site |
|---|---|---|
| Email double opt-in | ✓ (`/alerts/confirm`) | ✓ for per-ticker follows (`/api/follow/confirm`); **✗ for the main sign-up** (`/api/subscribe` adds the address immediately) |
| SMS double opt-in | SMS not built ("SOON") | **✗**: `ticker_follows.confirmed_at` is set at sign-up for SMS |
| STOP | n/a | ✓ inbound webhook records STOP/START words |
| HELP | n/a | **✗**: inbound webhook ignores HELP (no reply with program name, contact and "Reply STOP to cancel") |
| One-click unsubscribe (RFC 8058) | ✓ headers set. **But** `GET /api/alerts/unsubscribe` unsubscribes on a plain link visit, so email security scanners that pre-open links can unsubscribe people | ✓ (POST for one-click, GET shows a page) |
| Postal address in emails (CAN-SPAM) | ✗ not present | Only if `COMPANY_POSTAL_ADDRESS` is set |
| Queue, retries | none (send inline in the cron request) | none (send inline in the worker loop) |
| Digest | ✓ daily at 22:00 UTC (drifts an hour with daylight saving) | ✗ |
| Consent evidence (TCPA) | n/a | ✓ exact `consent_text`, time, IP, user agent stored. **Must be carried over unchanged** |

### 1.7 Requested fixes (item 6)

**a. example.com filing link.** In code, `example.com` links exist only in the dev fixture `lib/feeds/fixtures/press.xml`, served when `FEED_SAMPLE=1` and `NODE_ENV !== "production"` (`lib/feeds/sample.ts`). So if one shows on the live data site, either the server is running `next dev` (or without `NODE_ENV=production`) with `FEED_SAMPLE=1`, or a sample row reached the database. I couldn't open data.bigstocks.com from this session to see which page shows it. Fix in all cases:
1. Move fixtures out of the runtime path (into `scripts/fixtures/`, used only by `npm test`), and delete sample mode from `getFeed()`.
2. At ingest, accept only `https://www.sec.gov/Archives/...` URLs for filings and exhibits. Add a database `CHECK` constraint for the same thing.
3. One-off cleanup: `DELETE FROM news_items WHERE url NOT LIKE 'https://www.sec.gov/%' AND kind = 'filing'` (run after a backup, before the migration).

**b. Inconsistent footer routes.**
- The App's footer has no links at all; its header has Markets / Picks. The data site's header has Alerts / News / Filings / Track Record / Level 2 / Advertise, and its footer uses different labels ("Pre-market alerts" vs "Alerts").
- The same company has two pages: `/stock/AAPL` (App) and `/news/AAPL` (data site).
- Level 2 links go to a placeholder page.
- "Pre-market alerts" can point off-site through `NEXT_PUBLIC_ALERTS_URL`, while the nav item of the same name may not.
- "Contact" points to `/advertise#contact` (a sales form), not a general contact.

Fix: one route map (`lib/site.ts`) that both the header and footer read; one company page `/stock/[ticker]` with tabs; permanent redirects `/news/:ticker → /stock/:ticker?tab=news` and `/level-2 → /`; a test that requests every nav and footer link and fails on any non-200.

**c. Graceful error state.** The App homepage prints the provider's raw error JSON to visitors. Neither app has `error.tsx`, `global-error.tsx` or `not-found.tsx`. Fix: each homepage section fails on its own with a short, plain message ("Filings are taking longer than usual. Showing what we had at 9:41 AM."), served from the last good data in the database; error details go to the server log only; add error, global-error and not-found pages; the worker records its last successful run, and the UI shows "Last updated".

---

## 2. Target architecture

```
SEC EDGAR (free, public domain)
   │  one rate-limited client: ≤ 8 req/s total, descriptive User-Agent, conditional GETs, on-disk cache
   ▼
Ingestion worker (always on, PM2 on the Droplet)
   ├─ every 60 s: current-filings feed for 8-K, 10-Q, 10-K, 4, DEF 14A → filings
   ├─ for each 8-K: open the filing index, find EX-99.1 → news (title, text, link to sec.gov)
   ├─ summarizer queue: new filings → summaries (Claude; Form 4 without AI)
   ├─ alert matcher: filings / news / picks → alert_events (one row per subscriber per item)
   ├─ sender: alert_events queue → email (Resend) and SMS (Twilio), retries, digest batching
   └─ nightly 02:30 ET: companyfacts per tracked ticker → fundamentals_snapshots
   ▼
One Postgres (Supabase: also handles sign-in and live chat)
   ▼
Next.js web app (pages and APIs read the database only, never call the SEC on a page view)
   └─ prices: TradingView embed widgets in the browser, "by TradingView" attribution kept visible
```

Why these choices:
- **Supabase Postgres as the one database.** Sign-in, row-level security and live chat already run there. The data site's code uses plain `pg` and a `DATABASE_URL`, which can point at Supabase's Postgres directly.
- **Worker on the Droplet, not Vercel Cron.** It's already always on and has the back-off logic. That removes the need for Vercel Pro per-minute cron and the 300-second function limit.
- **Pages read the database only.** This fixes the ~20 s first-visit wait, the SEC rate-limit risk under traffic, and most error states.

---

## 3. Unified schema (requirement 2)

All tables in `public`. Row-level security on everywhere; only the server key writes, and users read only their own rows in `users`, `watchlists` and `alert_subscriptions`. The SQL below is an outline; the real migration files come in Phase 1.

```sql
companies (
  cik            bigint primary key,
  ticker         text unique not null,           -- BRK.B style
  name           text not null,
  exchange       text,                           -- Nasdaq / NYSE (from company_tickers_exchange.json)
  tv_symbol      text,                           -- "NASDAQ:AAPL" for the TradingView widgets
  sic_description text, website text, phone text, fiscal_year_end text,
  tracked        boolean not null default false, -- gets nightly XBRL snapshots
  updated_at     timestamptz not null default now()
)

filings (
  accession      text primary key,               -- 0000320193-26-000018
  cik            bigint not null references companies,
  form           text not null,                  -- 8-K, 10-Q, 10-K, 4, DEF 14A (+ /A)
  items          text[] not null default '{}',   -- 8-K item numbers
  accepted_at    timestamptz not null,           -- exact time from the Atom feed
  filed_date     date not null,
  primary_url    text not null check (primary_url like 'https://www.sec.gov/Archives/%'),
  index_url      text not null check (index_url   like 'https://www.sec.gov/Archives/%'),
  ingested_at    timestamptz not null default now()
)  -- index (cik, accepted_at desc), (form, accepted_at desc)

news (                                           -- press releases = 8-K Exhibit 99.1 only
  id             bigserial primary key,
  accession      text not null references filings,
  exhibit        text not null default 'EX-99.1',
  cik            bigint not null references companies,
  title          text not null,                  -- first heading of the exhibit
  body_text      text not null,                  -- plain text, for summaries and search
  url            text not null unique check (url like 'https://www.sec.gov/Archives/%'),
  published_at   timestamptz not null,           -- = filing accepted_at
  unique (accession, exhibit)
)

fundamentals_snapshots (
  cik            bigint references companies,
  as_of          date,                           -- the night it was taken
  quarters       jsonb not null,                 -- last 8 quarters: revenue, net income, margin
  ttm            jsonb not null,                 -- TTM revenue, profit, dividend per share, shares outstanding
  score          jsonb,                          -- the 4×4 grid
  verdict        text check (verdict in ('Strong','Mixed','Weak')),
  source_filed   date,                           -- newest filing the facts came from
  primary key (cik, as_of)
)

summaries (
  accession      text primary key references filings,
  kind           text not null check (kind in ('ai','rule')),  -- 'rule' = Form 4 from XML
  model          text,                           -- e.g. claude-opus-5-5; null for 'rule'
  prompt_version int not null,
  headline text not null, bullets text[] not null, why_it_matters text not null,
  tone text not null, importance text not null, category text not null,
  source_url     text not null,                  -- what the "Read the original" link opens
  input_tokens int, output_tokens int,
  created_at     timestamptz not null default now()
)

users (                                          -- replaces profiles; id = auth.users.id
  id uuid primary key references auth.users on delete cascade,
  email text not null, display_name text unique,
  plan text not null default 'free', member_until timestamptz,
  stripe_customer_id text, chat_banned boolean not null default false,
  is_admin boolean not null default false,       -- replaces the shared admin password
  created_at timestamptz not null default now()
)

watchlists (
  user_id uuid references users on delete cascade,
  cik bigint references companies,
  added_at timestamptz not null default now(),
  primary key (user_id, cik)
)

alert_subscriptions (
  id bigserial primary key,
  user_id uuid references users,                 -- null for sign-ups without an account
  channel text not null check (channel in ('email','sms')),
  address text not null,                         -- email, or phone in E.164
  cik bigint references companies,               -- null = general daily alerts list
  categories text[] not null default '{earnings,news}',  -- earnings, news, insider, proxy, picks
  cadence text not null default 'instant' check (cadence in ('instant','digest')),
  status text not null default 'pending' check (status in ('pending','active','unsubscribed')),
  confirm_token text unique, unsubscribe_token text unique not null,
  consent_text text, consent_at timestamptz, consent_ip inet, consent_user_agent text, source text,
  confirmed_at timestamptz, unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct (channel, address, cik)
)

alert_events (                                   -- the queue, the dedupe and the audit log
  id bigserial primary key,
  subscription_id bigint not null references alert_subscriptions,
  item_type text not null check (item_type in ('filing','news','pick','track_alert')),
  item_ref text not null,                        -- accession / news id / pick id
  dedupe_key text not null,                      -- e.g. 'filing:0000320193-26-000018'
  status text not null default 'queued'
    check (status in ('queued','digest','sending','sent','failed','suppressed')),
  attempts int not null default 0, next_attempt_at timestamptz not null default now(),
  digest_id bigint, provider_message_id text, error text,
  created_at timestamptz not null default now(), sent_at timestamptz,
  unique (subscription_id, dedupe_key)           -- one alert per person per item, ever
)
```

**Kept as they are** (outside the nine core tables): `picks` (with its delete-refusing trigger and sponsored-disclosure check), the data site's `alerts` track-record table (renamed `published_alerts` so it isn't confused with `alert_events`; its guard trigger is kept), `inquiries`, `chat_messages`, `chat_reports`, `chat_hidden`, `app_state`.

**Retired after migration:** `seen_filings`, `digest_queue`, `filing_summaries`, `alert_subscribers`, `profiles` (kept as a read-only view during the switch), `subscribers`, `ticker_follows`, `news_items`.

---

## 4. Migration plan (phased; each phase ships on its own and can be rolled back)

### Phase 0: prepare (no user-visible change)
1. Decide the open questions in §5.
2. Back up both databases (`pg_dump`). Export the data site's `subscribers` and `ticker_follows` with their consent columns to cold storage; this is legal evidence and must survive.
3. Set `SEC_USER_AGENT` to the real company name and a monitored email in every environment.
4. Code home: the merged app lives in **this repo** (`second-repo`). The App's code is copied in under the same Next.js app (both are Next 15). The App repo is kept read-only for history.

### Phase 1: schema and backfill
1. Create the nine tables plus the renames above as migration files (one file per change; old migrations are never edited).
2. Load `companies` from `company_tickers_exchange.json` (Nasdaq/NYSE), set `tv_symbol`.
3. Copy data:
   - `filing_summaries` → `summaries` (`kind='ai'` or `'rule'` for Form 4, `model='claude-opus-5-5'`, `prompt_version=1`)
   - `profiles` → `users`
   - `watchlist` → `watchlists` (ticker → cik)
   - `alert_subscribers` → one `alert_subscriptions` row per ticker
   - `subscribers` + `ticker_follows` → `alert_subscriptions` (consent fields copied byte for byte)
   - `news_items` (filings only) → `filings`
   - Newswire press rows are **not** copied.
4. Row counts are checked before and after. Each copy is a script that can run again safely.

### Phase 2: ingestion worker (requirement 3)
1. One SEC client: a token bucket at 8 requests/second shared by every job, User-Agent on every request, `If-Modified-Since`/`ETag` on feeds, `Retry-After`/exponential back-off on 403/429/5xx, raw responses cached on disk (filing indexes and exhibits never change, so cache them forever; feeds for 30 s).
2. Poll `getcurrent` Atom feeds for `8-K, 10-Q, 10-K, 4, DEF 14A` every 60 s, upsert into `filings` (accession is the key, so re-reads are harmless). Catch up from the daily index on start-up if the worker was down.
3. For each 8-K, read the filing index page (`…-index.htm`), find the document whose Type is `EX-99.1`, strip HTML to text, and save to `news`. Items without an Ex. 99.1 have no `news` row.
4. Nightly at 02:30 ET: `companyfacts` for `tracked` companies (watchlisted, followed, or in the top list) → compute the score → `fundamentals_snapshots`. Pages read the latest snapshot.
5. Health: `app_state` keeps the last success time per job; `npm run feeds:check` is extended to cover each job.

### Phase 3: AI summaries (requirement 4)
1. A `summaries` job takes new filings in this order: followed or watchlisted tickers first, then 8-Ks with an Ex. 99.1, then the rest within a daily budget (see Open decision 4).
2. Keep the current request shape: `claude-opus-5-5`, structured JSON output, `effort: "low"`, server-side refusal fallback (`fallbacks: "default"`), stop-reason checks. Save `model`, `prompt_version`, and token counts.
3. Locking: `INSERT ... ON CONFLICT DO NOTHING` on a "claim" row before calling Claude, so two workers never summarize the same filing.
4. Backfill and re-generation after a prompt change: Message Batches API (half price, results within 24 h). The refusal-fallback parameter isn't accepted on Batches, so a refused item is re-run once on the live path.
5. Form 4 stays rule-based (no AI, exact numbers from the XML).
6. UI: every summary shows **"AI-generated summary. Can contain mistakes."** and **"Read the original filing on SEC.gov →"** (`source_url`). The "Explain" button reads from the database or queues a job; it never calls Claude in the page request.

### Phase 4: alerts (requirement 5)
1. **Matcher:** for each new filing, news item or pick, insert one `alert_events` row per matching active subscription. The unique `(subscription_id, dedupe_key)` makes double sends impossible, even if the worker restarts mid-run.
2. **Sender:** picks `queued` rows with `FOR UPDATE SKIP LOCKED`, sends, records `provider_message_id`; on failure, retries with back-off up to 5 times, then marks `failed`. Respects provider rate limits.
3. **Digest:** `cadence='digest'` rows become `status='digest'`; one email per subscriber at 6:00 PM ET (computed in `America/New_York`, so it doesn't drift with daylight saving).
4. **Email:** double opt-in for every list, including the main sign-up. RFC 8058 one-click unsubscribe (POST only); a plain link click opens a confirmation page instead of unsubscribing at once. Postal address in every email footer.
5. **SMS:** double opt-in: the sign-up sends "Reply YES to confirm BigStocks alerts for $AAPL. Msg & data rates may apply. Reply HELP for help, STOP to cancel." The subscription is active only after YES. STOP (and its synonyms) unsubscribes every SMS subscription for that number and is confirmed once; HELP replies with program name, contact and the STOP line; START re-subscribes. Carrier (10DLC) registration must be approved before launch.
6. Existing data-site SMS subscribers who joined under the old flow keep their recorded consent (they agreed to the exact text stored); they're not asked again.

### Phase 5: prices and UI (requirements 1 and 6)
1. Delete `src/lib/databento.ts`, `/api/quotes`, `/api/chart`, `DATABENTO_API_KEY`, the Level 2 tab, page, links and copy, and `l2_trial_ends_at`.
2. Add one `TradingViewWidget` component (loads the official embed script, takes `tv_symbol`) used for: ticker tape, homepage market overview and hotlists, stock-page symbol info and advanced chart, watchlist mini charts. Leave the widgets' own "by TradingView" link visible and add "Price data and charts by TradingView" in the footer. Update the Content Security Policy to allow TradingView's script and frames.
3. Footer text becomes: "Prices and charts by TradingView. Filings, financials and press releases from SEC EDGAR. Summaries are AI-generated. Not investment advice."
4. Apply the three fixes in §1.7 (example.com, routes, error states).
5. Rewrite `.claude/skills/market-data` and `stock-charts` to match, so future work doesn't bring a paid price provider back.

### Phase 6: switch over and clean up
1. Run the new worker alongside the old pollers with sending turned off for 48 h. Compare filings caught and alerts that would have gone out.
2. Turn off Vercel Cron and the old data-site ingest, turn on sending in the new worker.
3. Point the domains, update `APP_URL`, Supabase redirect URLs, the Stripe webhook and the Resend sender domain.
4. After two weeks without problems, drop the retired tables (after a final backup).

**Checks for every phase:** `npm run lint` (type check), `npm test` (parsers and alert matching), a production build, and the link checker from §1.7b.

---

## 5. Open decisions (needed before Phase 1)

1. **Is `second-repo` the data.bigstocks.com codebase?** Nothing in any repo names that host; I matched it from its features (Level 2 links, EDGAR/newswire feed, SMS alerts, example.com fixtures). Also: should the merged web app run on Vercel or on the Droplet? (The worker goes on the Droplet either way.)
2. **Price-based track records.** Without a price feed we can't compute pick returns vs the S&P 500 or the alert track record's win/loss. Options:
   - (a) Freeze both records as of the switch date and show past results only.
   - (b) Staff enter the price by hand at publish time, labeled as such.
   - (c) Drop the return numbers and keep the dated log of picks and alerts.
   I recommend (a) plus (c) for new entries. Check (b) against TradingView's terms before choosing it.
3. **Membership.** Level 2 was the planned paid centerpiece. Without it, the paid plan is members-only picks. Keep $49/month, change it, or pause sign-ups?
4. **Summary scope and budget.** The App's own estimate is about $0.02–0.10 per announcement and ~$0.50 per annual report. Summarizing every 8-K, 10-Q, 10-K and DEF 14A market-wide can cost thousands of dollars during earnings season. Recommended: always summarize followed/watchlisted companies and 8-Ks with a press release, everything else on request, with a daily cap.
5. **Form 4 summaries.** Keep them rule-based (no AI)? Recommended: yes; they're free and exact.
