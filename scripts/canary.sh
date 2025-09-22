#!/bin/bash
set -e

echo "🧪 Starting canary test process..."

# Use shared build script
./scripts/build.sh

# Pack and install
echo "📦 Packing and installing globally..."
pnpm pack
PACKAGE_FILE="dev3000-$(node -p "require('./package.json').version").tgz"
pnpm install -g "file:$(pwd)/$PACKAGE_FILE"

echo "✅ Canary test completed successfully!"