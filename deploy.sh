#!/usr/bin/env bash
# Whiteboard — single-command production deploy.
# Validates .env, builds the image, brings the stack up, and prints the URL.

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

# 1. Require .env
if [ ! -f .env ]; then
  cat >&2 <<'EOF'
Error: .env not found.

Set it up with:
  cp .env.example .env
  $EDITOR .env

Then re-run ./deploy.sh.
EOF
  exit 1
fi

# 2. Source .env to make vars available to docker compose
set -a
# shellcheck disable=SC1091
. .env
set +a

# (v1 is stateless; OWNER_TOKEN / DATA_DIR / MAX_ROOMS / MAX_BOARD_BLOB_MB
#  are not validated here — they return when live collaboration returns
#  per ADR 0012. See docs/decisions/0012-sharing-deferred.md.)

# 3. Verify docker is available
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not on PATH." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Error: 'docker compose' plugin is not available." >&2
  echo "Install: https://docs.docker.com/compose/install/" >&2
  exit 1
fi

# 4. Build and start
echo "Building and starting whiteboard..."
docker compose up -d --build

# 5. Show status and URL
echo
docker compose ps
echo
echo "Whiteboard is up at: ${PUBLIC_ORIGIN:-http://localhost:${PORT:-8787}}"
echo "Logs: docker compose logs -f"
echo "Stop: docker compose down"
