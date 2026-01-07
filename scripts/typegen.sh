#!/bin/bash
set -e

echo "🔧 Running next typegen in www and mcp-server directories..."

# Run next typegen in www directory
echo "📦 Running next typegen in www..."
cd www
bun run typegen
if [ -f next-env.d.ts ]; then
  bun exec biome format --write next-env.d.ts >/dev/null 2>&1 || true
fi
cd ..

# Run next typegen in mcp-server directory
echo "📦 Running next typegen in mcp-server..."
cd mcp-server
bun run typegen
if [ -f next-env.d.ts ]; then
  bun exec biome format --write next-env.d.ts >/dev/null 2>&1 || true
fi
cd ..

echo "✅ Type generation complete!"
