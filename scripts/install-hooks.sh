#!/usr/bin/env bash
# Install git hooks for this repo. Idempotent.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."

if [ ! -d .git ]; then
  echo "Error: .git not found. Run from a clone of the repo." >&2
  exit 1
fi

mkdir -p .git/hooks

cp scripts/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

echo "Installed: .git/hooks/pre-commit"
