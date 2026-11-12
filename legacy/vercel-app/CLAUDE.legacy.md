# BigStocks: notes for AI coding assistants

Read `docs/HANDOFF.md` first. It has the product rules, architecture, services, decisions and roadmap.

Rules that matter most:
- Never show "Buy"/"Sell" recommendations. The score is Strong / Mixed / Weak, with a "not investment advice" note.
- UI copy is plain English for non-experts; avoid finance jargon (say "Quarterly report", not "10-Q").
- Sponsored picks must always carry the payer/amount/form disclosure (enforced in the database too). Picks are never deleted.
- App data tables are server-only (Supabase secret key in `src/lib/store.ts`); don't add client-side access to them.
- Run only one `next dev` per folder. Test builds: `NEXT_DIST_DIR=.next-build npm run build`.
- Database changes: add a new file in `supabase/migrations/` and apply it to Supabase; don't edit old migrations.
- Never commit `.env` or paste keys into code, docs or chat.

Checks before finishing a change: `npm run typecheck` and a test build.
