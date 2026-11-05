# BigStocks.com — Homepage Build Plan (v1)

## 1. Goal

One homepage that does three jobs in one visit:

1. **Traders**: "These guys find big moves first." → sign up for free alerts.
2. **Companies / sponsors**: "125,000 people will see our news." → go to the Advertise page.
3. **Everyone**: "I can find any press release or SEC filing here in seconds." → come back daily.

The homepage is a hub. It links to pages that already exist or will be built next:

| Link | Destination (placeholder for now) | Status |
|---|---|---|
| Level 2 Streaming | `/level-2` → your existing landing page | Built, so swap the URL in |
| Pre-market Alerts (countdown) | `/alerts` → your existing countdown page | Built, so swap the URL in |
| News & Filings | `/news`, `/filings` | Phase 3 (preview on homepage in v1) |
| Track Record | `/track-record` | Phase 4 (preview slot on homepage) |
| Advertise | `/advertise` | Phase 2 |

All placeholder URLs live in one file (`lib/links.ts`), so swapping in the real ones is a one-line change.

---

## 2. Design direction: "the view from orbit"

The site should feel like looking at a globe: you see the whole picture at once, you can spin it, and nothing is crammed in your face.

**What that means in practice**
- **Wide, zoomed-out layout.** Max content width ~1360px with generous side margins. Big negative space and 120–160px between sections. Restrained type sizes (H1 ≈ 56px desktop, body 15–16px), never billboard-huge.
- **Hero globe.** A slowly rotating dotted globe (WebGL, `cobe` library, ~5KB) on the right of the hero. Glowing green pulse points mark market centers and recent alert activity. Users can drag to spin it. This is the brand image.
- **Map, not maze.** Every section is a "region" you can see from above: a short label, one headline, one action. A sticky nav lets you jump anywhere.
- **Motion is subtle.** A scrolling ticker tape, fade-up on scroll, number count-ups on stats. Respects `prefers-reduced-motion`.

**Palette (dark, premium, green for the green)**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#07090A` | Page background (near-black, not flat #000) |
| `--surface` | `#0F1214` | Cards |
| `--border` | `#1C2125` | Hairline 1px borders |
| `--text` | `#F4F6F5` | Primary text (white) |
| `--muted` | `#8B949A` | Secondary text |
| `--green` | `#12E27A` | Brand, CTAs, up moves |
| `--green-glow` | `#12E27A` at 15% | Glows, globe dots, focus rings |
| `--red` | `#FF5A5F` | Down moves / losses (used honestly in the track record) |

- Font: **Inter** (or Geist) with `tabular-nums` on every number.
- Cards: soft 16px radius, 1px border, faint inner gradient, no heavy shadows.
- Wordmark: **BIGSTOCKS** in bold geometric caps, with a small green upward "tick" mark in the O (SVG, designed in Phase 1).
- Note: the repo's `finance-ui` skill currently describes a white, Google Finance-style UI. Update it to this dark system in Phase 1 so future pages stay consistent.

---

## 3. Homepage, top to bottom

1. **Top bar**: wordmark · Alerts · News · Filings · Track Record · Level 2 · Advertise · **[Get free alerts]** (green button). Slim scrolling ticker tape underneath.
2. **Hero** (left: copy, right: globe)
   - Headline: *"See the whole market. Catch the big moves first."*
   - Sub: *"Our in-house scanners watch the market so you don't have to. Free pre-market stock alerts, sent to 125,000 subscribers."*
   - Sign-up: one input that takes email (SMS tab marked **"Coming soon"** until Twilio is live) + **[Get alerts free]**.
   - Stat strip: **125K subscribers** · alerts sent · avg. alert-to-open time (fill in real numbers only).
3. **Next alert band**: "Next pre-market alert in 02:14:33" with a live countdown → links to your existing `/alerts` page.
4. **News & Filings feed** (the "find it in 5 seconds" section)
   - Tabs: **Press Releases** | **SEC Filings**. Ticker search box: type `ABCD` and see that company's latest news and filings.
   - Each row: ticker chip · headline · source · "12 min ago" · filing-type badge (8-K, S-1, 10-Q…).
   - Shows the latest 8 items. "View all" → `/news` or `/filings`.
5. **How it works** (3 steps, icons): *Scanners & screeners* (months of in-house build) → *Alert fires* → *You get it first by email (SMS soon)*.
6. **Level 2 Streaming card**: short pitch plus **[Explore Level 2]** → your Level 2 landing page.
7. **Track record preview**: the last 5 alerts with timestamp, ticker, alert price, high after alert, and result, **wins and losses included**. "Full track record" → `/track-record`. Until real data is in Postgres it shows "Public track record launching soon" (never sample numbers).
8. **For companies (Advertise teaser)**: "Put your news in front of 125,000 active traders." Three package cards (names and prices shown as "from $X", filled in Phase 2) → **[See packages & audience]** → `/advertise`.
9. **Final CTA**: repeat the sign-up.
10. **Footer**: links, socials, and the **required disclosures** (section 6).

Mobile: one column, globe shrinks behind the hero copy, feed becomes a swipeable list. No horizontal scroll.

---

## 4. Tech stack (fits your DigitalOcean + Node + Postgres)

- **Next.js (App Router) + TypeScript + Tailwind**, built as a standalone Node app.
- **Deploy** on your DigitalOcean Droplet: `next build` (standalone) → PM2 → Nginx reverse proxy → Let's Encrypt SSL on `bigstocks.com`. Or use Docker if you prefer.
- **Postgres** (your in-house DB) tables:
  - `subscribers` (id, email, phone, sms_consent, consent_text, consent_at, ip, source, created_at)
  - `news_items` (id, ticker, title, url UNIQUE, source, published_at, kind `press|filing`, form_type)
  - `alerts` (id, ticker, alerted_at, alert_price, high_after, close_after, result, sponsored, sponsor_comp) for Phase 4, created now
- **API routes** (server-only, no keys in the browser): `POST /api/subscribe`, `GET /api/feed?kind=press|filing&ticker=`, `GET /api/alerts/recent`.

## 5. News & filings data: $0 to start

- **SEC filings: SEC EDGAR (free, official).**
  - Latest filings stream: EDGAR "current events" Atom feed (8-K, S-1, 10-Q, 424B, etc.).
  - Per-ticker: `data.sec.gov/submissions/CIK##########.json`, plus the SEC ticker→CIK map.
  - Rules: send a `User-Agent` with your company name and an admin contact email (an env var), and stay under 10 requests/sec.
- **Press releases: free newswire RSS feeds.** GlobeNewswire, PR Newswire, Business Wire and Accesswire publish public RSS. We parse, tag tickers (`NASDAQ: ABCD` patterns), and dedupe by URL.
- **Ingestion:** a small Node worker (node-cron, every 2–5 min) writes to `news_items`. The homepage reads from Postgres, so it's fast and never waits on a third party.
- **Later:** a client's press release shows up automatically. You'll be able to tell clients "it's on bigstocks.com/news/ABCD." Massive API can be added behind the same `lib/feeds/` module if you ever want real-time quotes.

## 6. Compliance (protects you *and* sells to sponsors)

- **Sponsored alerts are labeled.** A "Sponsored" tag plus a compensation disclosure on every paid alert (SEC Securities Act §17(b)). The track record shows sponsored vs. organic separately. Transparent disclosure makes sponsors look *more* credible, not less.
- **SMS consent (TCPA).** When SMS goes live: an unchecked consent checkbox, the exact consent text stored with a timestamp, and STOP/HELP handling via Twilio.
- **Email (CAN-SPAM).** Unsubscribe link and physical address in emails. Double opt-in recommended.
- **Footer.** "Not investment advice. Past performance does not guarantee future results. Data may be delayed. Sources: SEC EDGAR, [newswires]."

---

## 7. Build phases

| Phase | Deliverable | Notes |
|---|---|---|
| **1. Homepage (now)** | All sections above, wordmark, design system, live EDGAR + RSS feed preview, email sign-up to Postgres, placeholder links | Deployable to DO |
| 2. Advertise page | Packages, prices, real audience stats (125K), case studies, "Book a campaign" form | Needs your package names, prices, and open/click rates |
| 3. News & Filings pages | Full feed, per-ticker pages (`/news/ABCD`), search, "get alerts for this ticker" | Same data pipeline as Phase 1 |
| 4. Track record | Public, timestamped, wins and losses, sponsored flagged, filterable | Fed from your alert system into `alerts` |
| 5. SMS | Twilio sign-up + consent flow | Flip "Coming soon" to live |

## 8. Still needed from you (doesn't block Phase 1)

- Real URLs for the Level 2 landing page and alert countdown page
- Admin contact email for the SEC User-Agent (stored in `.env`, not committed)
- Any extra stats you can verify (open rate, alerts sent, monthly visitors)
- Sponsor package names and prices (Phase 2)
- Socials and business address for the footer
