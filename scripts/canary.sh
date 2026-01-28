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

# Copy built binaries to platform packages
echo "📁 Copying binaries to platform packages..."

# darwin-arm64
DARWIN_ARM64_PKG_DIR="$ROOT_DIR/packages/d3k-darwin-arm64"
DARWIN_ARM64_DIST_DIR="$ROOT_DIR/dist-bin/d3k-darwin-arm64"
rm -rf "$DARWIN_ARM64_PKG_DIR/bin" "$DARWIN_ARM64_PKG_DIR/mcp-server" "$DARWIN_ARM64_PKG_DIR/skills" "$DARWIN_ARM64_PKG_DIR/src"
cp -r "$DARWIN_ARM64_DIST_DIR/bin" "$DARWIN_ARM64_PKG_DIR/"
cp -r "$DARWIN_ARM64_DIST_DIR/mcp-server" "$DARWIN_ARM64_PKG_DIR/"
cp -r "$DARWIN_ARM64_DIST_DIR/skills" "$DARWIN_ARM64_PKG_DIR/"
cp -r "$DARWIN_ARM64_DIST_DIR/src" "$DARWIN_ARM64_PKG_DIR/"

# linux-x64
LINUX_X64_PKG_DIR="$ROOT_DIR/packages/d3k-linux-x64"
LINUX_X64_DIST_DIR="$ROOT_DIR/dist-bin/d3k-linux-x64"
rm -rf "$LINUX_X64_PKG_DIR/bin" "$LINUX_X64_PKG_DIR/mcp-server" "$LINUX_X64_PKG_DIR/skills" "$LINUX_X64_PKG_DIR/src"
cp -r "$LINUX_X64_DIST_DIR/bin" "$LINUX_X64_PKG_DIR/"
cp -r "$LINUX_X64_DIST_DIR/mcp-server" "$LINUX_X64_PKG_DIR/"
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
PLATFORM_PACKAGE_FILE=$(npm pack 2>/dev/null | grep '\.tgz$')
echo "✅ Created: $PLATFORM_PACKAGE_FILE"
cd "$ROOT_DIR"

# Pack main package
echo "📦 Packing main package..."
MAIN_PACKAGE_FILE=$(npm pack 2>/dev/null | grep '\.tgz$')
echo "✅ Created: $MAIN_PACKAGE_FILE"

echo "♻️ Removing previous global installs (if any)..."
bun remove -g dev3000 @d3k/darwin-arm64 >/dev/null 2>&1 || true

# Install platform package first, then main package
echo "📥 Installing platform package globally..."
bun add -g "file:$PLATFORM_PKG_DIR/$PLATFORM_PACKAGE_FILE"

# bun blocks postinstall scripts by default, so fix permissions and run postinstalls manually
echo "🔧 Fixing executable permissions..."
GLOBAL_BIN_DIR="$(bun pm bin -g)"
INSTALLED_PKG_DIR="${GLOBAL_BIN_DIR%/bin}/install/global/node_modules/@d3k/darwin-arm64"
chmod +x "$INSTALLED_PKG_DIR/mcp-server/node_modules/.bin/"* 2>/dev/null || true

# Run agent-browser postinstall to download native binary (bun skips postinstall scripts)
echo "🔧 Installing agent-browser native binary..."
AGENT_BROWSER_DIR="$INSTALLED_PKG_DIR/mcp-server/node_modules/agent-browser"
DOT_BIN_DIR="$INSTALLED_PKG_DIR/mcp-server/node_modules/.bin"
if [ -f "$AGENT_BROWSER_DIR/scripts/postinstall.js" ]; then
  (cd "$AGENT_BROWSER_DIR" && node scripts/postinstall.js) 2>/dev/null || echo "⚠️ agent-browser postinstall failed (may already be installed)"
fi

# Copy native binaries to .bin/ (needed because dereference:true breaks wrapper symlink resolution)
if [ -d "$AGENT_BROWSER_DIR/bin" ] && [ -d "$DOT_BIN_DIR" ]; then
  echo "🔧 Copying agent-browser native binaries to .bin/..."
  for binary in agent-browser-darwin-arm64 agent-browser-darwin-x64 agent-browser-linux-arm64 agent-browser-linux-x64 agent-browser-win32-x64.exe; do
    if [ -f "$AGENT_BROWSER_DIR/bin/$binary" ] && [ ! -f "$DOT_BIN_DIR/$binary" ]; then
      cp "$AGENT_BROWSER_DIR/bin/$binary" "$DOT_BIN_DIR/"
    fi
  done
fi

echo "📥 Installing main package globally..."
bun add -g "file:$ROOT_DIR/$MAIN_PACKAGE_FILE"

echo "✅ Canary test completed successfully!"
echo "🚀 You can now use 'd3k' or 'dev3000' commands"
