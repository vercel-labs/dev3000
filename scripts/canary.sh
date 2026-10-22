#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build.sh
PACKAGE_FILE="dev3000-local-canary.tgz"
bun pm pack --filename "$PACKAGE_FILE" --quiet >/dev/null
bun remove -g dev3000 @d3k/darwin-arm64 >/dev/null 2>&1 || true
bun add -g --ignore-scripts "file:$PWD/$PACKAGE_FILE"
bun run canary:smoke
