#!/bin/bash
set -e

echo "🏗️ Starting build process..."

# Build main package
echo "📦 Building main package..."
echo "🧹 Cleaning old build artifacts..."
rm -rf dist
pnpm run build

# Build MCP server with standalone output
echo "🏗️ Building MCP server..."
cd mcp-server

# Clean previous build and node_modules to avoid caching old dependencies
rm -rf .next node_modules

# Reinstall dependencies fresh
pnpm install

# Build with turbopack
echo "📦 Creating build with turbopack..."
pnpm run build

cd ..

echo "✅ Build completed successfully!"