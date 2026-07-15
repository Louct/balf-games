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
