#!/usr/bin/env bash
# Publish the newest code on the Droplet. Run it in the project folder:   bash scripts/deploy.sh
#
# It fetches the code, installs packages, runs the checks, builds, applies any new database
# migrations, restarts the site and the worker, and then asks the site whether it is healthy.
# If a step fails it stops there: the site that was running keeps running.
set -euo pipefail
cd "$(dirname "$0")/.."

branch="${DEPLOY_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
[[ -f .env ]] || { echo "There is no .env file here. Copy .env.example to .env and fill it in first (docs/RUNBOOK.md)."; exit 1; }

echo "== 1/6 Fetching the code ($branch)"
git fetch origin "$branch"
git merge --ff-only "origin/$branch"

echo "== 2/6 Installing packages"
npm ci

echo "== 3/6 Checks"
npm run lint
npx tsx scripts/test-unit.ts
npx tsx scripts/test-health.ts

echo "== 4/6 Database changes"
npm run db:migrate -- --yes

echo "== 5/6 Building"
npm run build

echo "== 6/6 Restarting"
if pm2 describe bigstocks-web >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

sleep 5
echo
if curl -fsS http://127.0.0.1:3000/api/health; then
  echo
  echo "Done. The site answered."
else
  echo
  echo "The site did not answer its health check. Look at:  pm2 logs bigstocks-web --lines 50"
  exit 1
fi
