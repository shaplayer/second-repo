# BigStocks: developer handoff

Last updated: October 14, 2026. This document is the full context for picking up the project: what the owner wants,
what's built, how it works, every outside service, the decisions made along the way (and why), known problems, and
the plan from here.

---

## 1. The product

**Owner's vision, in their words:** a "nice simple homepage. I enter the stock, one click I get my news, one click I get
my data… it's there where I can see it, I can visualize it." Competitors are Investors Hub and Yahoo Finance, which the
owner finds too complicated. The owner likes Google Finance's layout and chose a **Google Finance–style homepage**.

Who it's for: everyday investors who "don't know what an 8-K is and don't want to know." They want to know whether a
stock is healthy, and the moment something happens (news at 6:00 AM should be in their inbox at 6:00 AM).

Brand: **green, black and white**. Name: **BigStocks** (domain bigstocks.com, hosted at SiteGround). The owner has also
mentioned **stockstobuy.io**; which domain to launch on is undecided (see §9).

### Product rules that shape the code
- **Never "Buy" / "Sell."** The score is **Strong / Mixed / Weak**, based only on reported fundamentals, always with a
  "not investment advice" note. This was chosen deliberately to stay on the right side of investment-advice rules.
- **Plain English everywhere.** No jargon in the UI. SEC form names are shown only as "Official name: 8-K".
- **Free:** search, charts, score, filings, summaries, alerts, chat, free picks.
  **Paid membership:** members-only picks now; real-time Level 2 and historical time & sales later.
- **Coverage:** Nasdaq and NYSE first. OTC later.

---

## 2. What's built

| Area | What it does | Main files |
|---|---|---|
| Homepage | Market summary (SPY/QQQ/DIA/IWM), watchlist with scores, latest announcements from your stocks, market trends (gainers/losers/most active), everyone chat | `src/app/page.tsx`, `src/components/Watchlist.tsx`, `LatestNews.tsx`, `MarketTrends.tsx` |
| Search | Ticker or company-name autocomplete over every Nasdaq/NYSE company from the SEC list | `src/components/SearchBox.tsx`, `src/app/api/search` |
| Stock page | Price, chart (1D to 2Y), key stats, the Strong/Mixed/Weak score with a 4-quarter ✓/✕ grid, filings, contact info, chat tab, Level 2 "coming soon" tab | `src/app/stock/[ticker]/page.tsx`, `PriceChart.tsx` |
| Fundamentals score | 4 checks × last 4 quarters: sales grew YoY, made a profit, profit grew YoY, margin held up. ≥75% Strong, ≥50% Mixed, else Weak | `src/lib/fundamentals.ts` |
| Filings in plain English | Every SEC filing renamed in plain words with an importance level; "Explain this in plain English" asks Claude for a summary, saved once and reused for everyone. Insider trades (Form 4) are summarized from the XML with no AI | `src/lib/plain.ts`, `summarize.ts`, `filingText.ts`, `src/app/api/explain` |
| Email alerts | "Get alerts" per stock; choose earnings, news, insider trades, picks; instant or daily summary (6 PM ET); double opt-in; one-click unsubscribe | `src/lib/alerts.ts`, `email.ts`, `src/app/api/alerts/*`, `src/app/alerts/*` |
| Filing watcher | Every minute: reads the SEC's latest-filings feed, matches followed companies, summarizes, emails. Runs on Vercel Cron | `src/app/api/cron/filings`, `vercel.json` |
| Picks | In-house investor picks plus **sponsored (paid) posts** with legally required disclosures; automatic track record vs. the S&P 500; picks can be closed but never deleted | `src/app/picks`, `src/lib/picks.ts`, `PickCard.tsx`, `src/app/api/admin/picks` |
| Accounts | Email magic link (sent through our own Resend) and Google sign-in via Supabase Auth; watchlist synced to the account | `src/lib/supabase/*`, `src/lib/account.ts`, `src/app/signin`, `src/app/auth/*`, `src/middleware.ts` |
| Chat | Everyone room plus per-stock rooms: a post mentioning `$AAPL` shows in both. Live via Supabase Realtime. Chat names, no links, speed limits, report (auto-hide at 3), moderator hide/ban | `src/components/Chat.tsx`, `src/app/api/chat/*`, `src/lib/chat.ts` |
| Memberships | Stripe Checkout: $49/month or $490/year, 7-day free trial once per account; Stripe billing portal; webhook syncs status | `src/lib/stripe.ts`, `src/app/membership`, `src/app/api/billing/*`, `src/app/api/stripe/webhook` |
| Admin | `/admin` (shared password): post picks/sponsored posts, close picks, grant memberships by hand, chat moderation | `src/app/admin`, `PickAdmin.tsx`, `MemberAdmin.tsx`, `ChatAdmin.tsx` |

Design mockup from the start of the project (both homepage styles, sample data): `docs/bigstocks-mockup.html`.

---

## 3. How it fits together

```
Browser ──► Next.js on Vercel (pages + /api routes)
              │
              ├─ Databento HTTP API ─────── prices & charts (EQUS.SUMMARY daily, EQUS.MINI intraday)
              ├─ SEC EDGAR (free) ───────── company list, financial facts, filings, latest-filings feed
              ├─ Claude API ─────────────── plain-English filing summaries
              ├─ Supabase ───────────────── Postgres (all app data), Auth (sign-in), Realtime (chat)
              ├─ Resend ─────────────────── all email (alerts, sign-in links, confirmations)
              └─ Stripe ─────────────────── checkout, billing portal, webhook → membership status

Vercel Cron ─► /api/cron/filings every minute, /api/cron/digest daily at 22:00 UTC
```

### Data and caching
- **Prices:** Databento's *historical* HTTP API (`src/lib/databento.ts`). Daily bars from `EQUS.SUMMARY`, minute/hour bars
  from `EQUS.MINI`. These datasets cost $0 on the current plan (checked with `metadata.get_cost`). Requests always pass
  `end` = the dataset's available end; without it Databento defaults to start + 1 day.
- **SEC:** every request sends `SEC_USER_AGENT` (the SEC requires a contact email) and must stay under 10 requests/second.
- **Caching:** fetches use Next's data cache (`next: { revalidate }`) so one visitor's load is shared with everyone.
  Fundamentals are cached 6 hours with `unstable_cache`. `src/lib/cache.ts` is a small per-server in-memory cache on top.
- **The database is server-only for app data.** Tables like `alert_subscribers`, `picks`, `filing_summaries` have row-level
  security on with no policies, so only the secret key (server) can touch them. Users can read only their own `profiles` and
  `watchlist` rows. Chat messages are readable by everyone but written only through `/api/chat`.

### Gotchas worth knowing (each cost real debugging time)
1. **SEC `acceptanceDateTime` time zones are inconsistent between filers** in the submissions JSON. We take exact times
   from each company's Atom feed (`<updated>` has a real offset) instead. See `acceptanceTimes()` in `src/lib/sec.ts`.
2. **Q4 isn't reported directly.** Companies report Q1–Q3 and the full year; Q4 = year minus the 9-month figure
   (`quarterly()` in `src/lib/fundamentals.ts`). Revenue/net-income tags differ by company (banks especially), so the
   freshest tag wins (`bestSeries`).
3. **Hidden chat messages can't be pushed to clients** (row-level security blocks them), so hiding a message also writes a
   row to `chat_hidden`, which open chat boxes listen for.
4. **Two `next dev` servers in one folder** share `.next/` and silently break routing (pages 404). Run one.
5. **Vercel blocks deploys of vulnerable Next.js versions.** `package.json` pins Next 15.5.27 and overrides `postcss` and
   `sharp` to patched versions.
6. **The Claude client is created lazily.** Constructing it at import time without a key broke the route in dev.
7. **`.env` gets edited by scripts** (`stripe-setup.mjs` writes price IDs). An editor with a stale copy open can overwrite it.

---

## 4. Services and accounts

Ask the owner to **invite you** to each one; keys should never be sent by email or chat.

| Service | Used for | Where | Notes |
|---|---|---|---|
| GitHub | Code | (private repo, see §8) | |
| Vercel | Hosting, cron, environment variables | Team **BIGSTOCKS**, project **bigstocks** | Pro trial. Per-minute cron requires Pro. |
| Supabase | Database, sign-in, realtime | Project **bigstocks**, ref `oaztvgpyihrulwecqmaa`, us-east-1 | Free plan. Schema is in `supabase/migrations/`. |
| Databento | Market data | Owner's account | Key was rotated once after being pasted in chat. |
| SEC EDGAR | Filings and financials | Public, no account | Needs `SEC_USER_AGENT` |
| Anthropic | Filing summaries (`claude-opus-5-5`, low effort, server-side fallback on) | console.anthropic.com | ~$0.02–0.10 per announcement, ~$0.50 per annual report; each filing summarized once |
| Resend | Email | resend.com | **Domain not verified yet**, so mail only reaches the owner's own address (see §9) |
| Stripe | Memberships | Test mode ("Sandbox") | Product "BigStocks Membership"; lookup keys `bigstocks_member_monthly` / `_yearly`; webhook → `/api/stripe/webhook` |
| Google Cloud | "Continue with Google" | Project **BigStocks** → Google Auth Platform | App not yet published; redirect URI is Supabase's `/auth/v1/callback` |
| SiteGround | bigstocks.com DNS | Owner's account | |

---

## 5. Environment variables

All listed in `.env.example`. Production values live in Vercel (Project → Settings → Environment Variables).

| Variable | Secret? | Purpose |
|---|---|---|
| `DATABENTO_API_KEY` | yes | Market data |
| `SEC_USER_AGENT` | no | Identifies us to the SEC, e.g. `BigStocks.com admin@bigstocks.com` |
| `ANTHROPIC_API_KEY` | yes | Claude summaries |
| `RESEND_API_KEY` | yes | Sending email (a sending-only key is enough) |
| `ALERT_FROM_EMAIL` | no | Sender. Currently `onboarding@resend.dev`; change to `alerts@<domain>` after domain verification |
| `APP_URL` | no | Public address used in email links. `http://localhost:3000` locally, `https://bigstocks.vercel.app` in production |
| `CRON_SECRET` | yes | Protects `/api/cron/*` (Vercel Cron sends it automatically as a Bearer token) |
| `ADMIN_PASSWORD` | yes | `/admin` sign-in |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no | Supabase in the browser |
| `SUPABASE_SECRET_KEY` | **yes, full database access** | Server-only Supabase client |
| `NEXT_PUBLIC_AUTH_GOOGLE`, `NEXT_PUBLIC_AUTH_APPLE` | no | `on` shows that sign-in button. Google is on, Apple off |
| `STRIPE_SECRET_KEY` | yes | Currently a test key. Use a restricted live key at launch (Products, Prices, Customers, Checkout Sessions, Subscriptions, Customer portal: write) |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | no | Written by `scripts/stripe-setup.mjs` |
| `STRIPE_WEBHOOK_SECRET` | yes | Signing secret of the webhook endpoint |

`NEXT_PUBLIC_*` values are baked in at build time: change them, then redeploy (or restart `next dev`).

---

## 6. Database

Supabase Postgres. The full schema is the migrations in `supabase/migrations/` (apply in order to recreate it in a new
project). Summary:

- `profiles`: one per user; plan (`free`/`member`), `member_until`, Stripe fields, `display_name` (public chat name, unique),
  `chat_banned`. Created by a trigger on sign-up.
- `watchlist`: user ↔ ticker.
- `chat_messages`, `chat_reports`, `chat_hidden`: chat.
- `alert_subscribers`: email alert sign-ups (separate from accounts; signed-in users skip email confirmation).
- `filing_summaries`: one plain-English summary per SEC accession number.
- `seen_filings`: filings already handled by the watcher (inserting here also acts as a lock so two runs never double-send).
- `digest_queue`: filings waiting for daily-summary emails.
- `app_state`: key/value, e.g. `lastPoll`.
- `picks`: picks and sponsored posts. A **check constraint** refuses sponsored posts without payer/amount/form, and a
  **trigger refuses deletes**. Close a pick instead.

Membership is computed as `plan = 'member' and (member_until is null or member_until > now())`. Stripe is the source of
truth; `syncCustomer()` copies subscription state onto the profile. Manual grants from `/admin` have no Stripe customer.

---

## 7. Decisions and why

| Decision | Why |
|---|---|
| Strong/Mixed/Weak, not Buy/Sell | Explicit buy/sell calls are investment advice. Keep this wording. |
| Free features first, Level 2 later as paid | Level 2 needs licensed data and an always-on server; it's the paid centerpiece |
| SEC EDGAR + Databento, no second paid data vendor | Covered everything in phase 1 at no extra cost |
| Summaries made once per filing and shared | Keeps Claude cost proportional to filings, not readers |
| Insider trades summarized without AI | The Form 4 XML already has who/what/how many; free and exact |
| Email sign-in links sent by our Resend, not Supabase's mailer | Supabase's built-in mailer only reaches project members and is heavily rate-limited |
| Picks can't be deleted; sponsored posts excluded from the track record | An honest, auditable track record; ads shouldn't inflate results |
| Sponsored disclosure enforced in the database, not just the form | Securities Act §17(b) requires disclosing who paid, how much, and in what form for paid promotions; missing it is the most common reason the SEC fines promoters |
| No links in chat | Links are the main tool of chat spam and pump-and-dump schemes |
| Vercel (owner considered DigitalOcean) | Owner's choice. Level 2 will still need a separate always-on worker (see §9) |
| Membership $49/mo or $490/yr, 7-day trial | Owner's choice |

---

## 8. Getting set up as the developer

1. Get invited to: GitHub repo, Vercel team BIGSTOCKS, Supabase organization, Stripe, Resend, Anthropic, and Google Cloud
   project BigStocks.
2. `npm install`, then `npx vercel link --project bigstocks --scope bigstocks` and
   `npx vercel env pull .env --environment=production`. Set `APP_URL=http://localhost:3000`.
   Better long-term: create **separate development keys** (a second Supabase project from `supabase/migrations/`, Stripe test
   mode, a separate Resend key) so local work never touches production data.
3. `npm run dev` and open http://localhost:3000. For `/admin`, use `ADMIN_PASSWORD`.
4. Deploy with `npx vercel deploy --prod --yes --scope bigstocks`, or connect the GitHub repo in Vercel for automatic deploys
   (recommended next step).

---

## 9. What's next

### Before public launch (in roughly this order)
1. **Domain.** Decide bigstocks.com vs stockstobuy.io. Add it in Vercel (Project → Domains), set DNS at the registrar, then
   update `APP_URL`, the Supabase Site URL and redirect URLs, and the Google OAuth client.
2. **Supabase URL configuration** for the live site: Site URL `https://<domain>` and redirect `https://<domain>/**`. Without it,
   Google sign-in on the live site returns to localhost.
3. **Email domain.** Verify the domain in Resend (DNS records), then set `ALERT_FROM_EMAIL=BigStocks Alerts <alerts@<domain>>`.
   Until then, email only reaches the Resend account owner.
4. **Stripe live mode.** Restricted live key, `node scripts/stripe-setup.mjs` against live, a live webhook endpoint, and update
   the Vercel env vars. Turn on Stripe Tax if needed.
5. **Google sign-in:** publish the app (Google Auth Platform → Audience → Publish).
6. **Legal:** securities lawyer review (unlicensed in-house picks plus paid promotions), privacy policy, terms of use, a
   written no-selling-into-promotions ("scalping") policy for writers, and a chat code of conduct. The domain name
   "stockstobuy.io" should be part of that review.
7. **Error monitoring** (e.g. Sentry) and uptime checks on `/` and the cron.

### Known issues and technical debt
- **Prices aren't truly real-time.** The Databento historical API lags. Real-time needs Databento's Live API (a TCP stream),
  which can't run on Vercel functions.
- **The first visit to an uncached stock takes ~20 seconds**, mostly downloading the SEC companyfacts file (several MB).
  Fix: precompute fundamentals for followed/popular tickers in a cron job and store them in the database. A loading screen
  covers it for now.
- **In-memory rate limits** (sign-up, sign-in email, Explain, chat name) are per serverless instance. Move them to the
  database or Upstash.
- **Admin uses one shared password.** Replace it with staff roles on real accounts (an `is_admin` flag on `profiles`).
- **"News" is SEC announcements only** (8-Ks etc.). A news API (e.g. Polygon, Benzinga) would add press coverage.
- **Company names are ALL CAPS** for many companies (that's how the SEC lists them).
- **Berkshire Hathaway's company value and P/E are hidden** (share classes make the count unreliable); a sanity check hides it.
- **Score caveats:** quarterly values are derived (Q4 = year − 9 months); banks and unusual filers may lack a revenue tag (no
  score is shown then).
- **The daily summary cron is 22:00 UTC:** 6 PM ET in summer, 5 PM ET in winter.
- **No automated tests or CI.** Highest-value first tests: `quarterly()`/`buildScore()` in fundamentals, `explain()`,
  `mentionedTickers()`/`hasLink()`, and the alert matching in `pollFilings()`.
- **`src/middleware.ts`** is renamed `proxy.ts` in Next 16. Handle it when upgrading.
- `TREND_UNIVERSE` (homepage trends) is a hard-coded list of 30 large caps in `src/lib/universe.ts`.
- `scripts/migrate-store.mjs` was a one-time move from the old local JSON file; keep it for history only.

### Features still to build
1. **Level 2 + time & sales (paid centerpiece).** Databento has Nasdaq TotalView (`XNAS.ITCH`), NYSE (`XNYS.PILLAR`) and
   other venues on this key. Plan: an always-on worker (Railway, Fly, or DigitalOcean) holds the Databento Live connection,
   keeps an in-memory order book per subscribed symbol, and pushes snapshots to browsers (Supabase Realtime broadcast or its
   own WebSocket). Show it plainly: a buyers-vs-sellers bar, the book, and time & sales with green/red. The mockup's Level 2
   tab shows the intended look. **Confirm the Databento plan includes live data and redistribution to users** before building.
   Gate it on membership; `profiles.l2_trial_ends_at` exists for a Level 2-specific trial if wanted.
2. **Text-message alerts:** Twilio plus US carrier (10DLC) registration, which takes 1–3 weeks. The checkbox already shows "SOON".
3. **"Can I talk to the CEO?":** the Contact tab has phone/address from the SEC; adding investor-relations emails and
   earnings-call dates would need another source.
4. **OTC stocks** (owner wants these eventually; would need a different data source).
5. **Apple sign-in** (needs a $99/year Apple Developer account).

---

## 10. History in brief

1. **Oct 10:** requirements and a clickable mockup of two homepage styles; owner picked Google Finance style.
2. **Phase 1:** Next.js app with Databento prices and SEC fundamentals/filings, plus the Strong/Mixed/Weak score.
3. **Phase 2:** filing watcher, Claude summaries, Resend email alerts.
4. **Picks:** in-house picks plus sponsored posts with disclosures and an automatic track record.
5. **Phase 3:** Supabase accounts (magic link, then Google), synced watchlist, members-only picks.
6. **Chat:** realtime rooms with moderation.
7. **Payments:** Stripe memberships in test mode.
8. **Going live:** data moved from a local JSON file into Supabase; deployed to Vercel with cron; Stripe webhook connected;
   shared caching added for speed.
