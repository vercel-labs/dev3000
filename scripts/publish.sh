#!/bin/bash
#
# Usage:
#   ./scripts/publish.sh              # Build and publish main + platform packages
#   ./scripts/publish.sh --skip-build # Skip binary build (use existing dist-bin)
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "📦 Starting multi-package npm publish process..."

SKIP_BUILD=false
if [ "$1" = "--skip-build" ]; then
  SKIP_BUILD=true
  echo "⏭️  Skipping binary build (using existing dist-bin)"
fi

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

# Build binaries if not skipped
if [ "$SKIP_BUILD" = false ]; then
  echo "🔨 Building compiled binaries..."
  bun run scripts/build-binaries.ts
fi

# Verify dist-bin was created
DIST_BIN_DIR="$ROOT_DIR/dist-bin/dev3000-darwin-arm64"
if [ ! -d "$DIST_BIN_DIR" ]; then
  echo "❌ dist-bin/dev3000-darwin-arm64 not found. Run without --skip-build."
  exit 1
fi

# Copy built binaries to platform package
echo "📁 Copying built binaries to platform package..."
PLATFORM_PKG_DIR="$ROOT_DIR/packages/dev3000-darwin-arm64"
rm -rf "$PLATFORM_PKG_DIR/bin" "$PLATFORM_PKG_DIR/mcp-server" "$PLATFORM_PKG_DIR/skills" "$PLATFORM_PKG_DIR/src"
cp -r "$DIST_BIN_DIR/bin" "$PLATFORM_PKG_DIR/"
cp -r "$DIST_BIN_DIR/mcp-server" "$PLATFORM_PKG_DIR/"
cp -r "$DIST_BIN_DIR/skills" "$PLATFORM_PKG_DIR/"
cp -r "$DIST_BIN_DIR/src" "$PLATFORM_PKG_DIR/"

# Update platform package version to match
echo "📋 Updating platform package version to $CURRENT_VERSION..."
node -e "
  const fs = require('fs');
  const pkgPath = '$PLATFORM_PKG_DIR/package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = '$CURRENT_VERSION';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"

# Update main package optionalDependencies to match version
echo "📋 Updating optionalDependencies in main package..."
node -e "
  const fs = require('fs');
  const pkgPath = '$ROOT_DIR/package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.optionalDependencies = pkg.optionalDependencies || {};
  pkg.optionalDependencies['dev3000-darwin-arm64'] = '$CURRENT_VERSION';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"

# Confirm publication
echo ""
echo "🚀 Ready to publish:"
echo "   1. dev3000-darwin-arm64@$CURRENT_VERSION (platform binary)"
echo "   2. dev3000@$CURRENT_VERSION (main package)"
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Publication cancelled"
  exit 1
fi

# Publish platform package first
echo "📦 Publishing dev3000-darwin-arm64@$CURRENT_VERSION..."
cd "$PLATFORM_PKG_DIR"
npm publish --access public
cd "$ROOT_DIR"

echo "✅ Published dev3000-darwin-arm64@$CURRENT_VERSION"

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
  pkg.optionalDependencies['dev3000-darwin-arm64'] = '$NEXT_CANARY_VERSION';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"

# Run tests to make sure everything still works
echo "🧪 Testing canary version..."
pnpm test

# Commit and push canary version
git add package.json packages/dev3000-darwin-arm64/package.json
git commit -m "Bump to v$NEXT_CANARY_VERSION for local development

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main

echo "🎉 Publication completed successfully!"
echo "📦 Published: dev3000@$CURRENT_VERSION + dev3000-darwin-arm64@$CURRENT_VERSION"
echo "🧪 Local development now on: v$NEXT_CANARY_VERSION"