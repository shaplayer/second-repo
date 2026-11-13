# BigStocks runbook: the steps the owner runs

This is the list of things that have to be done on the real servers, in order. Everything here is run
by you (or someone you trust with the keys) on the DigitalOcean Droplet. Nothing in this repository
connects to the real databases on its own.

Every command that changes something has a "dry run" that shows what it would do and changes nothing.
Run the dry run first, read the output, then run it for real. Nothing is changed without `--yes`.

The plan these steps belong to is `docs/MIGRATION_PLAN.md`.

**Use a new folder.** The data site that is live today runs from its own folder on the Droplet. Leave
that folder alone until the switch-over. Put the new code beside it:

```bash
git clone --branch claude/modest-mayer-5zd6rx https://github.com/shaplayer/second-repo.git ~/bigstocks-new
```

```bash
cd ~/bigstocks-new
```

Every command below is run in `~/bigstocks-new`. (Once the branch is merged, replace the branch name
with `main`.)

---

## Part A. Moving the data (plan Phases 0 and 1)

### A1. What you need before you start

| What | Where to find it |
|---|---|
| The Supabase connection string | Supabase dashboard, your project, **Connect**, "Session pooler" (port 5432). Not the transaction pooler (port 6543). |
| The data site's database connection string | The `DATABASE_URL` line in the `.env` file the data site uses on the Droplet today |
| Supabase's certificate file | Supabase dashboard, your project, **Database settings**, "SSL Configuration", **Download certificate**. Save it on the Droplet, for example as `~/supabase-ca.crt` |
| Your SEC contact line | Your real company name and an email address someone reads, for example `Acme Research LLC sec-contact@acme-research.com` |

Make the settings file once, from the example, and protect it:

```bash
cp .env.example .env
```

```bash
chmod 600 .env
```

```bash
nano .env
```

Fill in these four lines now (never in git, never in chat). The rest of the file is for Part B:

```
DATABASE_URL=<the Supabase connection string>
DATABASE_SSL_CA=/home/<you>/supabase-ca.crt
DATASITE_DATABASE_URL=<the data site's connection string>
SEC_USER_AGENT="<your company name> <your monitored email>"
```

The server needs Node.js 20 or newer (`node -v` shows the version; 22 is what the checks run on) and
PM2, which the data site already uses.

The connection to Supabase is always encrypted, because it carries email addresses and consent
records. With the `DATABASE_SSL_CA` line, every tool and the site also check that the server at the
other end really is Supabase's; without it the connection is encrypted but not checked. (The data
site's own database is on the Droplet itself, so it needs neither.)

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

Do this at a quiet time, and not while a backup (A2) is still running. Most of the files only add
new tables. A few touch things the old app uses, for a moment each: they add columns to the `picks`
table and update the small function that runs when someone signs up on the old app. Both old sites
keep working. If one of those files has to wait more than five seconds for a table that is in use,
it steps back, changes nothing and tries again a few times; if it still cannot get in, the command
stops with a message saying so, and you run it again a little later.

First, one check. In the Supabase dashboard, open the **SQL Editor** and run:

```sql
select 'function ' || proname as what, pg_get_userbyid(proowner) as owner
  from pg_proc where pronamespace = 'public'::regnamespace and proname = 'handle_new_user'
union all
select 'table ' || relname, pg_get_userbyid(relowner)
  from pg_class where relnamespace = 'public'::regnamespace and relname in ('picks', 'profiles');
```

Every line should say `postgres`. If one does not, stop and ask: the files would be refused (safely,
with nothing changed), and the fix is a one-line change of owner.

Now see what would be applied:

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

Nothing the old app or the old data site uses is removed, so both keep working. Each file is applied
completely or not at all, and the command is safe to run again.

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

- People who follow companies on the data site but are not on its general list are copied as *off* the general list.
  The old site cannot tell "never joined" from "joined, then unsubscribed", so nobody is put on the pick list on a
  guess. This also switches off a pick-list sign-up on the old app for the same address; the report says how many people this is.
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

The new site runs beside the old one (its own folder, its own port 3001) until you switch Nginx over.
Until step B6 visitors see only the old sites.

### B1. Fill in the rest of `.env`

Open the same file you made in A1 (do not copy the example over it again: that would wipe the four
lines you filled in):

```bash
nano .env
```

Each line is explained in the file. What you need to have ready:

| Line | Where it comes from |
|---|---|
| `DATABASE_URL`, `DATABASE_SSL_CA` | Supabase, as in A1 |
| `NEXT_PUBLIC_SITE_URL` | Your public address, for example `https://bigstocks.com` |
| `APP_SECRET` | Make one: `openssl rand -base64 48` |
| `SEC_USER_AGENT` | Your company name and a monitored email, as in A1 |
| `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | resend.com. The sending domain in `EMAIL_FROM` must be verified there (it gives you DNS records to add) |
| `RESEND_WEBHOOK_SECRET` | resend.com, Webhooks: add `https://<your site>/api/webhooks/resend` for the events "bounced" and "complained", then copy its signing secret |
| `COMPANY_POSTAL_ADDRESS` | Your business postal address. Alert emails are held back until it is set |
| `ANTHROPIC_API_KEY` | console.anthropic.com. Without it the site works but writes no summaries |
| `INQUIRY_NOTIFY_TO` | Where sponsor inquiries should be emailed |

Keep `ALERTS_SENDING=off` in `.env` for now (add that line).

### B2. Publish the new code (beside the old site)

```bash
bash scripts/deploy.sh
```

It installs the packages, runs the checks, applies any new database changes, builds, starts the site
and the worker under PM2, and asks the site whether it is healthy. You will run this same command
every time the code changes.

Look at it without changing anything for visitors. From your own computer:

```bash
ssh -L 3001:127.0.0.1:3001 <you>@<droplet address>
```

then open `http://localhost:3001` in your browser. Check the worker:

```bash
pm2 logs bigstocks-worker --lines 30
```

You should see `[worker] started. Sending email: OFF.` and no repeating errors. Within a minute the
live feed on the homepage fills with filings.

### B3. Give yourself staff access

```bash
npm run admin:grant -- you@yourcompany.com
```

Sign in on the site with that address (an emailed link), then open `/admin`. That page shows whether
the worker is healthy, lets you post picks, and lists sponsor inquiries.

### B4. Let it run beside the old site for two days

Leave `ALERTS_SENDING=off`. Compare what the new feed shows with the old sites. On `/admin` every
worker line should say "Working". Run the rehearsal copy (A5) during this time.

### B5. Fill in the legal pages

`/disclaimer`, `/privacy`, `/terms` and `/sms-terms` are draft templates with `[BRACKETS]` to fill
in. Have your lawyer review them before the switch-over. They are in `app/disclaimer/page.tsx`,
`app/privacy/page.tsx`, `app/terms/page.tsx` and `app/sms-terms/page.tsx`.

### B6. The switch-over

Pick a quiet time (a weekend morning). A day ahead, lower the DNS time-to-live for your domain to 5
minutes at your DNS provider.

1. **Stop the old sites taking sign-ups.** On the Droplet, stop the old data site and its poller
   (the names it runs under today):

```bash
pm2 stop bigstocks-web bigstocks-ingest
```

   In Vercel, pause the old app (Project, Settings, "Pause"), or leave it until step 5 if nobody is
   using it this hour.

2. **Back up and copy one last time** (A2, then A6):

```bash
npm run backup
```

```bash
npm run backfill -- --cutover --dry-run
```

```bash
npm run backfill -- --cutover --yes
```

3. **Point the web server at the new site:**

```bash
sudo cp deploy/nginx-bigstocks.conf /etc/nginx/sites-available/bigstocks
```

```bash
sudo ln -sf /etc/nginx/sites-available/bigstocks /etc/nginx/sites-enabled/bigstocks
```

   Remove the old site's Nginx file from `/etc/nginx/sites-enabled/` (keep a copy), then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

```bash
sudo certbot --nginx -d bigstocks.com -d www.bigstocks.com -d data.bigstocks.com
```

4. **Point the names at the Droplet.** At your DNS provider, `bigstocks.com`, `www` and `data` all
   point to the Droplet's address. `data.bigstocks.com` then forwards to the main address, so links
   in emails already sent keep working.

5. **Forward the old Vercel address.** In the old Vercel project, add a redirect from every path to
   the same path on `https://bigstocks.com` (links in the old app's emails then keep working), and
   keep it for at least a month.

6. **Turn sending on.** In `.env` change `ALERTS_SENDING=off` to `ALERTS_SENDING=on`, then:

```bash
pm2 restart bigstocks-worker --update-env
```

7. **Check.** Open the site, sign up with an address of your own, confirm, follow a stock, and wait
   for its next filing. On `/admin`, "Emails sent, 24 h" starts counting.

```bash
pm2 save
```

### B7. If you need to go back

Before step 6 nothing has been sent, so going back is: put the old Nginx file back, reload Nginx,
`pm2 start bigstocks-web bigstocks-ingest`. The old databases were only read, never changed.
After step 6, people have signed up and changed settings on the new site; going back would lose
those, so fix forward instead and ask for help.

### B8. Afterwards

- Two weeks after the switch-over, with no problems: take a final backup, then the retired tables
  can be dropped (ask first; it is a one-line migration per table).
- Remove `DATASITE_DATABASE_URL` from `.env`.
- The new site does not use Supabase's own sign-in. Once the old app is switched off, turn sign-ups
  off in the Supabase dashboard (**Authentication**, **Sign In / Providers**, "Allow new users to sign
  up"), so nobody can create accounts there. Until then, keep "Confirm email" switched on in the same
  place.
- Text alerts stay off until you decide to add them (plan decision 15).
- Updating the site later is always: `cd ~/bigstocks-new && bash scripts/deploy.sh`.
