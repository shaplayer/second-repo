#!/usr/bin/env bash
# Back up both databases before any migration step (plan Phase 0, step 2).
#
#   npm run backup
#
# It only reads: pg_dump and \copy never change a database. It writes, into backups/<time>/ :
#   app.dump                      the one database (Supabase): the public tables, sign-in accounts, migration history
#   datasite.dump                 the data site's own Postgres (only when DATASITE_DATABASE_URL is set)
#   consent-*.csv                 the sign-up and consent records as plain spreadsheets (legal evidence)
#   *.contents.txt, SHA256SUMS    what each backup holds, and checksums to prove a copy is intact
#
# If any backup fails, the script stops and says so: it never reports "Done" for a backup that is
# missing or empty.
#
# The files hold personal data (emails, phone numbers). They are readable only by the user who ran this.
# Copy the folder off the server to somewhere safe, and keep it: see docs/RUNBOOK.md.
#
# DATABASE_URL and DATASITE_DATABASE_URL are read from the environment, or from .env in the project folder.
# For Supabase use the "Session pooler" or "Direct connection" string (port 5432), not the transaction pooler (6543).
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

read_env() {
  local name="$1" value="${!1:-}"
  if [[ -z "$value" && -f .env ]]; then
    value="$(grep -E "^${name}=" .env | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true)"
  fi
  printf '%s' "$value"
}

for tool in pg_dump pg_restore psql sha256sum node; do
  command -v "$tool" >/dev/null || { echo "Missing the '$tool' program. On Ubuntu: sudo apt-get install -y postgresql-client"; exit 1; }
done

app_url="$(read_env DATABASE_URL)"
site_url="$(read_env DATASITE_DATABASE_URL)"
DATABASE_SSL_CA="$(read_env DATABASE_SSL_CA)"
export DATABASE_SSL_CA
[[ -n "$app_url" ]] || { echo "DATABASE_URL is not set (in the environment or in .env)."; exit 1; }

dir="${BACKUP_DIR:-backups}/$(date -u +%Y%m%d-%H%M%SZ)"
mkdir -p "$dir"

# Runs a command with the connection given through the PG* environment variables. The connection
# string (and so the password) never appears on a command line, where other users of the server
# could see it with "ps".
with_db() { # with_db URL command...
  local url="$1"
  shift
  (
    eval "$(BS_URL="$url" node -e '
      const u = new URL(process.env.BS_URL);
      const q = (v) => "\x27" + String(v).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
      const host = u.searchParams.get("host") || decodeURIComponent(u.hostname);
      const out = { PGHOST: host, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
                    PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGSSLMODE: u.searchParams.get("sslmode") || "" };
      // A database on another machine is always read over an encrypted connection (as lib/db/connect.ts does),
      // and checked against the certificate file when DATABASE_SSL_CA names one.
      const local = host.startsWith("/") || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host.toLowerCase());
      if (!local && !out.PGSSLMODE) {
        const ca = (process.env.DATABASE_SSL_CA || "").trim();
        out.PGSSLMODE = ca ? "verify-full" : "require";
        if (ca) out.PGSSLROOTCERT = ca;
      }
      for (const [k, v] of Object.entries(out)) if (v) console.log("export " + k + "=" + q(v));
    ')"
    "$@"
  )
}
host_of() { BS_URL="$1" node -e 'const u = new URL(process.env.BS_URL); console.log(u.searchParams.get("host") || u.hostname)'; }

dump() { # dump LABEL URL [extra pg_dump options]: fails when the dump fails or comes out empty
  local label="$1" url="$2"
  shift 2
  with_db "$url" pg_dump --format=custom --no-owner --no-privileges "$@" --file "$dir/$label.dump" || return 1
  [[ -s "$dir/$label.dump" ]] || { echo "  $label.dump is empty."; return 1; }
  pg_restore --list "$dir/$label.dump" > "$dir/$label.contents.txt" || return 1
  echo "  $label.dump: $(du -h "$dir/$label.dump" | cut -f1), $(grep -c 'TABLE DATA' "$dir/$label.contents.txt" || true) tables with data"
  return 0
}
export_csv() { # export_csv URL TABLE: a table that does not exist is skipped; any other problem is an error
  local url="$1" table="$2" there
  there="$(with_db "$url" psql --no-psqlrc -At --set ON_ERROR_STOP=1 -c "select to_regclass('public.$table') is not null")" || return 1
  if [[ "$there" == "t" ]]; then
    with_db "$url" psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
      -c "\\copy (select * from public.$table order by 1) to '$dir/consent-$table.csv' with (format csv, header true)" || return 1
    echo "  consent-$table.csv: $(($(wc -l < "$dir/consent-$table.csv") - 1)) rows"
  fi
  return 0
}
fail() { echo; echo "BACKUP FAILED: $1"; echo "Nothing in $dir can be relied on. Fix the problem and run the backup again."; exit 1; }

echo "Backing up the one database ($(host_of "$app_url"))…"
if ! dump app "$app_url" --schema=public --schema=auth --schema=supabase_migrations; then
  echo "  Could not include the sign-in accounts (schema auth). Trying the public tables only."
  rm -f "$dir/app.dump" "$dir/app.contents.txt"
  dump app "$app_url" --schema=public --schema=supabase_migrations || fail "the one database could not be backed up."
fi
export_csv "$app_url" alert_subscribers || fail "the old app's subscriber list could not be exported."
export_csv "$app_url" alert_subscriptions || fail "the subscription list could not be exported."

if [[ -n "$site_url" ]]; then
  echo "Backing up the data site's database ($(host_of "$site_url"))…"
  dump datasite "$site_url" || fail "the data site's database could not be backed up."
  export_csv "$site_url" subscribers || fail "the data site's subscriber list could not be exported."
  export_csv "$site_url" ticker_follows || fail "the data site's follows could not be exported."
else
  echo "DATASITE_DATABASE_URL is not set: the data site's database was NOT backed up."
fi

(cd "$dir" && sha256sum -- * > SHA256SUMS)
echo
echo "Done: $dir"
echo "Copy this folder off the server now and keep it somewhere safe. It holds personal data."
