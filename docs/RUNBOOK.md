# BigStocks runbook: the steps the owner runs

This is the list of things that have to be done on the real servers, in order. Everything here is run
by you (or someone you trust with the keys) on the DigitalOcean Droplet, in the project folder. Nothing
in this repository connects to the real databases on its own.

Every command that changes something has a "dry run" that shows what it would do and changes nothing.
Run the dry run first, read the output, then run it for real.

The plan these steps belong to is `docs/MIGRATION_PLAN.md`.

---

## Part A. Moving the data (plan Phases 0 and 1)

### A1. What you need before you start

| What | Where to find it |
|---|---|
| The Supabase connection string | Supabase dashboard, your project, **Connect**, "Session pooler" (port 5432). Not the transaction pooler (port 6543). |
| The data site's database connection string | The `DATABASE_URL` line in the `.env` file the data site uses on the Droplet today |
| Your SEC contact line | Your real company name and an email address someone reads, for example `Acme Research LLC sec-contact@acme-research.com` |

Put them in the `.env` file in the project folder on the Droplet (never in git, never in chat):

```
DATABASE_URL=<the Supabase connection string>
DATASITE_DATABASE_URL=<the data site's connection string>
SEC_USER_AGENT="<your company name> <your monitored email>"
```

The backup tool has to be at least as new as the database server. Supabase runs Postgres 15 or 17, so
install the version 17 client once:

```bash
sudo apt-get install -y postgresql-common
```

```bash
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
```

```bash
sudo apt-get install -y postgresql-client-17
```

Then install the project's packages:

```bash
npm ci
```

### A2. Back up both databases (do not skip)

```bash
npm run backup
```

This only reads. It writes a folder `backups/<date and time>/` with a full backup of each database and
the sign-up and consent records as spreadsheets (`consent-*.csv`). Check that it printed a size and a
table count for `app.dump` and `datasite.dump`.

**Copy that folder off the server and keep it** (your computer plus one other safe place). The consent
records are legal evidence that people agreed to hear from you. The files hold personal data, so treat
them like the keys.

Run the backup again right before step A6 (the switch-over).

### A3. Create the new tables

See what would be applied:

```bash
npm run db:migrate -- --dry-run
```

You should see every file dated `202611…` listed as "would apply", and seven older files counted
as already applied. Then apply them:

```bash
npm run db:migrate -- --yes
```

If the dry run lists files dated `202610…` as "would apply", your database's history does not record
the old app's tables. Use this instead, which marks those seven as done without running them:

```bash
npm run db:migrate -- --baseline 20261014004200 --yes
```

This step adds tables. It does not change or remove anything the old app or the old data site uses,
so both keep working. Each file is applied completely or not at all.

### A4. Load the company list

```bash
npm run companies:load -- --dry-run
```

```bash
npm run companies:load -- --yes
```

This downloads the SEC's list of companies and tickers (about 10,000) using your `SEC_USER_AGENT`. It
refuses to run if that line is missing or still a placeholder. Safe to run again at any time.

### A5. Copy the old data (rehearsal)

First a dry run. It does the whole copy, prints the report, then undoes everything:

```bash
npm run backfill -- --dry-run
```

Read the report:

- The table shows, for each kind of data, how many old rows were read, copied, refreshed, left alone
  or skipped. Every skipped row has its reason printed underneath.
- Every line under it must start with `PASS`. In particular `Consent records copied exactly` and
  `No opted-out address is active`.
- A full copy of the report is saved as `backfill-report-<time>.json`.

If a check says `FAIL`, nothing is saved, even without `--dry-run`. Send the report file to whoever is
helping you before going further.

Then copy for real:

```bash
npm run backfill -- --yes
```

This copies accounts, watchlists, filings, summaries, press headlines and alert subscriptions. It only
reads the old tables. You can run it as often as you like before the switch-over: each run picks up
new sign-ups and new opt-outs from the old sites, and leaves alone anything already changed on the new
site. It never switches an opted-out address back on.

What it deliberately does not copy:

- People who only followed companies and were never on the general list are not added to the general list.
- Phone numbers that never agreed to texts.
- Follows of tickers that are not in the SEC's company list (the report names them).
- The old sample and test news items.
- Picks and send history: these wait for A6, because the old app still uses the picks table.

### A6. The switch-over copy (later, on the day the new site goes live)

Do this only when Part B says so. In order:

1. Stop new sign-ups on the two old sites (Part B has the exact step).
2. Back up again: `npm run backup`.
3. Run the copy one last time, including picks and send history:

```bash
npm run backfill -- --cutover --dry-run
```

```bash
npm run backfill -- --cutover --yes
```

After this run the copy refuses to run again, because from then on the new site holds the latest data.
If the switch-over has to be repeated before the new site has opened to visitors, add `--after-cutover`.

### A7. If something goes wrong

- **A step fails with an error.** Nothing was half-done: each migration file and each copy run is all
  or nothing. Fix the cause (or ask) and run the same command again.
- **You want the new tables gone.** They are separate from everything the old sites use. Until the
  switch-over, the old sites do not depend on them, so they can simply be left unused.
- **You need the old data back.** Restore from the backup folder:
  `pg_restore --list backups/<folder>/app.dump` shows what is in it;
  `pg_restore --dbname "<connection string>" --clean --if-exists backups/<folder>/datasite.dump`
  restores the data site's database. Ask before restoring over the Supabase database: sign-in
  accounts live there too.

---

## Part B. Going live on the Droplet (plan Phase 6)

Written when Phase 6 is built. Until then the old sites stay exactly as they are.
