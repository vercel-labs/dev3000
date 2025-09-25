#!/bin/bash
set -e

echo "🧪 Starting canary test process..."

# Use shared build script
./scripts/build.sh

# Pack and install
echo "📦 Packing and installing globally..."
echo "🧹 Cleaning previous tarballs..."
rm -f ./*.tgz
PACKAGE_FILE=$(pnpm pack 2>&1 | tail -n 1)
echo "✅ Created: $PACKAGE_FILE"

echo "♻️ Removing previous global install (if any)..."
pnpm remove -g dev3000 >/dev/null 2>&1 || true

pnpm add -g "file:$(pwd)/$PACKAGE_FILE"

echo "✅ Canary test completed successfully!"
echo "🚀 You can now use 'd3k' or 'dev3000' commands"
