#!/usr/bin/env bash
# One-command launcher for macOS and Linux: checks the prerequisites, installs what's missing,
# starts musi-type. Extra options pass through, e.g.  ./run.sh --audio
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install it from https://nodejs.org (or: brew install node)"
  exit 1
fi
exec node scripts/start.mjs "$@"
