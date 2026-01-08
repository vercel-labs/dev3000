#!/bin/bash
#
# Publishes the release prepared by scripts/release.sh to npm
# Run scripts/release.sh first to build binaries, bump version, and create tag
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "📦 Starting npm publish process..."

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")

# Check if this is a canary version
if [[ $CURRENT_VERSION == *"-canary" ]]; then
  echo "❌ Current version is canary ($CURRENT_VERSION). Cannot publish canary version."
  echo "💡 Run ./scripts/release.sh first to prepare a release version."
  exit 1
fi

echo "📋 Version to publish: $CURRENT_VERSION"

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ Not on main branch. Currently on: $CURRENT_BRANCH"
  exit 1
fi

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working directory is not clean. Please commit or stash changes."
  git status --short
  exit 1
fi

# Check if the release tag exists
TAG_NAME="v$CURRENT_VERSION"
if ! git tag -l | grep -q "^$TAG_NAME$"; then
  echo "❌ Release tag $TAG_NAME does not exist."
  echo "💡 Run ./scripts/release.sh first to create the release tag."
  exit 1
fi

# Verify platform package binaries exist (built by release.sh)
PLATFORM_PKG_DIR="$ROOT_DIR/packages/d3k-darwin-arm64"
if [ ! -d "$PLATFORM_PKG_DIR/bin" ] || [ ! -d "$PLATFORM_PKG_DIR/mcp-server" ]; then
  echo "❌ Platform package binaries not found at $PLATFORM_PKG_DIR"
  echo "💡 Run ./scripts/release.sh first to build binaries."
  exit 1
fi

echo "✅ Found platform package binaries"

# Confirm publication
echo ""
echo "🚀 Ready to publish:"
echo "   1. @d3k/darwin-arm64@$CURRENT_VERSION (platform binary)"
echo "   2. dev3000@$CURRENT_VERSION (main package)"
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Publication cancelled"
  exit 1
fi

# Publish platform package first
echo "📦 Publishing @d3k/darwin-arm64@$CURRENT_VERSION..."
cd "$PLATFORM_PKG_DIR"
npm publish --access public
cd "$ROOT_DIR"

echo "✅ Published @d3k/darwin-arm64@$CURRENT_VERSION"

# Publish main package
echo "📦 Publishing dev3000@$CURRENT_VERSION..."
npm publish --access public

echo "✅ Successfully published dev3000@$CURRENT_VERSION to npm!"

# Increment to next canary version for development
NEXT_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$NF = $NF + 1; print}' OFS=.)
NEXT_CANARY_VERSION="$NEXT_VERSION-canary"

echo "🧪 Bumping to next canary version: $NEXT_CANARY_VERSION"

# Update main package.json
npm version $NEXT_CANARY_VERSION --no-git-tag-version

# Update platform package.json to canary version too
node -e "
  const fs = require('fs');
  const pkgPath = '$PLATFORM_PKG_DIR/package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = '$NEXT_CANARY_VERSION';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"

# Update optionalDependencies to point to canary version
node -e "
  const fs = require('fs');
  const pkgPath = '$ROOT_DIR/package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.optionalDependencies = pkg.optionalDependencies || {};
  pkg.optionalDependencies['@d3k/darwin-arm64'] = '$NEXT_CANARY_VERSION';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"

# Update bun.lock for the optional dependency
# (bun doesn't add entries for packages that don't exist on npm yet)
echo "🔒 Updating bun.lock for @d3k/darwin-arm64@$NEXT_CANARY_VERSION..."
node -e "
  const fs = require('fs');
  const lockfile = fs.readFileSync('bun.lock', 'utf8');

  // Update the importer's optionalDependencies specifier and version
  let updated = lockfile.replace(
    /('@d3k\/darwin-arm64':\n\s+specifier: )[^\n]+(\n\s+version: )[^\n]+/,
    \"\\\$1$NEXT_CANARY_VERSION\\\$2$NEXT_CANARY_VERSION\"
  );

  // Update the packages section entry
  updated = updated.replace(
    /'@d3k\/darwin-arm64@[^']+'/g,
    \"'@d3k/darwin-arm64@$NEXT_CANARY_VERSION'\"
  );

  fs.writeFileSync('bun.lock', updated);
  console.log('✅ Updated bun.lock');
"

# Run tests to make sure everything still works
echo "🧪 Testing canary version..."
vitest run

# Commit and push canary version
git add package.json packages/d3k-darwin-arm64/package.json bun.lock
git commit -m "Bump to v$NEXT_CANARY_VERSION for local development

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main

echo "🎉 Publication completed successfully!"
echo "📦 Published: dev3000@$CURRENT_VERSION + @d3k/darwin-arm64@$CURRENT_VERSION"
echo "🧪 Local development now on: v$NEXT_CANARY_VERSION"