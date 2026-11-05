# BigStocks.com

Homepage for BigStocks: free pre-market stock alerts, a live press release + SEC filings feed,
Level 2 link, public track record preview and an Advertise teaser for sponsors.
Plan: [`docs/HOMEPAGE_PLAN.md`](docs/HOMEPAGE_PLAN.md).

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind 4 · Postgres · cobe (globe)

## Run locally

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and SEC_USER_AGENT
npm run db:init             # create tables (subscribers, news_items, alerts)
npm run dev                 # http://localhost:3000
```

No database or internet? Preview with fictional sample data (dev only, never in production):

```bash
FEED_SAMPLE=1 npm run dev
```

## Swap in your existing pages

Set these in `.env` (no code change needed):

| Variable | Points to |
|---|---|
| `NEXT_PUBLIC_LEVEL2_URL` | Your Level 2 streaming landing page |
| `NEXT_PUBLIC_ALERTS_URL` | Your pre-market alert countdown page |
| `NEXT_PUBLIC_ALERT_HOUR_ET` / `NEXT_PUBLIC_ALERT_MINUTE_ET` | Homepage countdown target, US Eastern (default 8:00) |

Other links and the audience number live in `lib/site.ts`. `NEXT_PUBLIC_*` values are baked in at build time, so rebuild after changing them.

## News & filings data ($0)

- **SEC filings:** SEC EDGAR's latest-filings Atom feed (8-K, 10-Q, 10-K, S-1, S-3, 6-K, 424B4, 13D), mapped to tickers with SEC's official `company_tickers.json`. Ticker search also pulls that company's recent filings from `data.sec.gov`. SEC requires `SEC_USER_AGENT` to include a real contact email.
- **Press releases:** public RSS from GlobeNewswire, PR Newswire, Business Wire and ACCESS Newswire (`lib/feeds/sources.ts`). Only releases naming a ticker (e.g. `(NASDAQ: ABCD)`) are kept.
- **Ingest worker:** `npm run ingest` loops every 3 min (`INGEST_INTERVAL_SEC`) and upserts into `news_items`. Run `npm run ingest:once` first: it prints item counts per source, so you can fix or remove any feed URL that returns 0.
- Without a database the site fetches the sources live and caches them in memory for 5 minutes.

## Deploy on DigitalOcean (Droplet + PM2 + Nginx)

```bash
git clone <repo> /var/www/bigstocks && cd /var/www/bigstocks
npm ci && cp .env.example .env && nano .env
npm run db:init && npm run ingest:once
npm run build
pm2 start ecosystem.config.cjs && pm2 save
```

Nginx (then run `certbot --nginx -d bigstocks.com -d www.bigstocks.com` for SSL):

```nginx
server {
  server_name bigstocks.com www.bigstocks.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Advertise page (`/advertise`)

- Packages, prices and deliverables: **`lib/advertise.ts`** (used by `/advertise` and the homepage teaser).
- Audience numbers (125,000 subscribers, 1M+ daily impressions, 5,000+ daily clicks): `lib/site.ts`.
- "Request a campaign" form saves to the `inquiries` table. See new requests with:
  `SELECT created_at, company, ticker, email, phone, package, message FROM inquiries WHERE handled_at IS NULL ORDER BY created_at DESC;`
  (Email notifications aren't wired up yet; that needs an email provider.)

## Track record

The homepage shows the latest rows of the `alerts` table, wins and losses. Until rows exist it says
"launching soon" (it never shows made-up numbers). Sponsored alerts **must** have `sponsor_comp`
(the database enforces it), and they render with a "Sponsored" label (SEC §17(b)).

## Checks

```bash
npm run lint   # typecheck
npm test       # feed parser tests
npm run build
```
