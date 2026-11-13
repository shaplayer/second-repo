---
name: finance-ui
description: The approved BigStocks design and how pages are built (colours, type, cards, buttons, feed rows, sign-up forms, wording rules). Use whenever building or changing a page or a component.
---

# Building pages on BigStocks

The approved design is the canvas named in decision 8 of `docs/MIGRATION_PLAN.md`. Port from it; do
not invent a new look.

## The look
- Light only. Manrope. White with a soft mint glow at the top (`.page`). Ink `text-ink`, secondary
  `text-ink-2`, quiet `text-muted`. One brand green (`bg-brand`); the bright green (`btn-bright`) only
  on the dark card.
- Tokens and component classes are in `app/globals.css`: `.wrap`, `.card`, `.card-raised`,
  `.card-mint`, `.card-dark`, `.btn` with `.btn-dark` / `.btn-brand` / `.btn-bright` / `.btn-soft` /
  `.btn-outline` / `.btn-lg`, `.chip`, `.eyebrow`, `.fine`, `.field`. Use them before writing new CSS.
- Rounded cards with a hairline ring, pill buttons at least 44px tall, one centred column.
- Every page works at 390px wide with no sideways scrolling.

## Building blocks
- `Shell` (header, footer, glow) wraps every page.
- `FeedList` is the live list: filters, new-post bar, summary opening in place, "Alert me".
  `FeedRows` is the plain list. `ItemPage` is the page for one filing or release.
- `SignupForm` / `SignupCard` for every sign-up. The consent sentence comes from
  `components/signup/consent.ts` and is stored word for word with the sign-up: change it there only.
- `HealthCard`, `HealthPill`, `TypeBadge`, `Initials`, `TimeAgo`, `Countdown`.
- Times are New York time (`lib/time.ts`).

## Wording
- Plain English for people who have never read a filing. "Quarterly report", never "10-Q" alone.
  Names come from `lib/plain.ts`.
- Never "Buy" or "Sell". The health check says Strong, Mixed or Weak and always carries "not
  investment advice".
- No prices or price moves in any list. No track-record claims ("winning picks", returns).
- An AI summary is always labelled "AI-generated. Can contain mistakes." with a link to the original.
- A sponsored pick always shows who paid, how much and in what form.
- Text alerts are off (`smsEnabled()`): show no mobile field and promise no texts.

## States
Every part of a page that loads data has a plain sentence for "nothing yet", "still loading" and
"could not load", and the rest of the page keeps working when one part fails.
