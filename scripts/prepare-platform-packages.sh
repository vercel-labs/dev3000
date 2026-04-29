#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "🔨 Building compiled binaries..."
bun run scripts/build-binaries.ts

echo "📁 Copying binaries to platform packages..."

DARWIN_ARM64_PKG_DIR="packages/d3k-darwin-arm64"
DARWIN_ARM64_DIST_DIR="dist-bin/d3k-darwin-arm64"
rm -rf "$DARWIN_ARM64_PKG_DIR/bin" "$DARWIN_ARM64_PKG_DIR/skills" "$DARWIN_ARM64_PKG_DIR/src"
cp -r "$DARWIN_ARM64_DIST_DIR/bin" "$DARWIN_ARM64_PKG_DIR/"
cp -r "$DARWIN_ARM64_DIST_DIR/skills" "$DARWIN_ARM64_PKG_DIR/"
cp -r "$DARWIN_ARM64_DIST_DIR/src" "$DARWIN_ARM64_PKG_DIR/"

LINUX_X64_PKG_DIR="packages/d3k-linux-x64"
LINUX_X64_DIST_DIR="dist-bin/d3k-linux-x64"
rm -rf "$LINUX_X64_PKG_DIR/bin" "$LINUX_X64_PKG_DIR/skills" "$LINUX_X64_PKG_DIR/src"
cp -r "$LINUX_X64_DIST_DIR/bin" "$LINUX_X64_PKG_DIR/"
cp -r "$LINUX_X64_DIST_DIR/skills" "$LINUX_X64_PKG_DIR/"
cp -r "$LINUX_X64_DIST_DIR/src" "$LINUX_X64_PKG_DIR/"

WINDOWS_X64_PKG_DIR="packages/d3k-windows-x64"
WINDOWS_X64_DIST_DIR="dist-bin/d3k-windows-x64"
rm -rf "$WINDOWS_X64_PKG_DIR/bin" "$WINDOWS_X64_PKG_DIR/skills" "$WINDOWS_X64_PKG_DIR/src"
cp -r "$WINDOWS_X64_DIST_DIR/bin" "$WINDOWS_X64_PKG_DIR/"
cp -r "$WINDOWS_X64_DIST_DIR/skills" "$WINDOWS_X64_PKG_DIR/"
cp -r "$WINDOWS_X64_DIST_DIR/src" "$WINDOWS_X64_PKG_DIR/"

echo "✅ Binaries ready for publishing"

echo "🧪 Running compiled binary smoke test..."
BINARY_PATH="$DARWIN_ARM64_PKG_DIR/bin/dev3000"
if [ ! -x "$BINARY_PATH" ]; then
  echo "❌ Binary not found or not executable: $BINARY_PATH"
  exit 1
fi

if "$BINARY_PATH" --version > /dev/null 2>&1; then
  echo "✅ Binary smoke test passed (--version works)"
else
  echo "❌ Binary smoke test FAILED: --version returned error"
  exit 1
fi
