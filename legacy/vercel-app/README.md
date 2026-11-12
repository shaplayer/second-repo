# BigStocks

Plain-English stock research: search a stock, see its news, SEC filings explained in plain words, a simple
**Strong / Mixed / Weak** fundamentals score, instant filing alerts, in-house stock picks, live chat, and paid memberships.

- **Live:** https://bigstocks.vercel.app (Stripe in test mode, see [docs/HANDOFF.md](docs/HANDOFF.md))
- **Start here if you're new:** [docs/HANDOFF.md](docs/HANDOFF.md) covers what's built, how it fits together, every service and key, decisions and why, known issues, and what's next.

## Run it locally

Requirements: Node 20+ (built with Node 24), npm.

```bash
npm install
cp .env.example .env     # then fill in values; see "Environment variables" in docs/HANDOFF.md
npm run dev              # http://localhost:3000
```

The fastest way to get working keys, once you've been added to the Vercel team:

```bash
npx vercel link --project bigstocks --scope bigstocks
npx vercel env pull .env --environment=production  # copies the production settings into .env (real keys; treat with care)
```

Then set `APP_URL=http://localhost:3000` in `.env` so links in emails point to your machine.

Optional, for filing alerts while developing locally (production uses Vercel Cron instead):

```bash
npm run alerts            # checks the SEC for new filings every minute against http://localhost:3000
```

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000. Run only **one** at a time; two dev servers share `.next/` and break routing. |
| `npm run typecheck` | TypeScript check |
| `NEXT_DIST_DIR=.next-build npm run build` | Production build into a separate folder, so it doesn't disturb a running dev server |
| `npx vercel deploy --prod --yes --scope bigstocks` | Deploy to production |
| `node scripts/stripe-setup.mjs` | Creates/updates the Stripe product, prices and billing portal; writes price IDs to `.env` |

## Stack

Next.js 15 (App Router, TypeScript) on Vercel · Supabase (Postgres, Auth, Realtime) · Databento (market data) ·
SEC EDGAR (financials and filings) · Claude API (filing summaries) · Resend (email) · Stripe (memberships).
