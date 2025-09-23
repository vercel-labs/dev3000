#!/bin/bash
set -e

echo "🔧 Running next typegen in www and mcp-server directories..."

# Run next typegen in www directory
echo "📦 Running next typegen in www..."
cd www
pnpm run typegen
cd ..

# Run next typegen in mcp-server directory
echo "📦 Running next typegen in mcp-server..."
cd mcp-server
pnpm run typegen
cd ..

echo "✅ Type generation complete!"