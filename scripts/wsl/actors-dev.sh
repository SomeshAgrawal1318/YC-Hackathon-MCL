#!/usr/bin/env bash
# Runs the Durable Actors dev server for the MCL demo inside WSL (started by electron/actors.cjs,
# which writes actors/.env first). State lives on the Linux side: SQLite locking on /mnt/c is unreliable.
set -e
export PATH="$HOME/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
if ! command -v bun >/dev/null; then
  echo "Bun is not installed in WSL. Run: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
export DURABLE_ACTORS_DATA_DIR="$HOME/.mcl-actors"
export DURABLE_ACTORS_PORT="${DURABLE_ACTORS_PORT:-7100}"
cd "$(dirname "$0")/../../actors"
[ -d node_modules ] || bun install
exec bunx durable-actors dev >>"$HOME/.mcl-actors.log" 2>&1
