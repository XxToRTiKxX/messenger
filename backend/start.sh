#!/bin/sh
set -eu

echo "[start] starting backend"
cd /app
node src/server.js &

echo "[start] starting caddy"
exec caddy run --config /etc/caddy/Caddyfile
