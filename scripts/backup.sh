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
# Shows which server a connection string points at, without its user name or password.
host_of() { printf '%s' "$1" | sed -E 's#^[a-zA-Z]+://([^@/]*@)?([^:/?]*).*#\2#'; }

for tool in pg_dump pg_restore psql sha256sum; do
  command -v "$tool" >/dev/null || { echo "Missing the '$tool' program. On Ubuntu: sudo apt-get install -y postgresql-client"; exit 1; }
done

app_url="$(read_env DATABASE_URL)"
site_url="$(read_env DATASITE_DATABASE_URL)"
[[ -n "$app_url" ]] || { echo "DATABASE_URL is not set (in the environment or in .env)."; exit 1; }

dir="${BACKUP_DIR:-backups}/$(date -u +%Y%m%d-%H%M%SZ)"
mkdir -p "$dir"

dump() { # dump LABEL URL [extra pg_dump options]
  local label="$1" url="$2"
  shift 2
  pg_dump --format=custom --no-owner --no-privileges "$@" --file "$dir/$label.dump" "$url"
  pg_restore --list "$dir/$label.dump" > "$dir/$label.contents.txt"
  echo "  $label.dump: $(du -h "$dir/$label.dump" | cut -f1), $(grep -c 'TABLE DATA' "$dir/$label.contents.txt" || true) tables with data"
}
export_csv() { # export_csv URL TABLE: skipped quietly when the table is not there
  local url="$1" table="$2"
  if [[ "$(psql "$url" --no-psqlrc -Atc "select to_regclass('public.$table') is not null")" == "t" ]]; then
    psql "$url" --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
      -c "\\copy (select * from public.$table order by 1) to '$dir/consent-$table.csv' with (format csv, header true)"
    echo "  consent-$table.csv: $(($(wc -l < "$dir/consent-$table.csv") - 1)) rows"
  fi
}

echo "Backing up the one database ($(host_of "$app_url"))…"
if ! dump app "$app_url" --schema=public --schema=auth --schema=supabase_migrations; then
  echo "  Could not include the sign-in accounts (schema auth). Backing up the public tables only."
  rm -f "$dir/app.dump" "$dir/app.contents.txt"
  dump app "$app_url" --schema=public --schema=supabase_migrations
fi
export_csv "$app_url" alert_subscribers
export_csv "$app_url" alert_subscriptions

if [[ -n "$site_url" ]]; then
  echo "Backing up the data site's database ($(host_of "$site_url"))…"
  dump datasite "$site_url"
  export_csv "$site_url" subscribers
  export_csv "$site_url" ticker_follows
else
  echo "DATASITE_DATABASE_URL is not set: the data site's database was NOT backed up."
fi

(cd "$dir" && sha256sum -- * > SHA256SUMS)
echo
echo "Done: $dir"
echo "Copy this folder off the server now and keep it somewhere safe. It holds personal data."
