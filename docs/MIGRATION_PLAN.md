# BigStocks: audit and migration plan (one system, free and license-free data)

Status: **plan approved with the owner's decisions in §6; no code changed yet.** Written Nov 10, 2026.

Repos audited:

| Name in this plan | Repo | What it is today |
|---|---|---|
| **App** | `shaplayer/VideoCLAUDE-APP-MODEL-FOR-STOCKS` (live at bigstocks.vercel.app) | Next.js 15 on Vercel + Supabase. Stock pages, Strong/Mixed/Weak score, filings with Claude summaries, email alerts, accounts, watchlist, chat, picks, Stripe memberships. |
| **Data site** | `shaplayer/second-repo`, branch `claude/sweet-noether-gski67` (Nov 6, the newest work; not yet merged into the default branch). This plan's branch is built on top of it. Confirmed as data.bigstocks.com | Next.js 15 + plain Postgres on a DigitalOcean Droplet (PM2). Homepage with the candlestick-chart hero, stock pick alerts sent from `/admin` by email (Resend) and text, the alerts bell (follow a ticker), live feed of SEC filings and newswire press releases, Free/Premium plans, public track record, Advertise page. |

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
| Picks track record (return vs S&P 500) | App `src/lib/picks.ts` | Needs entry and current prices. **Removed** (decision 2) |
| Public alert track record (`alert_price`, `high_after`, `close_after`) | Data site `alerts` table | **Removed** (decision 2) |
| Ticker tape | Data site `TickerTape.tsx` | Shows filing headlines, not prices, so it keeps working. A TradingView *Ticker Tape* can be added for prices |

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

### 1.6b What the newest data-site branch adds, and how the decisions apply

`claude/sweet-noether-gski67` reworked the homepage and added a sending system. Item by item:

| What it added | Keep? | Notes |
|---|---|---|
| Homepage: headline, email + optional phone sign-up box, "Next pick" countdown (NYSE holidays in `lib/schedule.ts`), "What you get", FAQ | **Keep** | The design starting point (see the design review step in Phase 5). |
| Candlestick-chart hero (`components/hero/ChartVisual.tsx`) | **Keep, fix the label** | It's a generated animation, not market data, but it carries a **"LIVE"** tag. On a stock-alert site that reads as a real live price. Remove the tag, or replace the animation with a real TradingView chart. |
| Alerts bell pop-up (follow a ticker's press releases and filings) | **Keep** | Becomes per-company `alert_subscriptions`. |
| `/admin` console + `lib/broadcast.ts` + `broadcasts` table: send a pick alert to the whole list by text then email via Resend batch, resumable by the worker | **Keep** | It's the pick-alert sender. Price becomes optional (staff-typed, never from a data feed). Move the shared admin password to `users.is_admin` later. |
| Every send is logged on the permanent `alerts` table (ticker, time, price, sponsorship, tier) | **Keep internally, not public** | Decision 2 removes the public track record, but this log is the record of what was sent and of sponsored-alert disclosures (Securities Act §17(b)). It becomes an internal send history: no page, no win/loss. |
| Premium: `/premium`, `Pricing` section, `plans` in `lib/site.ts`, `alerts.tier`, `subscribers.premium`, premium-only sends | **Remove** (decision 6) | Every alert goes to everyone on the list. |
| "Level 2 (beta)" in the footer and in Premium's features | **Remove** (decision 3) | |
| Track record: `/track-record`, `TrackRecordSection`, `TrackRecordTable`, `ResultsStrip`, nav item | **Remove** (decision 2) | |
| Preview-only example rows (`lib/alerts-sample.ts`) | **Remove from runtime** | Same treatment as the example.com fixtures (§1.7a). |

Still true on this branch: the main email sign-up has no confirmation email, and SMS sign-up sends a welcome text, not a "Reply YES" confirmation (both fixed in Phase 4). The footer now links both "Contact" and "For public companies" to `/advertise`, and still links Level 2 (both fixed in §1.7b).

**Two "picks" systems.** The Vercel app has `picks` (posted on `/picks`, sponsored disclosures enforced, never deleted). The data site has pick alerts sent from `/admin` and logged in `alerts`. They're the same idea. Merge them into one `picks` table: each pick is posted on `/picks` **and** broadcast by text and email, with one disclosure rule and one never-delete rule.

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

## 2. Speed is the top priority (owner, Nov 10)

Real-time news comes first. Every design choice below follows these targets, measured from the SEC's acceptance time:

| Step | Target |
|---|---|
| Filing or press release appears on the site | ≤ 30 s |
| Text alert to a follower of that company | ≤ 60 s |
| Email alert | ≤ 90 s |

How:
1. **Poll fast, cheaply.** The current-filings feed is polled every **10 s** during EDGAR's filing hours (6:00 AM–10:00 PM ET, weekdays) and every 60 s otherwise, with conditional requests (`If-Modified-Since`/`ETag`), so an unchanged feed costs almost nothing and stays far under the SEC's 10 requests/second.
2. **Never wait for AI before alerting.** An alert goes out the moment a filing is stored, using the company name, the plain-English form name, the 8-K item names and the press-release title. The Claude summary is written right after and appears on the site (and in digests) when ready.
3. **Push, don't poll, in the browser.** New `filings` and `news` rows are pushed to open pages with Supabase Realtime (already used for chat). The feed shows each item the second it lands, with "12 s ago".
4. **Texts first.** Per-company alerts (small audiences) go out immediately, text before email. List-wide broadcasts keep the existing texts-then-email order.
5. **Measure it.** Store `accepted_at` (SEC), `ingested_at`, `notified_at`/`sent_at`. `/admin` shows the median and slowest delay for the last day; `feeds:check` warns when the poller falls behind.

**Speed limits outside our control (owner should know):**
- **Press releases on EDGAR can lag the newswires.** Companies often file the 8-K with the press release (Exhibit 99.1) at the same moment for earnings, but for other news the 8-K can come hours or days later (the rule allows up to four business days). With EDGAR as the only source, BigStocks is as fast as the SEC filing, not the wire.
- **Text speed for big lists** depends on the carrier route. Standard 10DLC numbers send a limited number of texts per second, so a list-wide text to many thousands of people takes minutes. A dedicated short code is much faster but costs more and takes weeks to approve.

## 2b. Free stock alerts are the growth engine (owner, Nov 10)

Second priority, alongside speed. The business loop: **free pick alerts that perform → a bigger list → sponsors (public companies) pay to reach it.** The product has to serve each step:

| Step | What the site needs |
|---|---|
| People sign up | The homepage's main job, next to the live news: one short email + phone box above the fold, on every page, and in the alerts bell. Double opt-in stays (required), so the confirmation email and the "Reply YES" text must be instant and clear, and the site tracks how many sign-ups finish confirming. |
| People stay | Pick alerts are fast (texts first) and each one says plainly what it is. One-click unsubscribe and STOP stay easy, which keeps carriers and inbox providers from blocking the list. |
| Sponsors pay | `/advertise` ("For public companies") linked from the footer and the admin. **Audience numbers come from the database**, not hard-coded: today `lib/site.ts` claims 125,000 subscribers, 1M daily impressions and 5,000 daily clicks, and sponsors will check them. Each sponsored send gets a report: texts and emails sent, delivered, link clicks (via our own redirect links, disclosed in the privacy policy). |
| Sponsored alerts stay legal | Every sponsored alert names who paid, how much and in what form (Securities Act §17(b)); already enforced in the database and kept in the merged `picks` table. A written rule that staff never trade against a pick or sell into a promotion. Securities-lawyer review before launch (paid promotions plus in-house picks). |

**"Win big" claims need proof.** Marketing that says the free alerts win big is a performance claim. It has to be backed by a complete record of every alert (wins and losses), or it's misleading, and it's exactly what regulators look for in stock-promotion sites. This reopens decision 2; see the open item in §6.

## 3. Target architecture

```
SEC EDGAR (free, public domain)
   │  one rate-limited client: ≤ 8 req/s total, descriptive User-Agent, conditional GETs, on-disk cache
   ▼
Ingestion worker (always on, PM2 on the Droplet)
   ├─ every 10 s (6 AM–10 PM ET; 60 s otherwise): current-filings feed for 8-K, 10-Q, 10-K, 4, DEF 14A → filings
   ├─ for each 8-K: open the filing index, find EX-99.1 → news (title, text, link to sec.gov)
   ├─ summarizer queue: new filings → summaries (Claude; Form 4 without AI)
   ├─ alert matcher: filings / news / picks → alert_events (one row per subscriber per item)
   ├─ sender: alert_events queue → email (Resend) and SMS (Twilio), retries, digest batching
   └─ nightly 02:30 ET: companyfacts per tracked ticker → fundamentals_snapshots
   ▼
One Postgres (Supabase: also handles sign-in and live chat)
   ▼
Next.js web app on the same Droplet (PM2 `bigstocks-web` behind Nginx + HTTPS; pages and APIs read the database only, never call the SEC on a page view)
   └─ prices: TradingView embed widgets in the browser, "by TradingView" attribution kept visible
```

Why these choices:
- **Supabase Postgres as the one database.** Sign-in, row-level security and live chat already run there. The data site's code uses plain `pg` and a `DATABASE_URL`, which can point at Supabase's Postgres directly.
- **Worker on the Droplet, not Vercel Cron.** It's already always on and has the back-off logic. That removes the need for Vercel Pro per-minute cron and the 300-second function limit.
- **Pages read the database only.** This fixes the ~20 s first-visit wait, the SEC rate-limit risk under traffic, and most error states.

---

## 4. Unified schema (requirement 2)

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
  chat_banned boolean not null default false,  -- no plan/billing columns: everyone is free (decision 6)
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
  item_type text not null check (item_type in ('filing','news','pick')),
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

**Kept** (outside the nine core tables): `picks`, merged with the data site's pick alerts (§1.6b): one table, delete-refusing trigger and sponsored-disclosure check kept, price optional; `broadcasts` (the resumable list-wide send job for each pick); `inquiries`, `chat_messages`, `chat_reports`, `chat_hidden`, `app_state`.

**Retired after migration:** `seen_filings`, `digest_queue`, `filing_summaries`, `alert_subscribers`, `profiles` (kept as a read-only view during the switch), `subscribers`, `ticker_follows`, `news_items`.

---

## 5. Migration plan (phased; each phase ships on its own and can be rolled back)

### Phase 0: prepare (no user-visible change)
1. Decisions are in §6; the two still-open items are asked before the phase that needs them.
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
2. Poll `getcurrent` Atom feeds for `8-K, 10-Q, 10-K, 4, DEF 14A` every 10 s during EDGAR filing hours and every 60 s otherwise (§2), upsert into `filings` (accession is the key, so re-reads are harmless). Catch up from the daily index on start-up if the worker was down.
3. For each 8-K, read the filing index page (`…-index.htm`), find the document whose Type is `EX-99.1`, strip HTML to text, and save to `news`. Items without an Ex. 99.1 have no `news` row.
4. Nightly at 02:30 ET: `companyfacts` for `tracked` companies (watchlisted, followed, or in the top list) → compute the score → `fundamentals_snapshots`. Pages read the latest snapshot.
5. Health: `app_state` keeps the last success time per job; `npm run feeds:check` is extended to cover each job.

### Phase 3: AI summaries (requirement 4)
1. A `summaries` job summarizes only (a) filings someone opens, queued from the page, and (b) new filings of companies with at least one active alert subscription (decision 4). Nothing market-wide.
2. Keep the current request shape: `claude-opus-5-5`, structured JSON output, `effort: "low"`, server-side refusal fallback (`fallbacks: "default"`), stop-reason checks. Save `model`, `prompt_version`, and token counts.
3. Locking: `INSERT ... ON CONFLICT DO NOTHING` on a "claim" row before calling Claude, so two workers never summarize the same filing.
4. Backfill (subscribed companies only) and re-generation after a prompt change: Message Batches API (half price, results within 24 h). The refusal-fallback parameter isn't accepted on Batches, so a refused item is re-run once on the live path.
5. Form 4 stays rule-based (no AI, exact numbers from the XML).
6. UI: every summary shows **"AI-generated summary. Can contain mistakes."** and **"Read the original filing on SEC.gov →"** (`source_url`). The "Explain" button reads from the database or queues a job; it never calls Claude in the page request.

### Phase 4: alerts (requirement 5)
1. **Matcher (runs the moment a filing is stored, before any summary; §2):** for each new filing, news item or pick, insert one `alert_events` row per matching active subscription. The unique `(subscription_id, dedupe_key)` makes double sends impossible, even if the worker restarts mid-run.
2. **Sender:** picks `queued` rows with `FOR UPDATE SKIP LOCKED`, sends, records `provider_message_id`; on failure, retries with back-off up to 5 times, then marks `failed`. Respects provider rate limits.
3. **Digest:** `cadence='digest'` rows become `status='digest'`; one email per subscriber at 6:00 PM ET (computed in `America/New_York`, so it doesn't drift with daylight saving).
4. **Email:** double opt-in for every list, including the main sign-up. RFC 8058 one-click unsubscribe (POST only); a plain link click opens a confirmation page instead of unsubscribing at once. Postal address in every email footer.
5. **SMS:** double opt-in: the sign-up sends "Reply YES to confirm BigStocks alerts for $AAPL. Msg & data rates may apply. Reply HELP for help, STOP to cancel." The subscription is active only after YES. STOP (and its synonyms) unsubscribes every SMS subscription for that number and is confirmed once; HELP replies with program name, contact and the STOP line; START re-subscribes. Carrier (10DLC) registration must be approved before launch.
6. Existing data-site SMS subscribers who joined under the old flow keep their recorded consent (they agreed to the exact text stored); they're not asked again.

### Phase 5: prices and UI (requirements 1 and 6)
1. Delete `src/lib/databento.ts`, `/api/quotes`, `/api/chart`, `DATABENTO_API_KEY`, the Level 2 tab, page, links and copy, and `l2_trial_ends_at`. Remove the track record pages, components and pick-return code listed in §6 decision 2, and Stripe/membership per decision 6.
2. Add one `TradingViewWidget` component (loads the official embed script, takes `tv_symbol`) used for: ticker tape, homepage market overview and hotlists, stock-page symbol info and advanced chart, watchlist mini charts. Leave the widgets' own "by TradingView" link visible and add "Price data and charts by TradingView" in the footer. Update the Content Security Policy to allow TradingView's script and frames.
3. Footer text becomes: "Prices and charts by TradingView. Filings, financials and press releases from SEC EDGAR. Summaries are AI-generated. Not investment advice."
4. Apply the three fixes in §1.7 (example.com, routes, error states).
5. Rewrite `.claude/skills/market-data` and `stock-charts` to match, so future work doesn't bring a paid price provider back.

### Phase 6: switch over and clean up
1. Run the new worker alongside the old pollers with sending turned off for 48 h. Compare filings caught and alerts that would have gone out.
2. Deploy the merged app to the Droplet: `git pull`, `npm ci`, `npm run build`, `pm2 reload ecosystem.config.cjs`, `pm2 save`. Check it on the Droplet's address before any DNS change.
3. At SiteGround DNS, point `bigstocks.com` (and `www`, `data`) at the Droplet. Lower the DNS TTL a day ahead so the switch is fast and can be undone fast. Issue the certificates once DNS resolves.
4. Update `APP_URL`, the Supabase Site URL and redirect URLs, the Google sign-in redirect, the Twilio inbound webhook URL and the Resend sender domain. Delete the Stripe test-mode webhook endpoint.
5. Turn off the old data-site ingest, turn on sending in the new worker. Keep bigstocks.vercel.app up for a week with a redirect to the new domain, then delete the Vercel project.
6. After two weeks without problems, drop the retired tables (after a final backup).

**Checks for every phase:** `npm run lint` (type check), `npm test` (parsers and alert matching), a production build, and the link checker from §1.7b.

---

## 6. Decisions (owner, Nov 10, 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Is `second-repo` the data.bigstocks.com codebase? | Yes. It is the home of the merged app. |
| 2 | Track records | **Eliminated** (reopened, see Open below). Remove the public track record (`/track-record`, `/api/alerts/export`, `ResultsStrip`, `ResultBadge`, homepage track-record section) and the picks' return-vs-S&P numbers (`picksWithResults`). Picks themselves stay, as a dated list with their sponsored disclosures. The data site's `alerts` table stops being public; its rows are copied into the merged `picks` table as send history (never deleted: sponsored-alert disclosures are a compliance record). |
| 3 | Level 2 | **Gone** everywhere: tab, page, links, copy, `l2_trial_ends_at`, membership wording. |
| 4 | AI summary scope | **Only filings users want:** (a) when someone opens a filing or a stock page, its unsummarized filings are queued; (b) every new filing of a company that has at least one active email or SMS alert subscription. No market-wide summaries. Batch backfill only for companies with active subscriptions. |
| 5 | Form 4 | Rule-based from the XML, no AI. |
| 6 | Membership | **No paid plan for now; every signed-up user is a free member.** Remove Stripe entirely: `src/lib/stripe.ts`, `/api/billing/*`, `/api/stripe/webhook`, `scripts/stripe-setup.mjs`, `/membership`, `MembershipButtons`, `BillingActions`, the admin "grant membership" tool, the `stripe` package and `STRIPE_*` env vars. Picks marked members-only become visible to everyone (drop the `tier` gating and the lock in `PickCard`). Stripe was only ever in test mode, so no real subscribers are affected. |
| 7 | Hosting | **Everything on the DigitalOcean Droplet**: web app and worker, both under PM2 (`ecosystem.config.cjs`). Leave Vercel: delete `vercel.json` (its crons move into the worker) and `.vercelignore`. Nginx in front of `next start` on port 3000, HTTPS with Let's Encrypt (certbot, auto-renew), gzip, and a 301 from `www` to the apex (or the reverse). Env vars live in a root-only `.env` on the server, never in git. `NEXT_PUBLIC_*` values are baked in at build time, so build on the server after changing them. Database stays on Supabase (sign-in and chat need it). |

### Open
- **Track record vs "win big" (decision 2, reopened by §2b).** Either (a) bring back an honest public record of every free alert, wins and losses, with the price staff record at send time and the day's close entered the same way (sponsored alerts shown separately and never counted as wins), or (b) keep it removed and drop "win big" style claims from the site, emails and texts, and talk about speed and news instead. Needed before Phase 5 (homepage copy) and before any marketing.

Scope changes that follow from these:
- Drop `track_alert` from `alert_events.item_type`, and `published_alerts` from the kept tables.
- Phase 3 step 1 becomes: summarize on view and for subscribed companies only (decision 4).

