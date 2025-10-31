#!/usr/bin/env bash
set -euo pipefail

# Bootstrap and run ShellSpec locally without global install.
# Usage:
#   pnpm run shellspec            # run all specs under spec/
#   pnpm run shellspec -- --format progress --jobs 2

DIR=${SHELLSPEC_DIR:-.shellspec}
REPO=${SHELLSPEC_REPO:-https://github.com/shellspec/shellspec}

if [[ ! -x "$DIR/bin/shellspec" ]]; then
  echo "Installing ShellSpec to $DIR ..."
  rm -rf "$DIR"
  git clone --depth 1 "$REPO" "$DIR" >/dev/null 2>&1
fi

exec "$DIR/bin/shellspec" "$@"

