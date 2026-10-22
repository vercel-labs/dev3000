#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(git branch --show-current)" != main ]; then
  echo "Release from a clean main checkout."
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash changes before releasing."
  exit 1
fi
git pull --ff-only origin main
bun run test-release
CURRENT_VERSION=$(node -p "require('./package.json').version")
NEXT_VERSION=$(node -e 'const v=process.argv[1]; const p=v.replace(/-canary$/, "").split("."); if (!v.endsWith("-canary")) p[2]=String(Number(p[2])+1); console.log(p.join("."))' "$CURRENT_VERSION")
TAG_NAME="v$NEXT_VERSION"
if git show-ref --verify --quiet "refs/tags/$TAG_NAME" || [ -n "$(git ls-remote --tags origin "refs/tags/$TAG_NAME")" ]; then
  echo "Release tag already exists: $TAG_NAME"
  exit 1
fi
bun pm version "$NEXT_VERSION" --no-git-tag-version
bun scripts/update-changelog.ts "$TAG_NAME"
bun scripts/generate-changelog-md.ts
bun run build
bun run canary:smoke
git add package.json bun.lock www/lib/changelog.ts CHANGELOG.md
git commit -m "Release $TAG_NAME"
# Include any changelog formatting from hooks.
if ! git diff --quiet -- www/lib/changelog.ts; then
  git add www/lib/changelog.ts
  git commit -m "Format release changelog"
fi
git tag -a "$TAG_NAME" -m "Release $NEXT_VERSION"
git push origin main
git push origin "$TAG_NAME"
echo "Release pushed. GitHub Actions publishes the JavaScript package and bumps main to the next canary."
