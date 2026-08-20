#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
APP_NAME="${APP_NAME:-aetheris}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"

cd "$APP_DIR"

echo "-> Pulling latest..."
git pull --ff-only

echo "-> Installing dependencies..."
pnpm install --frozen-lockfile

echo "-> Reloading Caddy..."
caddy reload --config /etc/caddy/Caddyfile

echo "-> Restarting app..."
# Kill any orphaned aetheris instance BEFORE pm2 restarts it (2026-08-20
# incident: pm2 restart orphans the old node process, which keeps :8080 bound;
# the fresh instance then EADDRINUSE-loops while the orphan serves the site).
# Scoped by working directory so other node apps (crax-gpt, profile-views) are
# never touched. pgrep -f must not match this script itself — it doesn't
# ("deploy.sh" is not "node index.js").
for pid in $(pgrep -f 'node index\.js' 2>/dev/null || true); do
    if [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$APP_DIR" ]; then
        kill "$pid" 2>/dev/null || true
    fi
done
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
    pm2 restart "$APP_NAME"
else
    pm2 start index.js \
        --name "$APP_NAME" \
        --node-args="--env-file=$ENV_FILE" \
        --kill-timeout 5000
    pm2 save
fi

echo "Done"
