# Old Vercel app: reference copy

This folder is a frozen copy of the old BigStocks app that ran at bigstocks.vercel.app.

- Source: `shaplayer/VideoCLAUDE-APP-MODEL-FOR-STOCKS`, commit `098b6f6dfb4deebb7b4a43cd61a8de4ab9df930e`
- Copied: November 12, 2026 (every tracked file except `package-lock.json`; `CLAUDE.md` is renamed `CLAUDE.legacy.md` so
  its old paths and commands are not picked up as instructions for this repository. Its rules live on in `/CLAUDE.md`.)
- Why it is here: `docs/MIGRATION_PLAN.md`, Phase 0 step 4. The merged app lives in this repository; the old
  repository stays read-only for history.

**Nothing in this folder is built, type-checked, tested or deployed.** It is excluded in `tsconfig.json` and in
`app/globals.css`. Do not import from it. Each part is moved into the real app (under `app/`, `components/`, `lib/`,
`scripts/`) in the phase that needs it, and adapted there.

| Part | Where it goes | Phase |
|---|---|---|
| `supabase/migrations/*.sql` | Copied unchanged to `/supabase/migrations/` (they are the history of the one database) | 1 (done) |
| `src/lib/sec.ts`, `fundamentals.ts`, `plain.ts`, `time.ts` | SEC client, health check and plain-English filing names | 2 |
| `src/lib/summarize.ts`, `filingText.ts` | AI summaries | 3 |
| `src/lib/alerts.ts`, `email.ts`, `store.ts` | Alert matching and email, on the new tables | 4 |
| `src/app/**`, `src/components/**` | Rebuilt in the approved design; the old pages are reference only | 5 |
| `src/lib/databento.ts`, `stripe.ts`, `src/app/api/billing`, `api/stripe`, `api/quotes`, `api/chart`, `membership`, `vercel.json`, `.vercelignore`, `scripts/stripe-setup.mjs` | Not carried over (plan decisions 1, 3, 6 and 7) | never |

When the plan names a path such as `src/lib/databento.ts`, it means the file under this folder.
