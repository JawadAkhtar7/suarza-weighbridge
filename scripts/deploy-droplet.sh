#!/usr/bin/env bash
#
# Runs ON the droplet, piped in over SSH by .github/workflows/deploy.yml.
#
# Kept in the repo rather than on the box so a rebuilt droplet needs no
# archaeology: clone, run this, done. It is also the exact thing you can run
# by hand over SSH when you want to deploy without pushing.
set -euo pipefail

APP_DIR=/opt/suarza
cd "$APP_DIR"

echo "--- fetching ---"
git fetch --quiet origin main
BEFORE=$(git rev-parse HEAD)
# Hard reset rather than pull: the droplet is a deployment target, never a
# place where edits are made, and a merge conflict here would wedge deploys.
# .env files and apps/agent/data are gitignored, so neither is touched.
git reset --quiet --hard origin/main
AFTER=$(git rev-parse HEAD)
echo "$BEFORE -> $AFTER"

echo "--- dependencies ---"
pnpm install --frozen-lockfile

echo "--- build ---"
# 1 GB box with 2 GB swap: cap the heap so a runaway build swaps instead of
# being OOM-killed halfway through, which leaves a half-written dist.
NODE_OPTIONS="--max-old-space-size=1536" pnpm build

echo "--- restart ---"
# reload, not restart: pm2 brings the new process up before retiring the old
# one, so a deploy does not drop the operator mid-weighing.
pm2 reload "$APP_DIR/ecosystem.config.cjs" --update-env
pm2 save --force

echo "--- health ---"
for i in $(seq 1 20); do
  server=$(curl -fsS --max-time 3 http://127.0.0.1:4000/health 2>/dev/null || true)
  agent=$(curl -fsS --max-time 3 http://127.0.0.1:3100/health 2>/dev/null || true)
  if [ -n "$server" ] && [ -n "$agent" ]; then
    echo "server: $server"
    echo "agent:  $agent"
    echo "deploy ok"
    exit 0
  fi
  sleep 3
done

echo "deploy FAILED health check" >&2
pm2 logs --nostream --lines 40 >&2 || true
exit 1
