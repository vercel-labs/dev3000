#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🧪 Starting canary test process..."

# Use shared build script for TypeScript compilation
./scripts/build.sh

# Build compiled binaries
echo "🔨 Building compiled binaries..."
bun run scripts/build-binaries.ts

# Copy built binaries to platform package
echo "📁 Copying binaries to platform package..."
PLATFORM_PKG_DIR="$ROOT_DIR/packages/dev3000-darwin-arm64"
DIST_BIN_DIR="$ROOT_DIR/dist-bin/dev3000-darwin-arm64"

rm -rf "$PLATFORM_PKG_DIR/bin" "$PLATFORM_PKG_DIR/mcp-server" "$PLATFORM_PKG_DIR/skills" "$PLATFORM_PKG_DIR/src"
cp -r "$DIST_BIN_DIR/bin" "$PLATFORM_PKG_DIR/"
cp -r "$DIST_BIN_DIR/mcp-server" "$PLATFORM_PKG_DIR/"
cp -r "$DIST_BIN_DIR/skills" "$PLATFORM_PKG_DIR/"
cp -r "$DIST_BIN_DIR/src" "$PLATFORM_PKG_DIR/"

# Pack and install
echo "📦 Packing packages..."
echo "🧹 Cleaning previous tarballs..."
rm -f ./*.tgz
rm -f "$PLATFORM_PKG_DIR"/*.tgz

# Pack platform package first
echo "📦 Packing platform package..."
cd "$PLATFORM_PKG_DIR"
PLATFORM_PACKAGE_FILE=$(pnpm pack 2>&1 | tail -n 1)
echo "✅ Created: $PLATFORM_PACKAGE_FILE"
cd "$ROOT_DIR"

# Pack main package
echo "📦 Packing main package..."
MAIN_PACKAGE_FILE=$(pnpm pack 2>&1 | tail -n 1)
echo "✅ Created: $MAIN_PACKAGE_FILE"

echo "♻️ Removing previous global installs (if any)..."
pnpm remove -g dev3000 dev3000-darwin-arm64 >/dev/null 2>&1 || true

# Install platform package first, then main package
echo "📥 Installing platform package globally..."
pnpm add -g "file:$PLATFORM_PKG_DIR/$PLATFORM_PACKAGE_FILE"

# pnpm blocks postinstall scripts by default, so fix permissions manually
echo "🔧 Fixing executable permissions..."
INSTALLED_PKG_DIR="$(pnpm root -g)/dev3000-darwin-arm64"
chmod +x "$INSTALLED_PKG_DIR/mcp-server/node_modules/.bin/"* 2>/dev/null || true

echo "📥 Installing main package globally..."
pnpm add -g "file:$ROOT_DIR/$MAIN_PACKAGE_FILE"

echo "✅ Canary test completed successfully!"
echo "🚀 You can now use 'd3k' or 'dev3000' commands"
