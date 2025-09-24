#!/bin/bash
set -e

echo "🧪 Starting canary test process..."

# Use shared build script
./scripts/build.sh

# Pack and install
echo "📦 Packing and installing globally..."
PACKAGE_FILE=$(pnpm pack --silent)
echo "✅ Created: $PACKAGE_FILE"
pnpm install -g "file:$(pwd)/$PACKAGE_FILE"

echo "✅ Canary test completed successfully!"