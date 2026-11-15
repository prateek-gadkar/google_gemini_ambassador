#!/usr/bin/env bash
#
# Share the Certificate Station from this machine, for free.
#
#   ./scripts/share.sh
#
# Starts the site on :8080 and opens a public HTTPS tunnel to it. Students use
# the printed URL. Ctrl-C stops both.
#
# This is the zero-cost path: no hosting account, no card, no DNS. The trade-off
# is that the site is only up while this machine is awake and this script is
# running.

set -euo pipefail

PORT="${PORT:-8080}"
HOST="0.0.0.0"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node is not installed. Install Node 20+ first."

TUNNEL=""
if command -v cloudflared >/dev/null 2>&1; then
  TUNNEL="cloudflared"
elif command -v ngrok >/dev/null 2>&1; then
  TUNNEL="ngrok"
else
  cat >&2 <<'EOF'
No tunnel program found. Install one of these, then run this again:

  Cloudflare (no account needed):
    macOS:   brew install cloudflared
    Linux:   https://github.com/cloudflare/cloudflared/releases  (grab the binary)
    Windows: winget install --id Cloudflare.cloudflared

  ngrok (free account, but gives you a URL that never changes):
    https://ngrok.com/download   then: ngrok config add-authtoken <your token>

ngrok is the better choice for an event: claim one free static domain in the
ngrok dashboard, and the URL survives restarts instead of changing every time.
EOF
  exit 1
fi

# Admin key continuity.
#
# The server generates a key on first boot and persists it in data/gsa.json. We
# must NOT invent a different one here, or /admin would suddenly reject the key
# you have been using. So: pass through a stored key if we have one, and
# otherwise read back whatever the server generated.
KEYFILE="$HERE/data/admin-key.txt"
export ADMIN_KEY=""
if [ -s "$KEYFILE" ]; then
  ADMIN_KEY="$(cat "$KEYFILE")"
  export ADMIN_KEY
fi

cleanup() {
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

say "Starting the site on port $PORT ..."
( cd "$HERE" && PORT="$PORT" HOST="$HOST" ADMIN_KEY="$ADMIN_KEY" node server.js ) &
SRV_PID=$!

# Wait for it to answer before opening the tunnel.
for i in $(seq 1 40); do
  if node -e "fetch('http://127.0.0.1:$PORT/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 0.25
  if [ "$i" = "40" ]; then die "The server did not come up on port $PORT."; fi
done

# Read the key back from the data file so the printed key is always the real one.
ADMIN_KEY="$(node -e "try{process.stdout.write(require('$HERE/data/gsa.json').adminKey||'')}catch(e){process.stdout.write('')}" 2>/dev/null || true)"
if [ -n "$ADMIN_KEY" ]; then
  printf '%s' "$ADMIN_KEY" > "$KEYFILE"
  chmod 600 "$KEYFILE"
fi

echo
say "Admin key: ${ADMIN_KEY:-see the server output above}"
say "  (also saved in data/admin-key.txt — do not paste it into a group chat)"
echo

case "$TUNNEL" in
  cloudflared)
    warn "Opening a Cloudflare quick tunnel. The URL changes every time you"
    warn "restart this script. Copy the https://....trycloudflare.com address."
    echo
    cloudflared tunnel --url "http://127.0.0.1:$PORT" 2>&1 | while IFS= read -r line; do
      printf '%s\n' "$line"
      case "$line" in
        *trycloudflare.com*)
          URL=$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || true)
          [ -n "${URL:-}" ] && say "PUBLIC URL: $URL"
          ;;
      esac
    done
    ;;
  ngrok)
    warn "Opening an ngrok tunnel. Use your reserved domain so the URL is stable:"
    warn "  ngrok http --url=<your-name>.ngrok-free.app $PORT"
    echo
    ngrok http "$PORT"
    ;;
esac
