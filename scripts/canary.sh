#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🧪 Starting canary test process..."

# Use isolated bun global install location to avoid system perms
CANARY_BUN_INSTALL="/tmp/d3k-canary-bun"
export BUN_INSTALL="$CANARY_BUN_INSTALL"
export PATH="$BUN_INSTALL/bin:$PATH"
export D3K_BUILD_TARGETS="${D3K_BUILD_TARGETS:-darwin-arm64}"

# Use shared build script for TypeScript compilation
./scripts/build.sh

# Build compiled binaries
echo "🔨 Building compiled binaries..."
bun run scripts/build-binaries.ts

# Copy built binaries to platform packages
echo "📁 Copying binaries to platform packages..."

# darwin-arm64
DARWIN_ARM64_PKG_DIR="$ROOT_DIR/packages/d3k-darwin-arm64"
DARWIN_ARM64_DIST_DIR="$ROOT_DIR/dist-bin/d3k-darwin-arm64"
rm -rf "$DARWIN_ARM64_PKG_DIR/bin" "$DARWIN_ARM64_PKG_DIR/skills" "$DARWIN_ARM64_PKG_DIR/src"
cp -r "$DARWIN_ARM64_DIST_DIR/bin" "$DARWIN_ARM64_PKG_DIR/"
cp -r "$DARWIN_ARM64_DIST_DIR/skills" "$DARWIN_ARM64_PKG_DIR/"
cp -r "$DARWIN_ARM64_DIST_DIR/src" "$DARWIN_ARM64_PKG_DIR/"

# linux-x64
LINUX_X64_PKG_DIR="$ROOT_DIR/packages/d3k-linux-x64"
LINUX_X64_DIST_DIR="$ROOT_DIR/dist-bin/d3k-linux-x64"
rm -rf "$LINUX_X64_PKG_DIR/bin" "$LINUX_X64_PKG_DIR/skills" "$LINUX_X64_PKG_DIR/src"
cp -r "$LINUX_X64_DIST_DIR/bin" "$LINUX_X64_PKG_DIR/"
cp -r "$LINUX_X64_DIST_DIR/skills" "$LINUX_X64_PKG_DIR/"
cp -r "$LINUX_X64_DIST_DIR/src" "$LINUX_X64_PKG_DIR/"

# For local testing, use the darwin-arm64 package
PLATFORM_PKG_DIR="$DARWIN_ARM64_PKG_DIR"

# Pack and install
echo "📦 Packing packages..."
echo "🧹 Cleaning previous tarballs..."
rm -f ./*.tgz
rm -f "$PLATFORM_PKG_DIR"/*.tgz

# Pack platform package first
echo "📦 Packing platform package..."
cd "$PLATFORM_PKG_DIR"
PLATFORM_PACKAGE_FILE=$(bun pm pack 2>/dev/null | grep '\.tgz$')
echo "✅ Created: $PLATFORM_PACKAGE_FILE"
cd "$ROOT_DIR"

# Pack main package
echo "📦 Packing main package..."
MAIN_PACKAGE_FILE=$(bun pm pack 2>/dev/null | grep '\.tgz$')
echo "✅ Created: $MAIN_PACKAGE_FILE"

echo "♻️ Removing previous global installs (if any)..."
bun remove -g dev3000 @d3k/darwin-arm64 >/dev/null 2>&1 || true

# Install platform package first, then main package
echo "📥 Installing platform package globally..."
bun add -g "file:$PLATFORM_PKG_DIR/$PLATFORM_PACKAGE_FILE"

echo "📥 Installing main package globally..."
bun add -g "file:$ROOT_DIR/$MAIN_PACKAGE_FILE"

echo "✅ Canary test completed successfully!"
echo "🚀 You can now use 'd3k' or 'dev3000' commands"
