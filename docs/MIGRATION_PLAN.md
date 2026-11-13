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

## 2. Priorities (owner, Nov 10)

In order. When two pull against each other, the higher one wins.

1. **Value on the website.** People come and come back because the site is useful: real-time news (§2.1), plain-English filings and summaries, and clear stock pages.
2. **Opt-ins, built into that value.** Every useful thing on the site is also a reason to sign up (§2.2). The list is what sponsors pay for.
3. **Free pick alerts that perform.** They grow and keep the list (§2.3).
4. **Sponsors.** Public companies pay to reach the list (§2.4).

### 2.1 Value: real-time news

Targets, measured from the SEC's acceptance time:

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

Limits outside our control:
- **Press releases on EDGAR can lag the newswires.** Companies often file the 8-K with the press release (Exhibit 99.1) at the same moment for earnings, but for other news the 8-K can come hours or days later (the rule allows up to four business days). With EDGAR as the only source, BigStocks is as fast as the SEC filing, not the wire.
- **Text speed for big lists** depends on the carrier route. Standard 10DLC numbers send a limited number of texts per second, so a list-wide text to many thousands of people takes minutes. A dedicated short code is much faster but costs more and takes weeks to approve.

### 2.2 Opt-ins, built into the value

The content leads; sign-up sits right next to it, never in front of it (no pop-up that blocks reading).

| Where the visitor is | The opt-in offered there |
|---|---|
| Live news feed (homepage, `/news`) | Bell on each row: "Get $XYZ news by text or email" |
| A stock page | "Get alerts for $XYZ" next to the company name, plus the watchlist button (sign-in) |
| A filing summary | "Get the next one from $XYZ the moment it posts" under the summary |
| Homepage hero | One short email + optional phone box beside the live feed, for the free pick alerts |
| Every page footer | The same short box |

Rules for every opt-in:
- Double opt-in (email confirmation link; text "Reply YES"). The confirmation email and text go out instantly and say exactly what the person will get.
- The SMS consent wording shown is stored word for word with the time, IP and page (TCPA).
- Following one company never silently adds someone to the pick-alert list; each list is its own checkbox.
- One-click unsubscribe and STOP always work, which keeps the list deliverable.
- Measured: sign-ups per page, and how many finish confirming.

### 2.3 Free pick alerts

Pick alerts are fast (texts first) and each one says plainly what it is and whether it's sponsored. **"Win big" is a performance claim:** it must be backed by a complete record of every alert, wins and losses, or left out of the copy. See the open item in §6.

### 2.4 Sponsors

- `/advertise` ("For public companies") linked from the footer and the admin.
- **Audience numbers come from the database**, not hard-coded. Today `lib/site.ts` claims 125,000 subscribers, 1M daily impressions and 5,000 daily clicks; sponsors will check them.
- Each sponsored send gets a report: texts and emails sent, delivered, and link clicks (via our own redirect links, disclosed in the privacy policy).
- Every sponsored alert names who paid, how much and in what form (Securities Act §17(b)); already enforced in the database and kept in the merged `picks` table. A written rule that staff never trade against a pick or sell into a promotion. Securities-lawyer review before launch.

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

Changed on Nov 12 (§6 decisions 10 and 15): press releases also come from the newswire feeds and other approved sources, not 8-K exhibits only; and alerts go out by email only at launch, with text messages as a later add-on.

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
  rule_set       text not null default 'standard',  -- 'standard' or the growth rule set (decision 9)
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

### 4.1 As built (Phase 1, Nov 12): where the real tables differ from the outline

The migration files are in `supabase/migrations/` (`20261112…`). They follow the outline above except for these points, each made for a stated reason:

- **Companies without a ticker are allowed** (`companies.ticker` may be empty), so a company that has only filed to go public still has a row for its filings. A second table, `company_tickers`, maps every ticker to its company, including second share classes (GOOG and GOOGL are one company).
- **The company list holds every ticker in the SEC's file** (Nasdaq, NYSE, Cboe and OTC), not Nasdaq and NYSE only. The old sites let people follow OTC companies; leaving those out would have dropped their follows. Pages can still choose what to feature.
- **`news` takes press releases from any approved source** (decision 10), not 8-K exhibits only. `news_sources` lists each source and what we may do with it. Rows from the SEC must link to sec.gov; rows from other sources keep the headline and the link, and the text only where the source allows it.
- **Newswire headlines already collected by the data site are copied** (headline, link, time; no text). The Phase 1 line "Newswire press rows are not copied" was written before decision 10.
- **`summaries` can belong to a filing or to a news item.**
- **`consent_ip` is text, not `inet`.** Some old rows hold values that are not addresses ("unknown", or a list added by a proxy). The consent record has to be kept exactly as recorded.
- **`alert_subscriptions` has four extra columns** used by the move: `legacy_token` (so links in emails already sent keep working), `backfilled_at` and `updated_at` (to tell a copied row from one the new site has changed), and `legacy` (which old row it came from). Alert kinds also include `press` and `ipo`.
- **`fundamentals_snapshots.no_score_reason`** says why a company has no verdict (too little data, a blank-check company, a fund).
- **`picks` and `broadcasts` are copied only in the switch-over run**, because the old app reads `picks` until then.
- **`backfill_runs`** keeps a record of every saved copy and stops the copy from being run again by accident after the switch-over.

**Kept** (outside the nine core tables): `picks`, merged with the data site's pick alerts (§1.6b): one table, delete-refusing trigger and sponsored-disclosure check kept, price optional; `broadcasts` (the resumable list-wide send job for each pick); `inquiries`, `chat_messages`, `chat_reports`, `chat_hidden`, `app_state`.

**Retired after migration:** `seen_filings`, `digest_queue`, `filing_summaries`, `alert_subscribers`, `profiles` (kept as a read-only view during the switch), `subscribers`, `ticker_follows`, `news_items`.

---

## 5. Migration plan (phased; each phase ships on its own and can be rolled back)

### Phase 0: prepare (no user-visible change)
1. Decisions are in §6; the two still-open items are asked before the phase that needs them.
2. Back up both databases (`pg_dump`). Export the data site's `subscribers` and `ticker_follows` with their consent columns to cold storage; this is legal evidence and must survive.
3. Set `SEC_USER_AGENT` to the real company name and a monitored email in every environment.
4. Code home: the merged app lives in **this repo** (`second-repo`). The App's code is copied in under the same Next.js app (both are Next 15). The App repo is kept read-only for history.

**Status (Nov 12): built.** A frozen copy of the old app is in `legacy/vercel-app/` (reference only; nothing imports it). `scripts/backup.sh` takes the backups and the consent export. Every new script refuses to contact the SEC without a real `SEC_USER_AGENT`; there is no default. The owner's steps (backups, keys) are in `docs/RUNBOOK.md`.

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
   - Newswire press rows are **not** copied. *(Changed by decision 10: headlines and links are copied; see §4.1.)*
4. Row counts are checked before and after. Each copy is a script that can run again safely.

**Status (Nov 12): built and tested on a local throwaway Postgres; not yet run on the real databases.** `npm run db:migrate` applies the migration files, `npm run companies:load` loads the company list, `npm run backfill` copies the old data (`--dry-run` first). The copy only reads the old tables, reports every row it read, copied or skipped and why, compares the consent records character for character after copying, never switches an opted-out address back on, and records each saved run. The owner runs these against the real databases by following `docs/RUNBOOK.md`; nothing in this repo connects to production on its own.

### Phase 2: ingestion worker (requirement 3)
1. One SEC client: a token bucket at 8 requests/second shared by every job, User-Agent on every request, `If-Modified-Since`/`ETag` on feeds, `Retry-After`/exponential back-off on 403/429/5xx, raw responses cached on disk (filing indexes and exhibits never change, so cache them forever; feeds for 30 s).
2. Poll `getcurrent` Atom feeds for `8-K, 10-Q, 10-K, 4, DEF 14A` every 10 s during EDGAR filing hours and every 60 s otherwise (§2.1), upsert into `filings` (accession is the key, so re-reads are harmless). Catch up from the daily index on start-up if the worker was down.
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
1. **Matcher (runs the moment a filing is stored, before any summary; §2.1):** for each new filing, news item or pick, insert one `alert_events` row per matching active subscription. The unique `(subscription_id, dedupe_key)` makes double sends impossible, even if the worker restarts mid-run.
2. **Sender:** picks `queued` rows with `FOR UPDATE SKIP LOCKED`, sends, records `provider_message_id`; on failure, retries with back-off up to 5 times, then marks `failed`. Respects provider rate limits.
3. **Digest:** `cadence='digest'` rows become `status='digest'`; one email per subscriber at 6:00 PM ET (computed in `America/New_York`, so it doesn't drift with daylight saving).
4. **Email:** double opt-in for every list, including the main sign-up. RFC 8058 one-click unsubscribe (POST only); a plain link click opens a confirmation page instead of unsubscribing at once. Postal address in every email footer.
5. **SMS (later add-on; off at launch, decision 15):** double opt-in: the sign-up sends "Reply YES to confirm BigStocks alerts for $AAPL. Msg & data rates may apply. Reply HELP for help, STOP to cancel." The subscription is active only after YES. STOP (and its synonyms) unsubscribes every SMS subscription for that number and is confirmed once; HELP replies with program name, contact and the STOP line; START re-subscribes. Carrier (10DLC) registration must be approved before launch.
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

## 6. Decisions (owner, Nov 10 and Nov 12, 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Is `second-repo` the data.bigstocks.com codebase? | Yes. It is the home of the merged app. |
| 2 | Track records | **Eliminated for now** (reopened, see Open below). Remove the public track record (`/track-record`, `/api/alerts/export`, `ResultsStrip`, `ResultBadge`, homepage track-record section) and the picks' return-vs-S&P numbers (`picksWithResults`). Picks themselves stay, as a dated list with their sponsored disclosures. The data site's `alerts` table stops being public; its rows are copied into the merged `picks` table as send history (never deleted: sponsored-alert disclosures are a compliance record). |
| 3 | Level 2 | **Gone** everywhere: tab, page, links, copy, `l2_trial_ends_at`, membership wording. |
| 4 | AI summary scope | **Only filings users want:** (a) when someone opens a filing or a stock page, its unsummarized filings are queued; (b) every new filing of a company that has at least one active email or SMS alert subscription. No market-wide summaries. Batch backfill only for companies with active subscriptions. |
| 5 | Form 4 | Rule-based from the XML, no AI. |
| 6 | Membership | **No paid plan for now; every signed-up user is a free member.** Remove Stripe entirely: `src/lib/stripe.ts`, `/api/billing/*`, `/api/stripe/webhook`, `scripts/stripe-setup.mjs`, `/membership`, `MembershipButtons`, `BillingActions`, the admin "grant membership" tool, the `stripe` package and `STRIPE_*` env vars. Picks marked members-only become visible to everyone (drop the `tier` gating and the lock in `PickCard`). Stripe was only ever in test mode, so no real subscribers are affected. |
| 7 | Hosting | **Everything on the DigitalOcean Droplet**: web app and worker, both under PM2 (`ecosystem.config.cjs`). Leave Vercel: delete `vercel.json` (its crons move into the worker) and `.vercelignore`. Nginx in front of `next start` on port 3000, HTTPS with Let's Encrypt (certbot, auto-renew), gzip, and a 301 from `www` to the apex (or the reverse). Env vars live in a root-only `.env` on the server, never in git. `NEXT_PUBLIC_*` values are baked in at build time, so build on the server after changing them. Database stays on Supabase (sign-in and chat need it). |
| 8 | Design | **The design canvas https://claude.ai/artifact/CBQEHEYTnEUTiisb62xwYo is the design** (owner, Nov 12). It replaces direction B. Homepage = the artboard "15 · FINAL" (`Final15`) plus `PhoneHome` for phones. Every page in the "Other pages", "Remaining pages" and "Legal pages" rows is approved: stock, filing, news, picks, my alerts, confirm, health check explained, settings, search, sign-in, companies, unsubscribe, the empty and error states, the phone stock page and the four legal pages. Style: light only, Manrope, white with a soft mint glow, ink `#0c1a12`, brand green `#0f9a55`, rounded cards, pill buttons, one centred column. |
| 9 | Health check for emerging growth companies | Companies that check the SEC's "emerging growth company" box get a **separate rule set**; the current 4 checks (sales grew, made a profit, profit grew, margin held) unfairly mark most young, pre-profit companies Weak. Same Strong / Mixed / Weak output and the same "not investment advice" note; the page says which rule set was used; `rule_set` column on `fundamentals_snapshots`. **Status: approved by the owner on Nov 13, 2026, as proposed.** The growth rules are on (`HEALTH_GROWTH_RULES=0` switches them off). The rule set is in §6.1. |
| 10 | News sources (Nov 12) | **Keep the newswires and add Benzinga, Stock Titan and other sources**; not SEC 8-K exhibits only. Every source has a row in `news_sources` saying whether we may store its text and whether we may summarize it. A source is switched on only once its terms or licence allow our use; until then it stays off. SEC material is public domain and always on. |
| 11 | Plain English (Nov 12) | Plain-English names everywhere: Quarterly report, Annual report, Company news, Insider trade, IPO filing, Shareholder vote. A form code appears only in brackets after the plain name. |
| 12 | Prices (Nov 12) | **No price moves in any feed.** Prices and charts are TradingView widgets only; our server never fetches, stores or shows a price. |
| 13 | Summaries in place (Nov 12) | On every feed, clicking a headline opens the AI summary in place, with the AI label and the link to the original. |
| 14 | Sign-in (Nov 12) | **Email magic link only.** No passwords and no Google sign-in. |
| 15 | Alerts channel (Nov 12) | **Email only for now, to go live sooner.** Text alerts (Twilio) are a later add-on. The mobile field in the approved design (decision 8 shows email and mobile with equal weight) is built but hidden while `SMS_ENABLED` is off, so no phone number is collected before texts can be sent lawfully (carrier registration, consent wording). Phone numbers and consent records already collected on the old site are kept exactly as recorded and are not texted. |
| 16 | Advertise page (Nov 12) | No prices shown: "Contact us for pricing". The inquiry form asks for email and phone. |
| 17 | Legal pages (Nov 12) | Disclaimer, privacy, terms and SMS terms ship as **draft templates**, marked as drafts in the code; the owner's lawyer reviews them before launch. |
| 18 | Definition of done (Nov 12) | **A complete website published on the DigitalOcean Droplet with everything working.** Work continues through Phases 0 to 6 without stopping after Phase 1. |

### 6.1 Growth rule set (decision 9; approved by the owner on Nov 13, 2026)

**Who it applies to.** A company that ticks the SEC's "emerging growth company" box **and** lost money from its operations over the last four quarters. An emerging growth company that is already profitable keeps the standard rules. Blank-check companies (SPACs) and funds get "No score".

**The five checks**, each answered for each of the last four quarters:

| # | Check | SEC data it uses |
|---|---|---|
| 1 | Sales grew compared with the same quarter a year ago | Revenue (`Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet`, collaboration revenue) |
| 2 | Got closer to profit: the operating loss is a smaller share of sales than a year ago, or there is an operating profit | `OperatingIncomeLoss` (falls back to `NetIncomeLoss`), revenue |
| 3 | A year of cash or more: cash and sellable investments cover at least 12 months of the cash the business uses | Balance-sheet cash and investments; `NetCashProvidedByUsedInOperatingActivities` over the last 12 months. Passes automatically when operations bring cash in |
| 4 | Two years of cash or more (at least 24 months) | Same as check 3 |
| 5 | Few new shares issued: the average share count is up 20% or less on a year ago | `WeightedAverageNumberOfSharesOutstandingBasic` (and the diluted figures as fallbacks). Not counted in roughly the first year as a public company |

**Verdict.** The same cut-offs as the standard rules: 75% or more of the answers are yes = Strong; 50 to 74% = Mixed; under 50% = Weak; fewer than 8 answers = "No score yet".

**No sales yet** (sales are zero, or under a tenth of costs): checks 1 and 2 are not counted, so the verdict rests on cash and new shares.

**What it changes.** Tested on 55 real Nasdaq and NYSE emerging growth companies that are not yet profitable: today's rules give 1 Strong, 16 Mixed, 35 Weak, 3 no score; the proposed rules give 13 Strong, 12 Mixed, 28 Weak, 2 no score. Moving the share limit from 20% changes the Strong count (10% gives 10, 30% gives 15); Weak stays at 28 or 29.

**Corrections found when the proposal was checked against the raw filings** (they apply to both rule sets and are built into the Phase 2 scorer): use four quarters in a row only; build the cash figure from balance-sheet lines so nothing is counted twice; skip a quarter whose figures do not add up to the year; treat a missing 12-month figure as unknown rather than as a profit; use the latest filed figure after a restatement; recognise SPACs by their trust account rather than by industry code alone; read the diluted share count when the basic one is missing; prefer figures from annual and quarterly reports over registration filings.

### 6.2 Decisions made while building (Nov 12 to 13), for the owner to confirm or change

These were not in the plan. Each was made to get to a working site sooner or to stay on the safe side; each can be changed.

| Topic | What was built | Why |
|---|---|---|
| Sign-in | The site sends its own one-time sign-in links through the same email service as the alerts. Supabase Auth is no longer used; accounts are rows in `users`, found by email, so people from the old app keep theirs. | One sender and one set of templates, nothing extra to configure in Supabase (its built-in mailer is limited to a few emails an hour), and it could be tested end to end. Decision 14 (link only, no passwords, no Google) is unchanged. |
| Confirming and signing in need one tap on the page | The emailed link opens a page with a button; the button does the confirming or signing in. | Mail scanners open every link in a message. Without the button they would confirm sign-ups nobody confirmed, and use up sign-in links. |
| Confirming a sign-up also signs you in | The first confirmation creates the free account. | "Alert me" then works in one click, and My stocks shows what was followed. |
| Live chat | Not in the new site. Its tables are kept. | It is not in the approved design (decision 8). |
| Company list | Every ticker in the SEC's list, including OTC. | See §4.1. |
| Followers who are not on the data site's general list | Copied as off the list. | See `docs/RUNBOOK.md` A5. The safe reading of an unclear record. |
| Sponsor page numbers | 125,000 subscribers, 1,000,000 daily impressions, 5,000 daily clicks (the figures the old site already published). | The design's "16.7% open rate" and "45,000 text followers" were sample numbers. |
| Legal pages | Published as the approved drafts, with their `[BRACKETS]` still to fill in. They still describe text alerts in places. | Decision 17: lawyer review before launch. |
| Newswires at launch | PR Newswire and Business Wire are switched on, **confirmed by the owner on Nov 13**. Headline, time and link only: their text is not stored and not summarized. GlobeNewswire, ACCESS Newswire, Benzinga and Stock Titan are listed but off until there is a licence or permission. | Decision 10. |
| "Profit" in the standard health check | Profit from operations (what the business earned from selling its products), for all three profit checks: made a profit, profit grew, margin held up. **Owner's decision, Nov 13.** A company whose filings have no such line (banks, insurers, some others) is scored on its overall profit, and its page says so. | On live data a company that lost $433M running its business in a quarter showed as profitable, and Strong, because of an accounting gain. |
| Insider trades in the lists | A burst of insider trades from one company (several people reporting within an hour) is one row that opens to show each. The "Insider trades" filter still lists every one. **Owner's decision, Nov 13.** | They are about 40% of all filings; eight in a row from one company pushed everything else off the homepage. |
| Access to the new tables | Only the site's server can read or change them. The "read your own rows" rules written for Supabase sign-in were removed, and the public roles have no rights on these tables. | The site signs people in itself, so those rules were only a way in for someone else. |
| Database connection | Always encrypted when the database is on another machine; checked against Supabase's certificate when `DATABASE_SSL_CA` is set. | The driver sends everything in clear text unless told otherwise. |
| Law-firm notices on the newswires | Left out. | On the live PR Newswire feed, every headline that named a listed company was a law firm looking for plaintiffs ("SHAREHOLDER ALERT: ... Class Action Against NVIDIA"). They are adverts, not company news, and would have gone out as alerts. |
| Insider trades by email | Three or more insider trades from one company that arrive together go to a follower as **one email** listing each. One or two go out on their own, and trades on different days are never merged. To make this possible every insider-trade alert waits 5 minutes before it is sent; all other alerts go at once. **Owner's decision, Nov 13.** | A follower would otherwise get eight emails in a minute when a company hands out its stock awards. |
| Old alerts are dropped, not sent late | An alert that could not be sent within 6 hours is dropped. | After an outage, a burst of stale "news" is worse than none. |
| Summaries of very long reports | Above about 400,000 characters, the opening and the results sections are sent to the model, and it is told so. | Cost and speed. Most filings are far shorter. |
| Batch re-writing of old summaries (Phase 3 step 4) | Not built. | Not needed to go live: summaries are written on demand and for followed companies. |
| Disk cache and conditional requests for the SEC client (Phase 2 step 1) | Not built. The 8-requests-a-second limit, the contact line on every request and the 10-minute stop on a refusal are. | Not needed at this volume. |

### 6.3 Where each phase stands (Nov 13)

| Phase | State |
|---|---|
| 0 Prepare | Built. |
| 1 Schema and copy | Built and tested on local databases, including two hostile reviews (of the copy and of the schema files) whose findings are fixed. Not yet run on the real databases (the owner runs it: `docs/RUNBOOK.md` Part A). |
| 2 Worker | Built and tested against saved samples and a stand-in for the SEC. **Run against the live SEC on Nov 13** with the owner's contact line, on a local throwaway database: the company list, two polls of the latest filings (1,100 filings, then only the 15 new ones), 700 filing details with no failures, 143 press releases, 140 insider-trade summaries, and the record and health check of 12 companies. The run found and fixed three things: press-release headlines (wrong for about a third of real documents), Business Wire headlines (all were being dropped) and law-firm notices. Both health check rule sets are on (decision 9 approved). |
| 3 Summaries | Built and tested with a stand-in for Claude. Not yet run against the live API (needs the key on the server). |
| 4 Alerts | Built and tested: sign-up, confirmation, matching, sending, daily summary, unsubscribe, bounces. Email only. Not yet sent through the real email service. |
| 5 Site | Every approved page is built in the approved design and checked in a browser, on desktop and phone widths. TradingView charts could not be seen in the build environment (its network blocks them); the page shows "Chart unavailable" there and the rest works. |
| 6 Go live | Tooling and the runbook (Part B) are written. **The site is not on the Droplet yet**: that needs access to the server, the keys and the DNS, which only the owner has. |

### Open
- **Track record vs "win big" (decision 2, reopened; owner: "maybe").** Either (a) bring back an honest public record of every free alert, wins and losses, with the price staff record at send time and the day's close entered the same way (sponsored alerts shown separately and never counted as wins), or (b) keep it removed and drop "win big" style claims from the site, emails and texts, and talk about speed and news instead. Needed before Phase 5 (homepage copy) and before any marketing.

Scope changes that follow from these:
- Drop `track_alert` from `alert_events.item_type`, and `published_alerts` from the kept tables.
- Phase 3 step 1 becomes: summarize on view and for subscribed companies only (decision 4).

