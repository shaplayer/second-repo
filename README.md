# BigStocks.com

Website for BigStocks: free pre-market stock alerts by email and SMS, live press release + SEC filings pages,
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

## News & filings pages

| Page | What it shows |
|---|---|
| `/news` | Every public-company press release, newest first, grouped by day. `?q=` searches headlines. |
| `/filings` | Latest SEC filings with form-type filters (`?form=8-K`, `10-Q`, `10-K`, `S-1`, `S-3`, `6-K`, `424B4`, `13D`). |
| `/news/ABCD` | Everything for one ticker: its press releases plus its full recent SEC filing history. Share this link with clients. |

The search box opens a ticker page for `$ABCD` or one short word (`AAPL`, `tsla`), and searches headlines for anything else.
"Load more" pages through the database (25 items per page).

## SMS text alerts (any provider)

Sign-up is live on every form (Email / Text tabs). A text sign-up requires the unchecked consent box. The exact consent
wording, time, IP and browser are stored with the number (`lib/sms-consent.ts`), and a welcome text is sent right away.

Sending is provider-neutral (`lib/sms/`). Choose with `SMS_PROVIDER`:

| `SMS_PROVIDER` | What happens |
|---|---|
| `console` (default) | Nothing is sent; texts are logged. Safe until a vendor is chosen. |
| `webhook` | Each text is POSTed to **your own service** (any vendor): `POST $SMS_WEBHOOK_URL`, `Authorization: Bearer $SMS_WEBHOOK_SECRET`, body `{"to":"+15555550123","body":"..."}`. |
| `twilio` | Built-in example adapter (`lib/sms/providers/twilio.ts`). |

**Adding a vendor** (Telnyx, Plivo, Vonage, Bandwidth…): copy `lib/sms/providers/twilio.ts`, implement the `SmsProvider`
interface in `lib/sms/types.ts` (`configured`, `send`, optional `parseInbound`), and register it in `lib/sms/index.ts`.

**Opt-outs:** point the vendor's inbound-message webhook (or your service) at `POST https://bigstocks.com/api/sms/inbound`.
The active provider authenticates and parses it. STOP / START replies are recorded in `subscribers`.
With `webhook`, send JSON `{"from":"+15555550123","body":"STOP"}` with the same Bearer secret.

**Broadcast** an alert to everyone opted in (dry run first, then add `--send`):
`npm run sms:broadcast -- "NWBT pre-market alert: ..."`. It skips anyone who replied STOP and adds "Reply STOP to opt out".
Sponsored alerts must include the compensation disclosure in the text.

**Before sending in volume:** US carriers require registration (A2P 10DLC or a verified toll-free number) with whichever
vendor you use, plus a privacy policy stating mobile numbers aren't shared for marketing. Terms link: `bigstocks.com/sms-terms`.

## Advertise page (`/advertise`)

- Packages, prices and deliverables: **`lib/advertise.ts`** (used by `/advertise` and the homepage teaser).
- Audience numbers (125,000 subscribers, 1M+ daily impressions, 5,000+ daily clicks): `lib/site.ts`.
- "Request a campaign" form saves to the `inquiries` table. See new requests with:
  `SELECT created_at, company, ticker, email, phone, package, message FROM inquiries WHERE handled_at IS NULL ORDER BY created_at DESC;`
- **Email notification:** every request is emailed to `INQUIRY_NOTIFY_TO` (comma-separated). Reply-To is the company's
  address, so hitting Reply answers them directly. If sending fails, the request is still saved, and the ingest worker
  re-sends missed notifications (last 3 days) on every pass. `notified_at` shows what was delivered.

### Email setup (any provider)

| `EMAIL_PROVIDER` | What happens |
|---|---|
| `console` (default) | Logs the email instead of sending. |
| `smtp` | Any SMTP service: Google Workspace/Gmail, Microsoft 365, Amazon SES, SendGrid, Postmark, Mailgun… Set `SMTP_HOST`, `SMTP_PORT` (587 or 465), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`. |
| `webhook` | POSTs each email as JSON to your own service: `EMAIL_WEBHOOK_URL` + `EMAIL_WEBHOOK_SECRET` (Bearer). |

New vendors: implement `EmailProvider` (`lib/email/types.ts`) and register it in `lib/email/index.ts`.
Send from an address on your own domain, with SPF/DKIM set up at your email provider, so notifications don't land in spam.

## Track record (`/track-record`)

Public, permanent record of every alert: stats (win rate, average move to close and to high), a results strip,
filters (organic / sponsored, wins / losses, ticker), methodology, and a full CSV download (`/api/alerts/export`).
It shows real rows only; until the first alert is logged it says "launching soon".

**Permanent by design:** the database blocks deleting alerts and blocks changing ticker, time, price or sponsorship
after insert. Only the outcome (`high_after`, `close_after`, `result`, `notes`) can be filled in later.

Your alert system logs alerts through the API (set `ALERTS_API_KEY`, 16+ chars):

```bash
# When an alert is sent
curl -X POST https://bigstocks.com/api/alerts -H "Authorization: Bearer $ALERTS_API_KEY" -H "Content-Type: application/json" \
  -d '{"ticker":"ABCD","alert_price":2.15,"alerted_at":"2026-11-05T12:58:00Z","sponsored":false}'
# -> {"id":"123"}

# After the close
curl -X PATCH https://bigstocks.com/api/alerts/123 -H "Authorization: Bearer $ALERTS_API_KEY" -H "Content-Type: application/json" \
  -d '{"high_after":2.71,"close_after":2.40}'
# result is computed from the close (win > alert price, loss <, flat =) unless you send "result"
```

Sponsored alerts must include `"sponsor_comp"` (e.g. `"BigStocks received $47,000 from the issuer"`); the API and the database reject them without it (SEC §17(b)).

## Checks

```bash
npm run lint   # typecheck
npm test       # feed parser tests
npm run build
```
