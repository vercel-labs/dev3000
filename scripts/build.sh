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

# Clean previous build (this also removes the turbopack cache)
rm -rf .next

# Build with turbopack
echo "📦 Creating build with turbopack..."
pnpm run build

cd ..

echo "✅ Build completed successfully!"