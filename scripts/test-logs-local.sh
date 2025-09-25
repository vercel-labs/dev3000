#!/bin/bash
set -e

echo "🧪 Running logs API test with local build..."

# Build if needed
if [ ! -d "dist" ] || [ ! -d "mcp-server/.next" ]; then
    echo "📦 Building first..."
    pnpm run build
    ./scripts/build.sh
fi

# Add local node_modules/.bin to PATH so 'd3k' resolves to local build
export PATH="$PWD/node_modules/.bin:$PATH"

# Run the test
pnpm exec tsx scripts/test-logs-api.ts