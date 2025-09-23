#!/bin/bash
set -e

echo "🏗️ Starting build process..."

# Build main package
echo "📦 Building main package..."
echo "🧹 Cleaning old build artifacts..."
rm -rf dist
pnpm run build

# Build MCP server (production mode without standalone)
echo "🏗️ Building MCP server..."
cd mcp-server
pnpm run build
cd ..

echo "✅ Build completed successfully!"