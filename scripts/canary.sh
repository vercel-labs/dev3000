#!/bin/bash
set -e

echo "🧪 Starting canary test process..."

# Use shared build script
./scripts/build.sh

# Pack and install
echo "📦 Packing and installing globally..."
PACKAGE_FILE=$(pnpm pack 2>&1 | tail -n 1)
echo "✅ Created: $PACKAGE_FILE"
pnpm install -g "file:$(pwd)/$PACKAGE_FILE"

echo "✅ Canary test completed successfully!"
echo "🚀 You can now use 'd3k' or 'dev3000' commands"