#!/usr/bin/env bash
#
# The full-product check (brief §13-M9).
#
# Starts everything the product is made of — MongoDB, the cloud server serving
# the manager dashboard, the agent on its simulator serving the operator app —
# and drives one truck all the way through in a real browser: weigh in, weigh
# out, receipts, sync, dashboard, the QR page a driver scans, the PDF, a
# reprint, a void, and the audit trail.
#
# Requirements: Node 20+, Google Chrome, and a built workspace (`pnpm build`).
# No weighbridge hardware and no internet are needed.
#
#   ./scripts/end-to-end.sh
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${QA_WORKDIR:-$(mktemp -d -t suarza-qa-XXXXXX)}"
MONGOD="$(find "$ROOT/node_modules/.cache/mongodb-memory-server" -name 'mongod-*' -type f 2>/dev/null | head -1)"

AGENT_PORT=3099
CLOUD_PORT=4099
MONGO_PORT=27099
CDP_PORT=9350

cleanup() {
  for pid in $(pgrep -f "dist/index.js" 2>/dev/null); do
    [ "$(ps -p "$pid" -o comm= 2>/dev/null)" = "node" ] && kill "$pid" 2>/dev/null
  done
  for pid in $(pgrep -f "mongodb-memory-server/mongod" 2>/dev/null); do
    case "$(ps -p "$pid" -o comm= 2>/dev/null)" in mongod*) kill "$pid" 2>/dev/null ;; esac
  done
  pkill -f "remote-debugging-port=$CDP_PORT" 2>/dev/null
}
trap cleanup EXIT

wait_for_port() {
  for _ in $(seq 1 40); do (echo > "/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 1; done
  return 1
}

if [ -z "$MONGOD" ]; then
  echo "No mongod binary found. Run 'pnpm install' first — mongodb-memory-server downloads one."
  exit 1
fi
if ! command -v google-chrome > /dev/null && ! command -v chromium > /dev/null; then
  echo "Google Chrome (or chromium) is required to drive the browser checks."
  exit 1
fi
CHROME="$(command -v google-chrome || command -v chromium)"

cleanup
mkdir -p "$WORK/mongo" "$WORK/backups"

echo "• starting MongoDB"
"$MONGOD" --dbpath "$WORK/mongo" --port "$MONGO_PORT" --bind_ip 127.0.0.1 > "$WORK/mongo.log" 2>&1 &
wait_for_port "$MONGO_PORT" || { echo "mongod failed:"; tail -5 "$WORK/mongo.log"; exit 1; }

echo "• starting the cloud server (serving the manager dashboard)"
cd "$ROOT/apps/server"
PORT=$CLOUD_PORT \
  MONGODB_URI="mongodb://127.0.0.1:$MONGO_PORT/suarzaweightbridge" \
  APP_DOMAIN="http://127.0.0.1:$CLOUD_PORT" \
  INGEST_API_KEY="end-to-end-check-key" \
  JWT_SECRET="end-to-end-check-jwt-secret-0123456789" \
  COMPANY_NAME="Suarza International" \
  COMPANY_ADDRESS="12 Industrial Road, Lahore, Pakistan" \
  COMPANY_PHONE="+92 300 0000000" \
  node dist/index.js > "$WORK/server.log" 2>&1 &
curl -s --retry 30 --retry-all-errors --retry-delay 1 "http://127.0.0.1:$CLOUD_PORT/health" > /dev/null \
  || { echo "server failed:"; tail -5 "$WORK/server.log"; exit 1; }

echo "• starting the agent (simulator, serving the operator app)"
cd "$ROOT/apps/agent"
USE_SIMULATOR=true \
  DATABASE_PATH="$WORK/agent.sqlite" \
  PORT=$AGENT_PORT \
  STATION_ID=A \
  CLOUD_API_URL="http://127.0.0.1:$CLOUD_PORT" \
  CLOUD_API_KEY="end-to-end-check-key" \
  SYNC_INTERVAL_SECONDS=30 \
  BACKUP_PATH="$WORK/backups" \
  node dist/index.js > "$WORK/agent.log" 2>&1 &
curl -s --retry 30 --retry-all-errors --retry-delay 1 "http://127.0.0.1:$AGENT_PORT/health" > /dev/null \
  || { echo "agent failed:"; tail -5 "$WORK/agent.log"; exit 1; }

echo "• starting the browser"
"$CHROME" --headless --disable-gpu --no-sandbox --remote-debugging-port=$CDP_PORT \
  --user-data-dir="$WORK/chrome" --window-size=1440,1100 "about:blank" > /dev/null 2>&1 &

echo
SHOT_DASH="$WORK/dashboard.png" SHOT_QR="$WORK/qr-receipt.png" \
  node --experimental-websocket "$ROOT/scripts/end-to-end.mjs"
STATUS=$?

echo
echo "Logs and screenshots: $WORK"
exit $STATUS
